import { mkdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { buildIndex, pathOf, type ConceptNode, type MapFile } from '@mindmapper/shared';

const safeName = (s: string) => s.replace(/[\\/:*?"<>|#^[\]]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 100) || 'Untitled';

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
  const dir = path.join(exportsDir, safeName(map.title));
  await rm(dir, { recursive: true, force: true });
  await mkdir(dir, { recursive: true });
  const names = fileNames(map);
  buildIndex(map);
  for (const n of Object.values(map.nodes)) {
    await writeFile(path.join(dir, `${names.get(n.id)}.md`), render(map, n, names), 'utf8');
  }
  return { path: dir, files: Object.keys(map.nodes).length };
}
