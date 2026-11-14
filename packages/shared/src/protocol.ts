import { LIMITS } from './limits';
import { MetaSchema } from './schemas';
import { toSlug } from './slug';
import { extractWikilinks, stripWikilinks } from './wikilink';

export const META_DELIMITER = '===META===';

export interface ParsedChild {
  title: string;
  summary: string;
}

export interface ParsedExpand {
  body: string;
  summary: string;
  aliases: string[];
  children: ParsedChild[];
  metaRecovered: boolean;
}

/** Error thrown by the parsers; the server maps it to the `empty_output` code. */
export class EmptyOutputError extends Error {
  constructor() {
    super('The model returned no text.');
  }
}

function splitAtMeta(text: string): { body: string; tail: string | null } {
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  let idx = -1;
  for (let i = lines.length - 1; i >= 0; i--) {
    if ((lines[i] ?? '').trim() === META_DELIMITER) {
      idx = i;
      break;
    }
  }
  if (idx === -1) return { body: lines.join('\n'), tail: null };
  return { body: lines.slice(0, idx).join('\n'), tail: lines.slice(idx + 1).join('\n') };
}

function firstSentence(md: string): string {
  const plain = stripWikilinks(md)
    .replace(/^#{1,6}\s.*$/gm, '')
    .replace(/[*_`]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  const m = plain.match(/^.*?[.!?](?=\s|$)/);
  return (m ? m[0] : plain).slice(0, LIMITS.summaryMax).trim();
}

function parseTail(tail: string): unknown {
  let t = tail.trim();
  t = t.replace(/^```[a-zA-Z]*\s*/, '').replace(/\s*```\s*$/, '');
  const a = t.indexOf('{');
  const b = t.lastIndexOf('}');
  if (a === -1 || b <= a) return undefined;
  try {
    return JSON.parse(t.slice(a, b + 1));
  } catch {
    return undefined;
  }
}

const unbracket = (s: string) => s.replace(/\[\[|\]\]/g, '').trim();

/**
 * Split a model reply into explanation body and metadata. Never throws for bad metadata:
 * missing or invalid metadata is rebuilt from the links in the text.
 */
export function parseExpandOutput(
  text: string,
  nodeTitle: string,
  nodeAliases: string[],
  resolve: (name: string) => unknown,
): ParsedExpand {
  const { body: rawBody, tail } = splitAtMeta(text);
  let body = rawBody.trim();

  const ownSlugs = new Set([toSlug(nodeTitle), ...nodeAliases.map(toSlug)]);
  const firstLine = body.split('\n', 1)[0] ?? '';
  const heading = firstLine.match(/^#{1,6}\s+(.*)$/);
  if (heading && ownSlugs.has(toSlug(heading[1] ?? ''))) {
    body = body.slice(firstLine.length).trim();
  }
  if (!body) throw new EmptyOutputError();

  const raw = tail === null ? undefined : parseTail(tail);
  const parsed = raw === undefined ? undefined : MetaSchema.safeParse(raw);

  if (parsed?.success) {
    const m = parsed.data;
    const seen = new Set(ownSlugs);
    const children: ParsedChild[] = [];
    for (const c of m.children) {
      const title = unbracket(c.title);
      const slug = toSlug(title);
      if (!title || title.length > LIMITS.titleMax || !slug || seen.has(slug)) continue;
      seen.add(slug);
      children.push({ title, summary: c.summary.trim().slice(0, LIMITS.summaryMax) });
      if (children.length >= LIMITS.childrenMax) break;
    }
    const aliasSeen = new Set<string>();
    const aliases: string[] = [];
    for (const a of m.aliases) {
      const alias = unbracket(a);
      const slug = toSlug(alias);
      if (!alias || alias.length > LIMITS.titleMax || !slug || aliasSeen.has(slug)) continue;
      aliasSeen.add(slug);
      aliases.push(alias);
      if (aliases.length >= LIMITS.aliasesMax) break;
    }
    return {
      body,
      summary: m.summary.trim().slice(0, LIMITS.summaryMax),
      aliases,
      children,
      metaRecovered: false,
    };
  }

  // Fallback: rebuild from the text itself.
  const seen = new Set(ownSlugs);
  const children: ParsedChild[] = [];
  for (const l of extractWikilinks(body)) {
    const slug = toSlug(l.target);
    if (!slug || seen.has(slug) || resolve(l.target)) continue;
    seen.add(slug);
    children.push({ title: l.target, summary: '' });
    if (children.length >= 5) break;
  }
  return { body, summary: firstSentence(body), aliases: [], children, metaRecovered: true };
}

export function parseAskOutput(text: string): string {
  const { body } = splitAtMeta(text);
  const out = body.trim();
  if (!out) throw new EmptyOutputError();
  return out;
}

const DELIM = '\n' + META_DELIMITER;

/** Hides the metadata tail while text is streamed to the browser. Display only. */
export class StreamFilter {
  private buffer = '';
  private sent = 0;
  private done = false;

  push(text: string): string {
    if (this.done) return '';
    this.buffer += text;
    let i = this.buffer.indexOf(DELIM);
    if (i === -1 && this.buffer.startsWith(META_DELIMITER)) i = 0;
    let end: number;
    if (i >= 0) {
      end = i;
      this.done = true;
    } else {
      end = Math.max(this.sent, this.buffer.length - DELIM.length);
    }
    const out = this.buffer.slice(this.sent, end);
    this.sent = end;
    return out;
  }

  flush(): string {
    if (this.done) return '';
    const out = this.buffer.slice(this.sent);
    this.sent = this.buffer.length;
    return out;
  }
}
