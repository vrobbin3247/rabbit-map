import { useEffect, useRef, useState } from 'react';
import type { ConceptNode } from '@mindmapper/shared';
import { toneOf } from '../canvas/ConceptNodeView';
import { useStore } from '../state/store';
import { nodeMenu } from '../nav/nodeActions';
import { MenuList } from '../ui/MenuList';
import { AskBox } from './AskBox';
import { Markdown } from './Markdown';
import { SelectionPopover } from './SelectionPopover';
import { Thread } from './Thread';

function Elapsed({ since }: { since: number }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), 500);
    return () => window.clearInterval(t);
  }, []);
  return <span>{Math.max(0, Math.floor((now - since) / 1000))} s</span>;
}

function Skeleton({ since, phase, streams }: { since: number; phase: string | null; streams: boolean }) {
  const label = phase === 'queued' ? 'Waiting for other requests…' : phase === 'retrying' ? 'Retrying…' : phase === 'starting' || !phase ? 'Starting…' : 'Writing…';
  return (
    <div className="flex flex-col gap-2" aria-busy="true">
      <div className="skeleton w-full" />
      <div className="skeleton w-11/12" />
      <div className="skeleton w-4/5" />
      <p className="m-0 text-xs muted">
        {label} <Elapsed since={since} />
        {!streams && ' · this provider shows the whole text at once'}
      </p>
    </div>
  );
}

function NodeMenu({ node }: { node: ConceptNode }) {
  const map = useStore((s) => s.map)!;
  const index = useStore((s) => s.index)!;
  const busy = useStore((s) => Object.keys(s.streams).length > 0);
  const streaming = useStore((s) => !!s.streams[node.id]);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (!(e.target as HTMLElement).closest('[data-node-menu]')) setOpen(false);
    };
    const esc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', close);
    window.addEventListener('keydown', esc, true);
    return () => {
      document.removeEventListener('mousedown', close);
      window.removeEventListener('keydown', esc, true);
    };
  }, [open]);

  return (
    <div className="relative" data-node-menu>
      <button className="btn btn-sm btn-more" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen(!open)} aria-label="Node actions">⋯</button>
      {open && (
        <div className="menu">
          <MenuList entries={nodeMenu(map, index, node, { busy, streaming })} onDone={() => setOpen(false)} label="Node actions" />
        </div>
      )}
    </div>
  );
}

export function NodePanel() {
  const map = useStore((s) => s.map)!;
  const index = useStore((s) => s.index)!;
  const health = useStore((s) => s.health);
  const node = map.view.selectedId ? map.nodes[map.view.selectedId] : undefined;
  const stream = useStore((s) => (node ? s.streams[node.id] : undefined));
  const scroll = useRef<HTMLDivElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    scroll.current?.scrollTo({ top: 0 });
  }, [node?.id]);

  if (!node) return <aside className="flex h-full items-center justify-center p-6 muted">Select a node.</aside>;

  const provider = health?.providers.find((p) => p.id === map.settings.provider);
  const streams = provider?.streams ?? true;
  const generating = node.status === 'generating' || (stream?.kind === 'expand');
  const depthNow = index.depth.get(node.id) ?? 0;
  const children = (index.children.get(node.id) ?? []).map((id) => map.nodes[id]).filter((n): n is ConceptNode => !!n);
  const mentioned = [...(index.backLinks.get(node.id) ?? [])].map((id) => map.nodes[id]).filter((n): n is ConceptNode => !!n);
  const ghosts = index.ghostTargets.get(node.id) ?? [];
  const related = node.related.map((id) => map.nodes[id]).filter((n): n is ConceptNode => !!n);
  const go = (id: string) => useStore.getState().select(id);
  const chip = (n: ConceptNode) => (
    <button key={n.id} className={`chip ${n.status === 'stub' ? 'stub' : ''}`} data-tone={toneOf(n, index.depth.get(n.id) ?? 0)} onClick={() => go(n.id)} title={n.summary || n.title}>{n.title}</button>
  );

  return (
    <aside className="flex h-full min-h-0 flex-col bg-[var(--panel)]" aria-label={`Node: ${node.title}`}>
      <header className="flex items-start justify-between gap-2 border-b-2 border-dashed border-[var(--ink-soft)] px-4 py-3">
        <div className="min-w-0">
          <h2 ref={heading} tabIndex={-1} className="m-0 text-lg font-semibold leading-tight outline-none">{node.title}</h2>
          {node.aliases.length > 0 && <div className="text-xs muted">also: {node.aliases.join(', ')}</div>}
          <div className={`text-xs ${depthNow >= 5 ? 'text-[var(--warn)]' : 'muted'}`} title={depthNow >= 5 ? 'You are deep in a branch. The anchor takes you back.' : 'Levels below the root'}>
            <span>depth {depthNow}</span>
          </div>
        </div>
        <NodeMenu node={node} />
      </header>

      <div ref={scroll} className="min-h-0 flex-1 overflow-y-auto px-5 pb-6 pt-5">
        <div className="sr-only" aria-live="polite">{node.status === 'ready' ? `${node.title} is ready.` : ''}</div>
        {generating ? (
          <>
            {stream?.kind === 'expand' && stream.text ? (
              <Markdown text={stream.text} fromNodeId={node.id} />
            ) : (
              <Skeleton since={stream?.startedAt ?? Date.now()} phase={stream?.phase ?? null} streams={streams} />
            )}
            <div className="mt-3"><button className="btn btn-sm" onClick={() => useStore.getState().stop(node.id)}>Stop <span className="kbd">Esc</span></button></div>
          </>
        ) : node.status === 'ready' && node.body ? (
          <Markdown text={node.body} fromNodeId={node.id} />
        ) : node.status === 'error' ? (
          <div className="banner error rounded-lg">
            <span className="flex-1">{node.error?.message ?? 'Could not write this.'}</span>
            <button className="btn btn-sm" onClick={() => void useStore.getState().explain(node.id)}>Try again</button>
          </div>
        ) : (
          <div className="flex flex-col items-start gap-3">
            <p className="m-0 muted">{node.summary || 'Not explained yet.'}</p>
            {node.origin?.snippet && <p className="m-0 border-l-2 border-[var(--border)] pl-2 text-xs muted">Introduced in: “{node.origin.snippet}”</p>}
            <button className="btn btn-primary" onClick={() => void useStore.getState().explain(node.id)}>Explain</button>
          </div>
        )}
        <SelectionPopover container={scroll} nodeId={node.id} />

        {children.length > 0 && (
          <section className="mt-9"><h3 className="m-0 mb-3 text-xs font-semibold uppercase tracking-wide muted">Next concepts</h3><div className="flex flex-wrap gap-2">{children.map(chip)}</div></section>
        )}
        {ghosts.length > 0 && (
          <section className="mt-7" aria-label="Mentioned but not added">
            <h3 className="m-0 mb-2 flex items-center justify-between gap-2 text-xs font-semibold uppercase tracking-wide muted">
              <span>Mentioned, no card yet</span>
              <button className="btn btn-sm normal-case tracking-normal" onClick={() => void useStore.getState().adoptGhosts(node.id)}>
                Add all {ghosts.length}
              </button>
            </h3>
            <div className="flex flex-wrap gap-2">
              {ghosts.map((g) => (
                <button key={g} className="chip stub" title="Not opened yet. Click to add it and have it explained." onClick={() => void useStore.getState().openConcept(node.id, g)}>
                  {g}
                </button>
              ))}
            </div>
          </section>
        )}
        {related.length > 0 && (
          <section className="mt-7"><h3 className="m-0 mb-3 text-xs font-semibold uppercase tracking-wide muted">See also</h3><div className="flex flex-wrap gap-2">{related.map(chip)}</div></section>
        )}
        {mentioned.length > 0 && (
          <section className="mt-7"><h3 className="m-0 mb-3 text-xs font-semibold uppercase tracking-wide muted">Mentioned in</h3><div className="flex flex-wrap gap-2">{mentioned.map(chip)}</div></section>
        )}
        <Thread node={node} />
      </div>
      <AskBox node={node} />
    </aside>
  );
}
