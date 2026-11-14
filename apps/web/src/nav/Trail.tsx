import { useEffect, useRef } from 'react';
import { useStore } from '../state/store';

export function Trail() {
  const map = useStore((s) => s.map)!;
  const index = useStore((s) => s.index)!;
  const open = useStore((s) => s.trailOpen);
  const end = useRef<HTMLLIElement>(null);
  const trail = map.view.trail;
  useEffect(() => {
    end.current?.scrollIntoView({ block: 'nearest' });
  }, [trail.length, open]);

  if (!open) {
    return (
      <div className="flex h-full w-9 shrink-0 flex-col items-center border-r-2 border-[var(--ink)] bg-[var(--panel)] py-2">
        <button className="btn btn-ghost btn-sm" aria-label="Show trail" title="Show trail" onClick={() => useStore.getState().set({ trailOpen: true })}>»</button>
      </div>
    );
  }
  return (
    <nav aria-label="Trail" className="flex h-full w-52 shrink-0 flex-col border-r-2 border-[var(--ink)] bg-[var(--panel)]">
      <div className="flex items-center justify-between px-3 py-2">
        <h2 className="m-0 text-xs font-semibold uppercase tracking-wide muted">Trail</h2>
        <button className="btn btn-ghost btn-sm" aria-label="Hide trail" onClick={() => useStore.getState().set({ trailOpen: false })}>«</button>
      </div>
      <ol className="m-0 min-h-0 flex-1 list-none overflow-y-auto p-0 pb-2">
        {trail.map((id, i) => {
          const n = map.nodes[id];
          if (!n) return null;
          const current = i === trail.length - 1;
          return (
            <li key={`${i}-${id}`} ref={current ? end : undefined} style={{ paddingLeft: 8 + Math.min(index.depth.get(id) ?? 0, 8) * 10 }}>
              <button
                className={`w-full truncate rounded px-2 py-0.5 text-left text-[13px] ${current ? 'bg-[var(--accent-soft)] font-semibold text-[var(--accent)]' : 'hover:bg-[var(--sunken)]'}`}
                aria-current={current ? 'step' : undefined}
                title={n.title}
                onClick={() => useStore.getState().select(id)}
              >
                {n.title}
              </button>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
