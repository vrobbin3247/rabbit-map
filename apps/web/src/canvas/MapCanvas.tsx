import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  Background,
  BackgroundVariant,
  MarkerType,
  MiniMap,
  Panel,
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
  useStoreApi,
  useViewport,
  type Edge,
  type NodeChange,
} from '@xyflow/react';
import { pathOf, progress, type ConceptNode } from '@mindmapper/shared';
import { nodeMenu, type MenuEntry } from '../nav/nodeActions';
import { useStore } from '../state/store';
import { useTheme } from '../theme';
import { ContextMenu } from '../ui/ContextMenu';
import { ConceptNodeView, TONES, TONE_HEX, type ConceptFlowNode } from './ConceptNodeView';
import { NODE_H, NODE_W, computeAuto, placeNodes } from './layout';

const nodeTypes = { concept: ConceptNodeView };
const GRAY = '#7c78a8';
const ACCENT = '#4f82e8'; // "current": the selected card and the path to it share this blue
const MINIMAP_KEY = 'mindmapper.minimap';
const SPOTLIGHT_KEY = 'mindmapper.spotlight';

/**
 * The tool strip floats over the left edge of the board (it ends near 68 px). Fitting and centring
 * treat that strip as unavailable, so a node is never placed underneath it. The trail is not
 * floating: it is a column beside the board, so the board never extends under it.
 */
export const LEFT_INSET = 84;
export const fitOptions = (duration = 250) => ({
  padding: { left: `${LEFT_INSET}px`, top: '32px', right: '32px', bottom: '88px' } as const,
  maxZoom: 1,
  duration,
});

function readMinimap(): boolean {
  try {
    // Off by default: it would otherwise sit on top of nodes near the corner.
    return localStorage.getItem(MINIMAP_KEY) === 'on';
  } catch {
    return false;
  }
}

function readSpotlight(): boolean {
  try {
    return localStorage.getItem(SPOTLIGHT_KEY) !== 'off'; // on unless the learner turned it off
  } catch {
    return true;
  }
}

function Icon({ children }: { children: ReactNode }) {
  return (
    <svg className="sk" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.3" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      {children}
    </svg>
  );
}

function ToolButton({ label, onClick, active, disabled, children }: { label: string; onClick: () => void; active?: boolean; disabled?: boolean; children: ReactNode }) {
  return (
    <button className={`tool ${active ? 'on' : ''}`} onClick={onClick} disabled={disabled} aria-label={label} aria-pressed={active} title={label}>
      <Icon>{children}</Icon>
    </button>
  );
}

function ZoomPill() {
  const rf = useReactFlow();
  const { zoom } = useViewport();
  return (
    <div className="pill" role="group" aria-label="Zoom">
      <button className="tool" aria-label="Zoom out" title="Zoom out" onClick={() => void rf.zoomOut({ duration: 150 })}>
        <Icon><path d="M5 12h14" /></Icon>
      </button>
      <button className="zoom-value" title="Reset zoom to 100%" onClick={() => void rf.zoomTo(1, { duration: 150 })}>{Math.round(zoom * 100)}%</button>
      <button className="tool" aria-label="Zoom in" title="Zoom in" onClick={() => void rf.zoomIn({ duration: 150 })}>
        <Icon><path d="M12 5v14M5 12h14" /></Icon>
      </button>
    </div>
  );
}

/** How many cards are still unexplained. It is about the map, not the viewport, so it sits apart from the zoom. */
function LeftChip() {
  const map = useStore((s) => s.map)!;
  const left = progress(map).left;
  return (
    <div className="pill left-chip">
      <button
        className="zoom-value left-btn"
        onClick={() => useStore.getState().set({ leftOpen: true })}
        title={left ? `${left} card${left === 1 ? ' has' : 's have'} not been explained yet. Click to see them.` : 'Every card has been explained.'}
      >
        {left ? `${left} left` : '✓ all opened'}
      </button>
    </div>
  );
}

/** The right-click menu: the node's actions, or board actions for empty space. */
function ContextMenuHost({ anyPinned }: { anyPinned: boolean }) {
  const menu = useStore((s) => s.ctxMenu);
  const map = useStore((s) => s.map);
  const index = useStore((s) => s.index);
  const showAll = useStore((s) => s.showAllCrossLinks);
  const busy = useStore((s) => Object.keys(s.streams).length > 0);
  const streams = useStore((s) => s.streams);
  const rf = useReactFlow();
  if (!menu || !map || !index) return null;
  const close = () => useStore.getState().set({ ctxMenu: null });
  const st = useStore.getState;

  let entries: MenuEntry[];
  let label: string;
  if (menu.target.kind === 'node') {
    const node = map.nodes[menu.target.id];
    if (!node) return null;
    entries = nodeMenu(map, index, node, { busy, streaming: !!streams[node.id] });
    label = `Actions for ${node.title}`;
  } else {
    label = 'Board actions';
    entries = [
      { id: 'fit', label: 'Fit the whole map', run: () => void rf.fitView(fitOptions()) },
      { id: 'left', label: 'What’s left…', run: () => st().set({ leftOpen: true }) },
      { id: 'anchor', label: 'Go to anchor', hint: 'A', disabled: map.view.selectedId === map.view.anchorId, run: () => st().goToAnchor() },
      'separator',
      { id: 'tidy', label: 'Tidy up layout', disabled: !anyPinned, run: () => void st().tidyUp() },
      { id: 'cross', label: showAll ? 'Hide cross-links' : 'Show all cross-links', run: () => st().set({ showAllCrossLinks: !showAll }) },
    ];
  }
  return <ContextMenu x={menu.x} y={menu.y} entries={entries} label={label} onClose={close} />;
}

function Canvas() {
  const map = useStore((s) => s.map)!;
  const index = useStore((s) => s.index)!;
  const showAll = useStore((s) => s.showAllCrossLinks);
  const rf = useReactFlow();
  const flow = useStoreApi();
  const { resolved: theme } = useTheme();
  const timer = useRef<number | undefined>(undefined);
  const heading = useRef<{ x: number; y: number; zoom: number } | null>(null);
  const selectedId = map.view.selectedId;
  const [minimap, setMinimap] = useState(readMinimap);
  const [spotlight, setSpotlight] = useState(readSpotlight);
  // Positions of nodes being dragged right now; committed to the map when the drag ends.
  const [live, setLive] = useState<Record<string, { x: number; y: number }>>({});

  const auto = useMemo(() => computeAuto(map, index), [map, index]);
  const positions = useMemo(() => placeNodes(map, auto, live), [map, auto, live]);
  const anyPinned = useMemo(() => Object.values(map.nodes).some((n) => n.position), [map]);

  const { nodes, edges } = useMemo(() => {
    const path = new Set(selectedId ? pathOf(map, selectedId) : []);
    const visited = new Set(map.view.trail);
    // Spotlight: keep the path, its direct neighbours (so siblings and children stay) and the selected card's links at full strength.
    const near = new Set<string>([...(index.outLinks.get(selectedId ?? '') ?? []), ...(index.backLinks.get(selectedId ?? '') ?? [])]);
    const dimmed = (id: string): boolean => {
      if (!spotlight || !selectedId) return false;
      const n = map.nodes[id];
      if (!n || n.status === 'generating' || path.has(id) || near.has(id)) return false;
      return !(n.parentId && path.has(n.parentId));
    };
    const nodes: ConceptFlowNode[] = auto.visible.map((id) => {
      const n = map.nodes[id] as ConceptNode;
      return {
        id,
        type: 'concept',
        position: positions.get(id) ?? { x: 0, y: 0 },
        width: NODE_W,
        height: NODE_H,
        draggable: true,
        selectable: false,
        connectable: false,
        data: {
          node: n,
          selected: id === selectedId,
          onPath: path.has(id),
          visited: visited.has(id),
          anchor: id === map.view.anchorId,
          hidden: auto.hidden.get(id) ?? 0,
          questions: n.thread.filter((m) => m.role === 'user').length,
          depth: index.depth.get(id) ?? 0,
          dim: dimmed(id),
        },
      };
    });
    const visible = new Set(auto.visible);
    const edges: Edge[] = auto.edges.map((e) => {
      const onPath = path.has(e.source) && path.has(e.target);
      return {
        id: e.id,
        source: e.source,
        target: e.target,
        className: [onPath && 'on-path', dimmed(e.target) && 'dim'].filter(Boolean).join(' '),
        // A fixed-size open chevron. The default marker scales with the line width, which made solid blobs on thick lines.
        markerEnd: { type: MarkerType.Arrow, width: 24, height: 24, strokeWidth: 1.6, markerUnits: 'userSpaceOnUse', color: onPath ? ACCENT : GRAY },
        selectable: false,
        focusable: false,
      };
    });
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
  }, [map, index, auto, positions, selectedId, showAll, spotlight]);

  /** Put a node in the middle of the free area, not the middle of the whole board. */
  const centreOn = (pos: { x: number; y: number }, zoom: number, duration: number) => {
    const { width, height } = flow.getState();
    const cx = LEFT_INSET + (width - LEFT_INSET) / 2;
    const vp = { x: cx - (pos.x + NODE_W / 2) * zoom, y: (height - 56) / 2 - (pos.y + NODE_H / 2) * zoom, zoom };
    // Remember where the viewport is heading. A second selection that arrives mid-animation must be
    // judged against this, not against the half-way position, or it can wrongly skip centring.
    heading.current = vp;
    window.setTimeout(() => {
      if (heading.current === vp) heading.current = null;
    }, duration + 80);
    void rf.setViewport(vp, { duration });
  };

  // Centre on the selection only when it is off-screen.
  useEffect(() => {
    if (!selectedId) return;
    const pos = positions.get(selectedId);
    if (!pos) return;
    const { width, height, transform } = flow.getState();
    const h = heading.current;
    const [tx, ty, zoom] = h ? [h.x, h.y, h.zoom] : transform;
    const x = pos.x * zoom + tx;
    const y = pos.y * zoom + ty;
    // "On screen" means in the free area: right of the floating tools, clear of the zoom pill.
    const inside = x >= LEFT_INSET && y >= 8 && x + NODE_W * zoom <= width - 8 && y + NODE_H * zoom <= height - 72;
    if (!inside) centreOn(pos, Math.max(zoom, 0.6), 250);
    // Runs when the selection changes, not on every drag.
  }, [selectedId]);

  const onNodesChange = useCallback((changes: NodeChange<ConceptFlowNode>[]) => {
    const moved: Record<string, { x: number; y: number }> = {};
    for (const c of changes) if (c.type === 'position' && c.position) moved[c.id] = c.position;
    if (Object.keys(moved).length) setLive((prev) => ({ ...prev, ...moved }));
  }, []);

  const onMoveEnd = useCallback((_: unknown, vp: { x: number; y: number; zoom: number }) => {
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => useStore.getState().saveViewport(vp), 800);
  }, []);
  useEffect(() => () => window.clearTimeout(timer.current), []);

  const centreOnSelection = () => {
    const pos = selectedId ? positions.get(selectedId) : null;
    if (pos) centreOn(pos, rf.getZoom(), 250);
  };

  return (
    <ReactFlow
      nodes={nodes}
      edges={edges}
      nodeTypes={nodeTypes}
      colorMode={theme}
      onNodesChange={onNodesChange}
      nodesDraggable
      nodeDragThreshold={4}
      nodesConnectable={false}
      elementsSelectable={false}
      edgesFocusable={false}
      nodesFocusable={false}
      zoomOnDoubleClick={false}
      minZoom={0.1}
      maxZoom={2}
      defaultViewport={map.view.viewport ?? undefined}
      fitView={!map.view.viewport}
      fitViewOptions={fitOptions(0)}
      onNodeClick={(_, n) => useStore.getState().select(n.id)}
      onNodeDoubleClick={(_, n) => {
        const node = map.nodes[n.id];
        if (node && (node.status === 'stub' || node.status === 'error')) void useStore.getState().explain(n.id);
      }}
      onNodeDragStop={(_, n) => {
        void useStore.getState().moveNodes({ [n.id]: { x: Math.round(n.position.x), y: Math.round(n.position.y) } });
        setLive({});
      }}
      onNodeContextMenu={(e, n) => {
        e.preventDefault();
        const st = useStore.getState();
        st.select(n.id); // the panel and the menu always agree on which node this is
        st.set({ ctxMenu: { x: e.clientX, y: e.clientY, target: { kind: 'node', id: n.id } } });
      }}
      onPaneContextMenu={(e) => {
        e.preventDefault();
        useStore.getState().set({ ctxMenu: { x: e.clientX, y: e.clientY, target: { kind: 'pane' } } });
      }}
      onPaneClick={() => (document.activeElement as HTMLElement | null)?.blur?.()}
      onMoveEnd={onMoveEnd}
      proOptions={{ hideAttribution: true }}
    >
      <Background variant={BackgroundVariant.Dots} gap={22} size={1.6} />

      <Panel position="top-left" className="toolbar" aria-label="Board tools">
        <ToolButton label="Fit the whole map" onClick={() => void rf.fitView(fitOptions())}>
          <path d="M4 9V5h4M20 9V5h-4M4 15v4h4M20 15v4h-4" />
        </ToolButton>
        <ToolButton label="Centre on the selected node" onClick={centreOnSelection} disabled={!selectedId}>
          <circle cx="12" cy="12" r="3" /><path d="M12 3v3M12 18v3M3 12h3M18 12h3" />
        </ToolButton>
        <span className="sep" aria-hidden />
        <ToolButton label={`Back to anchor: ${map.nodes[map.view.anchorId]?.title ?? 'anchor'}`} onClick={() => useStore.getState().goToAnchor()}>
          <circle cx="12" cy="5" r="2.5" /><path d="M12 7.5V21M6 11h12M5 14c0 4 3 7 7 7s7-3 7-7" />
        </ToolButton>
        <ToolButton label="Set anchor here" onClick={() => selectedId && useStore.getState().setAnchor(selectedId)} disabled={!selectedId || selectedId === map.view.anchorId}>
          <path d="M12 21s-6.5-5.6-6.5-11a6.5 6.5 0 0113 0c0 5.4-6.5 11-6.5 11z" /><circle cx="12" cy="10" r="2.3" />
        </ToolButton>
        <span className="sep" aria-hidden />
        <ToolButton label="Tidy up: put every node back in automatic layout" onClick={() => void useStore.getState().tidyUp()} disabled={!anyPinned}>
          <rect x="4" y="4" width="6" height="6" rx="1" /><rect x="14" y="4" width="6" height="6" rx="1" /><rect x="4" y="14" width="6" height="6" rx="1" /><rect x="14" y="14" width="6" height="6" rx="1" />
        </ToolButton>
        <ToolButton label="Show all cross-links" active={showAll} onClick={() => useStore.getState().set({ showAllCrossLinks: !showAll })}>
          <path d="M9 15l6-6" /><path d="M11 6l1-1a4 4 0 015.7 5.7l-1 1M13 18l-1 1a4 4 0 01-5.7-5.7l1-1" />
        </ToolButton>
        <ToolButton
          label={spotlight ? 'Spotlight is on: other branches are faded. Click to show everything equally' : 'Spotlight the current branch (fade the others)'}
          active={spotlight}
          onClick={() => {
            setSpotlight(!spotlight);
            try {
              localStorage.setItem(SPOTLIGHT_KEY, spotlight ? 'off' : 'on');
            } catch {
              /* storage unavailable */
            }
          }}
        >
          <circle cx="12" cy="12" r="8" /><circle cx="12" cy="12" r="3" />
        </ToolButton>
        <ToolButton
          label={minimap ? 'Hide the minimap' : 'Show the minimap'}
          active={minimap}
          onClick={() => {
            setMinimap(!minimap);
            try {
              localStorage.setItem(MINIMAP_KEY, minimap ? 'off' : 'on');
            } catch {
              /* storage unavailable */
            }
          }}
        >
          <rect x="3" y="5" width="18" height="14" rx="2" /><rect x="12" y="11" width="6" height="5" rx="1" />
        </ToolButton>
      </Panel>

      <Panel position="bottom-center"><ZoomPill /></Panel>
      <Panel position="bottom-left"><LeftChip /></Panel>
      <ContextMenuHost anyPinned={anyPinned} />
      {minimap && (
        <MiniMap
          pannable
          zoomable
          position="bottom-right"
          nodeStrokeWidth={2}
          nodeColor={(n) => ((n.data as { node?: ConceptNode })?.node?.status === 'stub' ? '#d9d3b8' : (TONE_HEX[(n.data as { node?: ConceptNode })?.node?.color ?? ((n.data as { depth?: number })?.depth ?? 0) % TONES] as string))}
          ariaLabel="Minimap"
        />
      )}
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
