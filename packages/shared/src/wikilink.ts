import { LIMITS } from './limits';

export interface Wikilink {
  target: string;
  label: string;
  index: number;
  length: number;
}

const WIKILINK = /\[\[([^[\]|\n]{1,80})(?:\|([^[\]\n]{1,120}))?\]\]/g;

function blank(m: string): string {
  return m.replace(/[^\n]/g, ' ');
}

/** Replace code and math with spaces (same length) so links inside them are ignored. */
function mask(md: string): string {
  return md
    .replace(/(^|\n)(```|~~~)[\s\S]*?(\n\2[^\n]*|$)/g, blank)
    .replace(/`[^`\n]*`/g, blank)
    .replace(/\$\$[\s\S]+?\$\$/g, blank)
    .replace(/\$(?![\s$])[^$\n]+?(?<![\s\\])\$(?!\d)/g, blank);
}

export function extractWikilinks(markdown: string): Wikilink[] {
  const masked = mask(markdown);
  const out: Wikilink[] = [];
  for (const m of masked.matchAll(WIKILINK)) {
    const target = (m[1] ?? '').trim();
    if (!target) continue;
    const label = (m[2] ?? '').trim() || target;
    out.push({ target, label: label.slice(0, LIMITS.wikilinkLabelMax), index: m.index ?? 0, length: m[0].length });
  }
  return out;
}

/** Rewrite [[Target|label]] to [label](concept:Target) so a Markdown renderer can draw it. */
export function wikilinksToMarkdownLinks(markdown: string): string {
  const links = extractWikilinks(markdown);
  let out = '';
  let pos = 0;
  for (const l of links) {
    out += markdown.slice(pos, l.index);
    out += `[${l.label.replace(/[[\]]/g, '')}](concept:${encodeURIComponent(l.target)})`;
    pos = l.index + l.length;
  }
  return out + markdown.slice(pos);
}

/** Reduce wikilink markup to the visible label. */
export function stripWikilinks(markdown: string): string {
  const links = extractWikilinks(markdown);
  let out = '';
  let pos = 0;
  for (const l of links) {
    out += markdown.slice(pos, l.index) + l.label;
    pos = l.index + l.length;
  }
  return out + markdown.slice(pos);
}
