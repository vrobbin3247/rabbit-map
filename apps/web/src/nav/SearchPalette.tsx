import { useMemo, useState } from 'react';
import { pathOf, toSlug, type ConceptNode } from '@mindmapper/shared';
import { useStore } from '../state/store';
import { Dialog } from '../ui/Dialog';

export function searchNodes(nodes: ConceptNode[], q: string, limit = 30): ConceptNode[] {
  const needle = q.trim().toLowerCase();
  const slug = toSlug(q);
  if (!needle) return nodes.slice(0, limit);
  const scored: [number, ConceptNode][] = [];
  for (const n of nodes) {
    const names = [n.title, ...n.aliases];
    let best = 99;
    for (const name of names) {
      const l = name.toLowerCase();
      if (l === needle || (slug && toSlug(name) === slug)) best = Math.min(best, 0);
      else if (l.startsWith(needle)) best = Math.min(best, 1);
      else if (l.includes(needle)) best = Math.min(best, 2);
    }
    if (best < 99) scored.push([best, n]);
  }
  // Better match class first, then the shorter (closer) title, then alphabetical.
  return scored
    .sort((a, b) => a[0] - b[0] || a[1].title.length - b[1].title.length || a[1].title.localeCompare(b[1].title))
    .slice(0, limit)
    .map((x) => x[1]);
}

export function SearchPalette() {
  const map = useStore((s) => s.map)!;
  const [q, setQ] = useState('');
  const [active, setActive] = useState(0);
  const results = useMemo(() => searchNodes(Object.values(map.nodes), q), [map, q]);
  const close = () => useStore.getState().set({ searchOpen: false });
  const go = (n: ConceptNode) => {
    useStore.getState().select(n.id);
    close();
  };
  return (
    <Dialog label="Search nodes" onClose={close}>
      <input
        className="field"
        autoFocus
        role="combobox"
        aria-label="Find a node"
        aria-expanded="true"
        aria-controls="search-results"
        placeholder="Find a node by name…"
        value={q}
        onChange={(e) => {
          setQ(e.target.value);
          setActive(0);
        }}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') {
            e.preventDefault();
            setActive((a) => Math.min(a + 1, results.length - 1));
          } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            setActive((a) => Math.max(a - 1, 0));
          } else if (e.key === 'Enter' && results[active]) go(results[active] as ConceptNode);
        }}
      />
      <ul id="search-results" role="listbox" className="m-0 min-h-0 flex-1 list-none overflow-y-auto p-0">
        {results.map((n, i) => (
          <li key={n.id} role="option" aria-selected={i === active}>
            <button className={`btn btn-ghost w-full flex-col items-start gap-0 text-left ${i === active ? 'btn-hl' : ''}`} onClick={() => go(n)} onMouseEnter={() => setActive(i)}>
              <span className="font-medium">{n.title}</span>
              <span className="text-xs muted">{pathOf(map, n.id).map((p) => map.nodes[p]?.title).join(' › ')}</span>
            </button>
          </li>
        ))}
        {!results.length && <li className="px-2 py-3 muted">No node matches “{q}”.</li>}
      </ul>
    </Dialog>
  );
}
