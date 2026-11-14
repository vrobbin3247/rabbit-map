import { pathOf } from '@mindmapper/shared';
import { useStore } from '../state/store';

export function Breadcrumb() {
  const map = useStore((s) => s.map)!;
  const id = map.view.selectedId;
  if (!id) return null;
  const path = pathOf(map, id);
  const MAX = 5;
  const shown = path.length > MAX ? [path[0] as string, '…', ...path.slice(-(MAX - 2))] : path;
  const hidden = path.length > MAX ? path.slice(1, path.length - (MAX - 2)) : [];
  return (
    <nav aria-label="Path from the root" className="flex min-w-0 items-center gap-1 overflow-hidden text-lg">
      {shown.map((p, i) =>
        p === '…' ? (
          <span key="gap" className="muted" title={hidden.map((h) => map.nodes[h]?.title).join(' › ')}>… ›</span>
        ) : (
          <span key={p} className={`flex items-center gap-1 ${p === id ? 'flex-none' : 'min-w-0'}`}>
            <button
              className={`truncate rounded px-1 ${p === id ? 'crumb-now' : 'muted hover:bg-[var(--sunken)]'}`}
              aria-current={p === id ? 'page' : undefined}
              onClick={() => useStore.getState().select(p)}
              title={map.nodes[p]?.title}
              style={{ maxWidth: p === id ? 280 : 180 }}
            >
              {map.nodes[p]?.title}
            </button>
            {i < shown.length - 1 && <span className="muted">›</span>}
          </span>
        ),
      )}
    </nav>
  );
}
