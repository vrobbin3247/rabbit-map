import { useMemo, useState } from 'react';
import { progress, unopened } from '@mindmapper/shared';
import { useStore } from '../state/store';
import { Dialog } from '../ui/Dialog';

/** "What's left": every card not yet explained, grouped by where it hangs, with progress. */
export function LeftDialog() {
  const map = useStore((s) => s.map)!;
  const index = useStore((s) => s.index)!;
  const streams = useStore((s) => s.streams);
  const [branchOnly, setBranchOnly] = useState(false);
  const selectedId = map.view.selectedId;
  const selected = selectedId ? map.nodes[selectedId] : undefined;
  const groups = useMemo(() => unopened(map, index, branchOnly && selectedId ? selectedId : undefined), [map, index, branchOnly, selectedId]);
  const p = progress(map);
  const close = () => useStore.getState().set({ leftOpen: false });
  const count = groups.reduce((n, g) => n + g.items.length, 0);
  const pct = p.total ? Math.round((p.explained / p.total) * 100) : 0;

  return (
    <Dialog label="What's left" onClose={close}>
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="m-0 text-base font-semibold">What's left</h2>
        <span className="text-sm muted">{p.explained} of {p.total} cards explained</span>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-[var(--sunken)]" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label="Cards explained">
        <div className="h-full rounded-full bg-[var(--accent)]" style={{ width: `${pct}%` }} />
      </div>
      {selected && selected.id !== map.rootId && (
        <label className="flex cursor-pointer items-center gap-2 text-sm">
          <input type="checkbox" checked={branchOnly} onChange={(e) => setBranchOnly(e.target.checked)} />
          Only under “{selected.title}”
        </label>
      )}
      <div className="min-h-0 flex-1 overflow-y-auto">
        {count === 0 ? (
          <p className="muted">{branchOnly ? 'Nothing is left under this card.' : 'Every card has been explained. Ask questions to grow the map further.'}</p>
        ) : (
          groups.map((g) => (
            <section key={g.parentId} className="mb-3" aria-label={`Under ${g.parentTitle}`}>
              <h3 className="m-0 mb-1 text-xs font-semibold uppercase tracking-wide muted">Under {g.parentTitle}</h3>
              <ul className="m-0 list-none p-0">
                {g.items.map((i) => {
                  const busy = !!streams[i.id];
                  return (
                    <li key={i.id} className="flex items-center gap-2 rounded-lg px-2 py-1.5 hover:bg-[var(--sunken)]">
                      <div className="min-w-0 flex-1">
                        <div className="truncate font-medium">{i.status === 'error' && '⚠ '}{i.title}</div>
                        {i.summary && <div className="truncate text-xs muted">{i.summary}</div>}
                      </div>
                      <button
                        className="btn btn-sm"
                        onClick={() => {
                          useStore.getState().select(i.id);
                          close();
                        }}
                      >
                        Open
                      </button>
                      {busy ? (
                        <button className="btn btn-sm" onClick={() => useStore.getState().stop(i.id)}>Writing… Stop</button>
                      ) : (
                        <button className="btn btn-sm btn-primary" onClick={() => void useStore.getState().explain(i.id)}>
                          {i.status === 'error' ? 'Try again' : 'Explain'}
                        </button>
                      )}
                    </li>
                  );
                })}
              </ul>
            </section>
          ))
        )}
      </div>
      <div className="flex justify-end"><button className="btn" onClick={close} autoFocus>Close</button></div>
    </Dialog>
  );
}
