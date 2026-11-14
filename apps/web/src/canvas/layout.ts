import dagre from '@dagrejs/dagre';
import type { MapFile, MapIndex } from '@mindmapper/shared';

export const NODE_W = 220;
export const NODE_H = 72;

export interface Layout {
  positions: Map<string, { x: number; y: number }>;
  visible: string[];
  /** For a collapsed node: how many descendants are hidden. */
  hidden: Map<string, number>;
  edges: { id: string; source: string; target: string }[];
}

function countDescendants(index: MapIndex, id: string): number {
  let n = 0;
  for (const c of index.children.get(id) ?? []) n += 1 + countDescendants(index, c);
  return n;
}

/** Left-to-right tree layout. Collapsed subtrees are left out. */
export function computeLayout(map: MapFile, index: MapIndex): Layout {
  const visible: string[] = [];
  const hidden = new Map<string, number>();
  const edges: Layout['edges'] = [];
  const walk = (id: string) => {
    const n = map.nodes[id];
    if (!n) return;
    visible.push(id);
    if (n.collapsed) {
      const c = countDescendants(index, id);
      if (c) hidden.set(id, c);
      return;
    }
    for (const child of index.children.get(id) ?? []) {
      edges.push({ id: `t:${id}-${child}`, source: id, target: child });
      walk(child);
    }
  };
  walk(map.rootId);

  const g = new dagre.graphlib.Graph();
  g.setGraph({ rankdir: 'LR', nodesep: 20, ranksep: 70, marginx: 20, marginy: 20 });
  g.setDefaultEdgeLabel(() => ({}));
  for (const id of visible) g.setNode(id, { width: NODE_W, height: NODE_H });
  for (const e of edges) g.setEdge(e.source, e.target);
  dagre.layout(g);

  const positions = new Map<string, { x: number; y: number }>();
  for (const id of visible) {
    const p = g.node(id);
    positions.set(id, { x: p.x - NODE_W / 2, y: p.y - NODE_H / 2 });
  }
  return { positions, visible, hidden, edges };
}
