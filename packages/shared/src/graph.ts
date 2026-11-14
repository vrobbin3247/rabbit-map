import type { ConceptNode, MapFile } from './types';
import { toSlug } from './slug';
import { extractWikilinks } from './wikilink';

export interface MapIndex {
  slugToId: Map<string, string>;
  outLinks: Map<string, Set<string>>;
  backLinks: Map<string, Set<string>>;
  ghostTargets: Map<string, string[]>;
  children: Map<string, string[]>;
  depth: Map<string, number>;
}

/** Text of a node that can contain links: its body and its assistant answers. */
export function linkableTexts(node: ConceptNode): string[] {
  const texts: string[] = [];
  if (node.body) texts.push(node.body);
  for (const m of node.thread) if (m.role === 'assistant' && m.status === 'ready') texts.push(m.text);
  return texts;
}

function byCreated(a: ConceptNode, b: ConceptNode): number {
  return a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : a.id < b.id ? -1 : 1;
}

export function buildIndex(map: MapFile): MapIndex {
  const nodes = Object.values(map.nodes).sort(byCreated);
  const slugToId = new Map<string, string>();
  for (const n of nodes) {
    const s = toSlug(n.title);
    if (s && !slugToId.has(s)) slugToId.set(s, n.id);
  }
  for (const n of nodes) {
    for (const a of n.aliases) {
      const s = toSlug(a);
      if (s && !slugToId.has(s)) slugToId.set(s, n.id);
    }
  }

  const children = new Map<string, string[]>();
  for (const n of nodes) {
    if (n.parentId) {
      const list = children.get(n.parentId) ?? [];
      list.push(n.id);
      children.set(n.parentId, list);
    }
  }

  const outLinks = new Map<string, Set<string>>();
  const backLinks = new Map<string, Set<string>>();
  const ghostTargets = new Map<string, string[]>();
  for (const n of nodes) {
    outLinks.set(n.id, new Set());
    backLinks.set(n.id, backLinks.get(n.id) ?? new Set());
  }
  for (const n of nodes) {
    const out = outLinks.get(n.id) as Set<string>;
    const ghosts = new Map<string, string>();
    for (const text of linkableTexts(n)) {
      for (const l of extractWikilinks(text)) {
        const slug = toSlug(l.target);
        const id = slugToId.get(slug);
        if (id) {
          if (id !== n.id) out.add(id);
        } else if (slug && !ghosts.has(slug)) {
          ghosts.set(slug, l.target);
        }
      }
    }
    for (const r of n.related) if (r !== n.id && map.nodes[r]) out.add(r);
    ghostTargets.set(n.id, [...ghosts.values()]);
    for (const t of out) {
      const set = backLinks.get(t) ?? new Set<string>();
      set.add(n.id);
      backLinks.set(t, set);
    }
  }

  const depth = new Map<string, number>();
  const depthOfNode = (id: string, seen: Set<string>): number => {
    const known = depth.get(id);
    if (known !== undefined) return known;
    const n = map.nodes[id];
    if (!n || !n.parentId || seen.has(id)) return 0;
    seen.add(id);
    const d = depthOfNode(n.parentId, seen) + 1;
    depth.set(id, d);
    return d;
  };
  for (const n of nodes) depth.set(n.id, depthOfNode(n.id, new Set()));
  depth.set(map.rootId, 0);

  return { slugToId, outLinks, backLinks, ghostTargets, children, depth };
}

export function resolve(index: MapIndex, name: string): string | undefined {
  return index.slugToId.get(toSlug(name));
}

/** Node ids from the root down to `id`. */
export function pathOf(map: MapFile, id: string): string[] {
  const path: string[] = [];
  const seen = new Set<string>();
  let cur: string | null = id;
  while (cur && map.nodes[cur] && !seen.has(cur)) {
    seen.add(cur);
    path.push(cur);
    cur = (map.nodes[cur] as ConceptNode).parentId;
  }
  return path.reverse();
}

export function depthOf(map: MapFile, id: string): number {
  return Math.max(0, pathOf(map, id).length - 1);
}

/** `id` and all of its descendants. */
export function subtreeOf(map: MapFile, id: string): string[] {
  const kids = new Map<string, string[]>();
  for (const n of Object.values(map.nodes)) {
    if (n.parentId) kids.set(n.parentId, [...(kids.get(n.parentId) ?? []), n.id]);
  }
  const out: string[] = [];
  const stack = [id];
  while (stack.length) {
    const cur = stack.pop() as string;
    if (!map.nodes[cur]) continue;
    out.push(cur);
    for (const k of kids.get(cur) ?? []) stack.push(k);
  }
  return out;
}

/** True when `ancestorId` lies on the path from the root to `id`, excluding `id` itself. */
export function isAncestor(map: MapFile, ancestorId: string, id: string): boolean {
  const p = pathOf(map, id);
  return ancestorId !== id && p.includes(ancestorId);
}

export function assertInvariants(map: MapFile): string[] {
  const problems: string[] = [];
  const roots = Object.values(map.nodes).filter((n) => n.parentId === null);
  if (roots.length !== 1 || roots[0]?.id !== map.rootId) problems.push('exactly one root');
  const slugs = new Map<string, string>();
  for (const n of Object.values(map.nodes)) {
    if (n.id !== map.rootId && !pathOf(map, n.id).includes(map.rootId)) problems.push(`unreachable ${n.id}`);
    for (const name of [n.title, ...n.aliases]) {
      const s = toSlug(name);
      const owner = slugs.get(s);
      if (owner && owner !== n.id) problems.push(`duplicate slug ${s}`);
      slugs.set(s, n.id);
    }
    if ((n.body === null) !== (n.status === 'stub' || n.status === 'error' || (n.status === 'generating' && n.body === null)))
      problems.push(`body/status mismatch ${n.id}`);
    if ((n.error !== null) !== (n.status === 'error')) problems.push(`error/status mismatch ${n.id}`);
    for (const r of n.related) if (!map.nodes[r]) problems.push(`dangling related ${n.id}`);
    if (n.origin && !map.nodes[n.origin.nodeId]) problems.push(`dangling origin ${n.id}`);
  }
  const v = map.view;
  if (!map.nodes[v.anchorId]) problems.push('anchor missing');
  if (v.selectedId && !map.nodes[v.selectedId]) problems.push('selected missing');
  for (const t of v.trail) if (!map.nodes[t]) problems.push('trail dangling');
  return problems;
}
