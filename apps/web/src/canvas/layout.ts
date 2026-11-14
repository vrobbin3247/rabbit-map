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

export interface AutoLayout {
  visible: string[];
  hidden: Map<string, number>;
  edges: Layout['edges'];
  auto: Map<string, { x: number; y: number }>;
}

/** Left-to-right tree layout from the tree structure alone. Collapsed subtrees are left out. */
export function computeAuto(map: MapFile, index: MapIndex): AutoLayout {
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
  g.setGraph({ rankdir: 'LR', nodesep: 24, ranksep: 80, marginx: 20, marginy: 20 });
  g.setDefaultEdgeLabel(() => ({}));
  for (const id of visible) g.setNode(id, { width: NODE_W, height: NODE_H });
  for (const e of edges) g.setEdge(e.source, e.target);
  dagre.layout(g);

  const auto = new Map<string, { x: number; y: number }>();
  for (const id of visible) {
    const p = g.node(id);
    auto.set(id, { x: p.x - NODE_W / 2, y: p.y - NODE_H / 2 });
  }
  return { visible, hidden, edges, auto };
}

/**
 * Final positions. A node the learner dragged stays where they put it (`overrides` are positions
 * being dragged right now). Nodes they have not touched follow their parent, so moving a node
 * moves its unplaced branch with it instead of stretching the edges.
 */
export function placeNodes(
  map: MapFile,
  base: AutoLayout,
  overrides: Record<string, { x: number; y: number }> = {},
): Map<string, { x: number; y: number }> {
  const positions = new Map<string, { x: number; y: number }>();
  const offset = new Map<string, { x: number; y: number }>();
  const zero = { x: 0, y: 0 };
  for (const id of base.visible) {
    const n = map.nodes[id];
    const a = base.auto.get(id) as { x: number; y: number };
    const manual = overrides[id] ?? n?.position ?? null;
    if (manual) {
      positions.set(id, { x: manual.x, y: manual.y });
      offset.set(id, { x: manual.x - a.x, y: manual.y - a.y });
    } else {
      const po = (n?.parentId ? offset.get(n.parentId) : undefined) ?? zero;
      positions.set(id, { x: a.x + po.x, y: a.y + po.y });
      offset.set(id, po);
    }
  }
  return positions;
}

export function computeLayout(map: MapFile, index: MapIndex): Layout {
  const base = computeAuto(map, index);
  return { positions: placeNodes(map, base), visible: base.visible, hidden: base.hidden, edges: base.edges };
}
