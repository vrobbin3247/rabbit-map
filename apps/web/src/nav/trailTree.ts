import type { MapFile } from '@mindmapper/shared';

export interface TrailNode {
  id: string;
  /** How many times the learner landed on this card (the trail is a visit log; the tree shows each card once). */
  visits: number;
  /** True when the parent shown here is the card's real parent; false when levels between them were skipped (a jump). */
  direct: boolean;
  children: TrailNode[];
}

/**
 * Turns the visit log (card ids, oldest first, repeats allowed) into a journey tree.
 * Each visited card appears once, under its nearest visited ancestor, in the order it was first visited.
 * Cards whose ancestors were never visited sit at the top level.
 */
export function buildTrailTree(map: MapFile, trail: string[]): TrailNode[] {
  const visits = new Map<string, number>();
  for (const id of trail) if (map.nodes[id]) visits.set(id, (visits.get(id) ?? 0) + 1);
  const order = [...visits.keys()];

  const made = new Map<string, TrailNode>(order.map((id) => [id, { id, visits: visits.get(id) as number, direct: true, children: [] }]));
  const roots: TrailNode[] = [];
  for (const id of order) {
    const self = made.get(id) as TrailNode;
    let up = map.nodes[id]?.parentId ?? null;
    let skipped = false;
    while (up && !made.has(up)) {
      skipped = true;
      up = map.nodes[up]?.parentId ?? null;
    }
    const parent = up ? made.get(up) : undefined;
    if (!parent) {
      roots.push(self);
    } else {
      self.direct = !skipped;
      parent.children.push(self);
    }
  }
  return roots;
}

/** Ids of every card above `id` in the tree (so they can be opened to reveal it). */
export function trailAncestors(tree: TrailNode[], id: string): string[] {
  const walk = (nodes: TrailNode[], path: string[]): string[] | null => {
    for (const n of nodes) {
      if (n.id === id) return path;
      const found = walk(n.children, [...path, n.id]);
      if (found) return found;
    }
    return null;
  };
  return walk(tree, []) ?? [];
}

/** The ids to show for a search: matching cards plus everything above them, so the structure stays readable. */
export function filterTrail(tree: TrailNode[], titleOf: (id: string) => string, query: string): Set<string> | null {
  const q = query.trim().toLowerCase();
  if (!q) return null;
  const keep = new Set<string>();
  const walk = (n: TrailNode): boolean => {
    const here = titleOf(n.id).toLowerCase().includes(q);
    let below = false;
    for (const c of n.children) if (walk(c)) below = true;
    if (here || below) keep.add(n.id);
    return here || below;
  };
  tree.forEach(walk);
  return keep;
}
