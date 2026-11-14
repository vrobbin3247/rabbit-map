import { mkdir, readdir, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { buildIndex, pathOf, type ConceptNode, type MapFile } from '@mindmapper/shared';

/**
 * A file or folder name made from a title. Never empty, never "." or "..", never hidden, and
 * never containing a path separator, so it cannot point outside the folder it is joined onto.
 */
export const safeName = (s: string) =>
  s
    .replace(/[\\/:*?"<>|#^[\]]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^[.\s]+|[.\s]+$/g, '')
    .slice(0, 100)
    .trim() || 'Untitled';

/** Marks a folder as one we wrote, so a later export may replace it and never anything else. */
const MARKER = '.mindmapper-export';

async function exists(p: string): Promise<boolean> {
  try {
    await stat(p);
    return true;
  } catch {
    return false;
  }
}

/** The folder to write into: our own earlier export is replaced; a folder someone else made is left alone. */
async function chooseDir(root: string, title: string): Promise<string> {
  const base = safeName(title);
  for (let i = 1; i < 1000; i++) {
    const dir = path.resolve(root, i === 1 ? base : `${base} (${i})`);
    // Defence in depth: whatever the name was, the result must be a direct child of the exports folder.
    if (path.dirname(dir) !== root) throw new Error('Refusing to export outside the exports folder.');
    if (!(await exists(dir))) return dir;
    if (await exists(path.join(dir, MARKER))) {
      await rm(dir, { recursive: true, force: true });
      return dir;
    }
    if ((await readdir(dir)).length === 0) return dir;
  }
  throw new Error('Too many exports with the same name.');
}

function fileNames(map: MapFile): Map<string, string> {
  const used = new Set<string>();
  const out = new Map<string, string>();
  for (const n of Object.values(map.nodes)) {
    const base = safeName(n.title);
    let name = base;
    for (let i = 2; used.has(name.toLowerCase()); i++) name = `${base} ${i}`;
    used.add(name.toLowerCase());
    out.set(n.id, name);
  }
  return out;
}

function render(map: MapFile, n: ConceptNode, names: Map<string, string>): string {
  const parent = n.parentId ? names.get(n.parentId) : null;
  const fm = ['---', `id: ${n.id}`, `title: ${JSON.stringify(n.title)}`];
  if (n.aliases.length) fm.push(`aliases: ${JSON.stringify(n.aliases)}`);
  if (parent) fm.push(`parent: "[[${parent}]]"`);
  fm.push(`path: ${JSON.stringify(pathOf(map, n.id).map((id) => (map.nodes[id] as ConceptNode).title).join(' > '))}`, '---', '');
  const parts = [fm.join('\n'), `# ${n.title}`, ''];
  parts.push(n.body ?? (n.summary ? `*${n.summary}*\n\n(not explained yet)` : '(not explained yet)'), '');
  const asked = n.thread.filter((m) => m.status === 'ready');
  if (asked.length) {
    parts.push('## Questions', '');
    for (const m of asked) {
      if (m.role === 'user') parts.push(`**Q:** ${m.quote ? `> ${m.quote}\n\n` : ''}${m.text}`, '');
      else parts.push(`**A:** ${m.text}`, '');
    }
  }
  return parts.join('\n');
}

/** Writes one Markdown file per node; wikilinks stay as [[Title]] and resolve by title or alias. */
export async function exportMap(map: MapFile, exportsDir: string): Promise<{ path: string; files: number }> {
  const root = path.resolve(exportsDir);
  await mkdir(root, { recursive: true });
  const dir = await chooseDir(root, map.title);
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, MARKER), 'Written by Mindmapper. Exporting this map again replaces this folder.\n', 'utf8');
  const names = fileNames(map);
  buildIndex(map);
  for (const n of Object.values(map.nodes)) {
    await writeFile(path.join(dir, `${names.get(n.id)}.md`), render(map, n, names), 'utf8');
  }
  return { path: dir, files: Object.keys(map.nodes).length };
}
