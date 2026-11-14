import { useCallback, useEffect, useMemo, useRef } from 'react';
import {
  Controls,
  Panel,
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
  useStoreApi,
  type Edge,
} from '@xyflow/react';
import { pathOf, type ConceptNode } from '@mindmapper/shared';
import { useStore } from '../state/store';
import { ConceptNodeView, type ConceptFlowNode } from './ConceptNodeView';
import { NODE_H, NODE_W, computeLayout } from './layout';

const nodeTypes = { concept: ConceptNodeView };

function Canvas() {
  const map = useStore((s) => s.map)!;
  const index = useStore((s) => s.index)!;
  const showAll = useStore((s) => s.showAllCrossLinks);
  const rf = useReactFlow();
  const flow = useStoreApi();
  const timer = useRef<number | undefined>(undefined);
  const selectedId = map.view.selectedId;

  const layout = useMemo(() => computeLayout(map, index), [map, index]);

  const { nodes, edges } = useMemo(() => {
    const path = new Set(selectedId ? pathOf(map, selectedId) : []);
    const visited = new Set(map.view.trail);
    const nodes: ConceptFlowNode[] = layout.visible.map((id) => {
      const n = map.nodes[id] as ConceptNode;
      const pos = layout.positions.get(id) ?? { x: 0, y: 0 };
      return {
        id,
        type: 'concept',
        position: pos,
        width: NODE_W,
        height: NODE_H,
        draggable: false,
        selectable: false,
        connectable: false,
        data: {
          node: n,
          selected: id === selectedId,
          onPath: path.has(id),
          visited: visited.has(id),
          anchor: id === map.view.anchorId,
          hidden: layout.hidden.get(id) ?? 0,
          questions: n.thread.filter((m) => m.role === 'user').length,
        },
      };
    });
    const visible = new Set(layout.visible);
    const edges: Edge[] = layout.edges.map((e) => ({
      id: e.id,
      source: e.source,
      target: e.target,
      className: path.has(e.source) && path.has(e.target) ? 'on-path' : '',
      selectable: false,
      focusable: false,
    }));
    // Cross-links: only for the selected node unless the toolbar toggle is on.
    const treeAdjacent = (a: string, b: string) => map.nodes[a]?.parentId === b || map.nodes[b]?.parentId === a;
    const seen = new Set<string>();
    const addCross = (a: string, b: string) => {
      if (a === b || !visible.has(a) || !visible.has(b) || treeAdjacent(a, b)) return;
      const key = `x:${a}-${b}`;
      if (seen.has(key)) return;
      seen.add(key);
      edges.push({ id: key, source: a, target: b, sourceHandle: 'xs', targetHandle: 'xt', className: 'cross', selectable: false, focusable: false });
    };
    if (showAll) {
      for (const [from, tos] of index.outLinks) for (const to of tos) addCross(from, to);
    } else if (selectedId) {
      for (const to of index.outLinks.get(selectedId) ?? []) addCross(selectedId, to);
      for (const from of index.backLinks.get(selectedId) ?? []) addCross(from, selectedId);
    }
    return { nodes, edges };
  }, [map, index, layout, selectedId, showAll]);

  // Centre on the selection only when it is off-screen.
  useEffect(() => {
    if (!selectedId) return;
    const pos = layout.positions.get(selectedId);
    if (!pos) return;
    const { width, height, transform } = flow.getState();
    const [tx, ty, zoom] = transform;
    const x = pos.x * zoom + tx;
    const y = pos.y * zoom + ty;
    const inside = x >= 0 && y >= 0 && x + NODE_W * zoom <= width && y + NODE_H * zoom <= height;
    if (!inside) void rf.setCenter(pos.x + NODE_W / 2, pos.y + NODE_H / 2, { zoom: Math.max(zoom, 0.6), duration: 250 });
  }, [selectedId, layout, rf, flow]);

  const onMoveEnd = useCallback(
    (_: unknown, vp: { x: number; y: number; zoom: number }) => {
      window.clearTimeout(timer.current);
      timer.current = window.setTimeout(() => useStore.getState().saveViewport(vp), 800);
    },
    [],
  );
  useEffect(() => () => window.clearTimeout(timer.current), []);

  const centreOnSelection = () => {
    const pos = selectedId ? layout.positions.get(selectedId) : null;
    if (pos) void rf.setCenter(pos.x + NODE_W / 2, pos.y + NODE_H / 2, { zoom: rf.getZoom(), duration: 250 });
  };

  return (
    <ReactFlow
      nodes={nodes}
      edges={edges}
      nodeTypes={nodeTypes}
      colorMode="system"
      nodesDraggable={false}
      nodesConnectable={false}
      elementsSelectable={false}
      edgesFocusable={false}
      nodesFocusable={false}
      zoomOnDoubleClick={false}
      minZoom={0.15}
      maxZoom={1.6}
      defaultViewport={map.view.viewport ?? undefined}
      fitView={!map.view.viewport}
      fitViewOptions={{ padding: 0.2, maxZoom: 1 }}
      onNodeClick={(_, n) => useStore.getState().select(n.id)}
      onNodeDoubleClick={(_, n) => {
        const node = map.nodes[n.id];
        if (node && (node.status === 'stub' || node.status === 'error')) void useStore.getState().explain(n.id);
      }}
      onPaneClick={() => (document.activeElement as HTMLElement | null)?.blur?.()}
      onMoveEnd={onMoveEnd}
      proOptions={{ hideAttribution: true }}
    >
      <Controls showInteractive={false} position="bottom-left" />
      <Panel position="top-right">
        <div className="flex items-center gap-2 rounded-lg border border-[var(--border)] bg-[var(--panel)] px-2 py-1 text-xs">
          <label className="flex cursor-pointer items-center gap-1">
            <input type="checkbox" checked={showAll} onChange={(e) => useStore.getState().set({ showAllCrossLinks: e.target.checked })} />
            All cross-links
          </label>
          <button className="btn btn-sm" onClick={centreOnSelection}>Centre</button>
        </div>
      </Panel>
    </ReactFlow>
  );
}

export function MapCanvas() {
  const mapId = useStore((s) => s.map?.id);
  return (
    <ReactFlowProvider key={mapId}>
      <Canvas />
    </ReactFlowProvider>
  );
}
