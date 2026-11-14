import { useEffect, useRef, useState } from 'react';
import { subtreeOf, type ConceptNode } from '@mindmapper/shared';
import { useStore } from '../state/store';
import { ConfirmDialog, Dialog, PromptDialog } from '../ui/Dialog';
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

function MergeDialog({ node, onClose }: { node: ConceptNode; onClose: () => void }) {
  const map = useStore((s) => s.map)!;
  const [q, setQ] = useState('');
  const banned = new Set(subtreeOf(map, node.id));
  const list = Object.values(map.nodes)
    .filter((n) => !banned.has(n.id) && n.title.toLowerCase().includes(q.toLowerCase()))
    .slice(0, 40);
  return (
    <Dialog title={`Merge “${node.title}” into…`} onClose={onClose}>
      <p className="m-0 text-xs muted">Its children and questions move to the node you pick. Links to its name keep working.</p>
      <input className="field" autoFocus placeholder="Find a node" value={q} onChange={(e) => setQ(e.target.value)} />
      <ul className="m-0 flex-1 list-none overflow-y-auto p-0">
        {list.map((n) => (
          <li key={n.id}>
            <button
              className="btn btn-ghost w-full justify-start"
              onClick={async () => {
                if (await useStore.getState().mergeNode(node.id, n.id)) onClose();
              }}
            >
              {n.title}
            </button>
          </li>
        ))}
        {!list.length && <li className="muted">No matching node.</li>}
      </ul>
    </Dialog>
  );
}

function NodeMenu({ node }: { node: ConceptNode }) {
  const map = useStore((s) => s.map)!;
  const [open, setOpen] = useState(false);
  const [dlg, setDlg] = useState<null | 'rename' | 'merge' | 'delete'>(null);
  const busy = useStore((s) => Object.keys(s.streams).length > 0);
  const st = useStore.getState;
  const isRoot = node.id === map.rootId;
  const size = subtreeOf(map, node.id).length;
  const hasKids = size > 1;

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (!(e.target as HTMLElement).closest('[data-node-menu]')) setOpen(false);
    };
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', esc);
    return () => {
      document.removeEventListener('mousedown', close);
      document.removeEventListener('keydown', esc);
    };
  }, [open]);

  const item = (label: string, fn: () => void, disabled = false) => (
    <button
      role="menuitem"
      disabled={disabled}
      onClick={() => {
        setOpen(false);
        fn();
      }}
    >
      {label}
    </button>
  );

  return (
    <div className="relative" data-node-menu>
      <button className="btn btn-sm" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen(!open)} aria-label="Node actions">⋯</button>
      {open && (
        <div className="menu" role="menu">
          {item('Set as anchor', () => st().setAnchor(node.id), map.view.anchorId === node.id)}
          {item('Regenerate', () => void st().explain(node.id, true), busy || node.status === 'stub' || node.status === 'generating')}
          {item('Rename…', () => setDlg('rename'))}
          {item('Merge into…', () => setDlg('merge'), isRoot)}
          {item(node.collapsed ? 'Expand subtree' : 'Collapse subtree', () => void st().toggleCollapse(node.id), !hasKids)}
          {item('Delete…', () => setDlg('delete'), isRoot || busy)}
        </div>
      )}
      {dlg === 'rename' && (
        <PromptDialog
          title="Rename node"
          initial={node.title}
          onClose={() => setDlg(null)}
          onSubmit={async (v) => {
            if (await st().renameNode(node.id, v)) setDlg(null);
          }}
        />
      )}
      {dlg === 'merge' && <MergeDialog node={node} onClose={() => setDlg(null)} />}
      {dlg === 'delete' && (
        <ConfirmDialog
          title="Delete node"
          danger
          confirm={size > 1 ? `Delete ${size} nodes` : 'Delete'}
          message={size > 1 ? `“${node.title}” and ${size - 1} node${size > 2 ? 's' : ''} below it will be deleted. Links to them become ghost links.` : `“${node.title}” will be deleted. Links to it become ghost links.`}
          onClose={() => setDlg(null)}
          onConfirm={() => {
            setDlg(null);
            void st().deleteNode(node.id);
          }}
        />
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
  const children = (index.children.get(node.id) ?? []).map((id) => map.nodes[id]).filter((n): n is ConceptNode => !!n);
  const mentioned = [...(index.backLinks.get(node.id) ?? [])].map((id) => map.nodes[id]).filter((n): n is ConceptNode => !!n);
  const related = node.related.map((id) => map.nodes[id]).filter((n): n is ConceptNode => !!n);
  const go = (id: string) => useStore.getState().select(id);
  const chip = (n: ConceptNode) => (
    <button key={n.id} className={`chip ${n.status === 'stub' ? 'stub' : ''}`} onClick={() => go(n.id)} title={n.summary || n.title}>{n.title}</button>
  );

  return (
    <aside className="flex h-full min-h-0 flex-col bg-[var(--panel)]" aria-label={`Node: ${node.title}`}>
      <header className="flex items-start justify-between gap-2 border-b border-[var(--border)] px-4 py-3">
        <div className="min-w-0">
          <h2 ref={heading} tabIndex={-1} className="m-0 text-lg font-semibold leading-tight outline-none">{node.title}</h2>
          {node.aliases.length > 0 && <div className="text-xs muted">also: {node.aliases.join(', ')}</div>}
        </div>
        <NodeMenu node={node} />
      </header>

      <div ref={scroll} className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
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
          <section className="mt-6"><h3 className="m-0 mb-2 text-xs font-semibold uppercase tracking-wide muted">Next concepts</h3><div className="flex flex-wrap gap-2">{children.map(chip)}</div></section>
        )}
        {related.length > 0 && (
          <section className="mt-5"><h3 className="m-0 mb-2 text-xs font-semibold uppercase tracking-wide muted">See also</h3><div className="flex flex-wrap gap-2">{related.map(chip)}</div></section>
        )}
        {mentioned.length > 0 && (
          <section className="mt-5"><h3 className="m-0 mb-2 text-xs font-semibold uppercase tracking-wide muted">Mentioned in</h3><div className="flex flex-wrap gap-2">{mentioned.map(chip)}</div></section>
        )}
        <Thread node={node} />
      </div>
      <AskBox node={node} />
    </aside>
  );
}
