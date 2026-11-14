import { useEffect, useMemo, useRef, useState } from 'react';
import { useStore } from '../state/store';
import { buildTrailTree, filterTrail, trailAncestors, type TrailNode } from './trailTree';

const Svg = ({ children, size = 14 }: { children: React.ReactNode; size?: number }) => (
  <svg className="sk" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    {children}
  </svg>
);

interface RowProps {
  node: TrailNode;
  titleOf: (id: string) => string;
  currentId: string | null;
  anchorId: string;
  collapsed: Set<string>;
  toggle: (id: string) => void;
  keep: Set<string> | null;
  last: boolean;
}

/** One card in the journey, with its elbow connector and its own sub-journey below it. */
function Row({ node, titleOf, currentId, anchorId, collapsed, toggle, keep, last }: RowProps) {
  const visible = node.children.filter((c) => !keep || keep.has(c.id));
  const isOpen = keep ? true : !collapsed.has(node.id);
  const current = node.id === currentId;
  const ref = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (current) ref.current?.scrollIntoView({ block: 'nearest' });
  }, [current]);
  return (
    <li className={`tt-item ${last ? 'last' : ''} ${node.direct ? '' : 'jump'}`}>
      <div className="tt-row">
        {visible.length > 0 ? (
          <button className="tt-caret" aria-label={`${isOpen ? 'Fold' : 'Unfold'} ${titleOf(node.id)}`} aria-expanded={isOpen} onClick={() => toggle(node.id)} disabled={!!keep}>
            <Svg size={12}>{isOpen ? <path d="M5 8l7 8 7-8z" fill="currentColor" /> : <path d="M8 5l8 7-8 7z" fill="currentColor" />}</Svg>
          </button>
        ) : (
          <span className="tt-caret" aria-hidden />
        )}
        <button
          ref={ref}
          className={`tt-title ${current ? 'now' : ''}`}
          aria-current={current ? 'step' : undefined}
          title={titleOf(node.id)}
          onClick={() => useStore.getState().select(node.id)}
        >
          <span className="truncate">{titleOf(node.id)}</span>
          {node.id === anchorId && <span className="tt-badge" title="Anchor" aria-label="anchor"><Svg size={13}><circle cx="12" cy="5" r="2.5" /><path d="M12 7.5V21M6 11h12M5 14c0 4 3 7 7 7s7-3 7-7" /></Svg></span>}
          {node.visits > 1 && <span className="tt-count" title={`Visited ${node.visits} times`}>×{node.visits}</span>}
          {current && <span className="tt-badge pin" title="You are here" aria-label="you are here"><Svg size={14}><path d="M12 21s-6.5-5.6-6.5-11a6.5 6.5 0 0113 0c0 5.4-6.5 11-6.5 11z" /><circle cx="12" cy="10" r="2.3" /></Svg></span>}
        </button>
      </div>
      {visible.length > 0 && isOpen && (
        <ul className="tt-list">
          {visible.map((c, i) => (
            <Row key={c.id} node={c} titleOf={titleOf} currentId={currentId} anchorId={anchorId} collapsed={collapsed} toggle={toggle} keep={keep} last={i === visible.length - 1} />
          ))}
        </ul>
      )}
    </li>
  );
}

export function Trail() {
  const map = useStore((s) => s.map)!;
  const open = useStore((s) => s.trailOpen);
  const [query, setQuery] = useState('');
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const currentId = map.view.selectedId;
  const tree = useMemo(() => buildTrailTree(map, map.view.trail), [map]);
  const titleOf = (id: string) => map.nodes[id]?.title ?? '';
  const keep = filterTrail(tree, titleOf, query);

  // Whatever you land on is always shown: unfold the cards above it.
  useEffect(() => {
    if (!currentId) return;
    const above = trailAncestors(tree, currentId);
    setCollapsed((c) => (above.some((id) => c.has(id)) ? new Set([...c].filter((id) => !above.includes(id))) : c));
  }, [currentId, tree]);

  if (!open) {
    return (
      <div className="flex h-full w-9 shrink-0 flex-col items-center border-r-2 border-[var(--ink)] bg-[var(--panel)] py-2">
        <button className="btn btn-ghost btn-sm" aria-label="Show trail" title="Show trail" onClick={() => useStore.getState().set({ trailOpen: true })}>»</button>
      </div>
    );
  }
  const toggle = (id: string) =>
    setCollapsed((c) => {
      const next = new Set(c);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const shown = tree.filter((n) => !keep || keep.has(n.id));

  return (
    <nav aria-label="Trail" className="flex h-full w-[17rem] shrink-0 flex-col border-r-2 border-[var(--ink)] bg-[var(--panel)]">
      <div className="flex items-center justify-between gap-2 px-3 pt-2">
        <h2 className="m-0 text-base uppercase tracking-wide">Trail</h2>
        <div className="flex items-center gap-1">
          <button className="btn btn-ghost btn-sm" title="Forget the journey so far (keeps the card you are on)" disabled={map.view.trail.length < 2} onClick={() => useStore.getState().clearTrail()}>Clear</button>
          <button className="btn btn-ghost btn-sm" aria-label="Hide trail" onClick={() => useStore.getState().set({ trailOpen: false })}>«</button>
        </div>
      </div>
      <label className="tt-search">
        <Svg size={15}><circle cx="11" cy="11" r="6.5" /><path d="M16 16l4.5 4.5" /></Svg>
        <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search trail…" aria-label="Search trail" maxLength={80} />
      </label>
      <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-3">
        {keep && shown.length === 0 ? (
          <p className="muted m-2 text-sm">Nothing in your trail matches “{query.trim()}”.</p>
        ) : (
          <ul className="tt-list root">
            {shown.map((n, i) => (
              <Row key={n.id} node={n} titleOf={titleOf} currentId={currentId} anchorId={map.view.anchorId} collapsed={collapsed} toggle={toggle} keep={keep} last={i === shown.length - 1} />
            ))}
          </ul>
        )}
      </div>
    </nav>
  );
}
