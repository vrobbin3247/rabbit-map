import { useEffect, useRef } from 'react';
import type { ConceptNode } from '@mindmapper/shared';
import { useStore } from '../state/store';
import { Markdown } from './Markdown';

export function Thread({ node }: { node: ConceptNode }) {
  const stream = useStore((s) => s.streams[node.id]);
  const busy = !!stream;
  const section = useRef<HTMLElement>(null);
  const seen = useRef({ id: node.id, count: node.thread.length });

  // When a question is added to the node on screen, bring it into view so the answer is not below the fold.
  useEffect(() => {
    const prev = seen.current;
    if (prev.id === node.id && node.thread.length > prev.count) section.current?.scrollIntoView({ block: 'start', behavior: 'smooth' });
    seen.current = { id: node.id, count: node.thread.length };
  }, [node.id, node.thread.length]);

  if (!node.thread.length) return null;
  return (
    <section ref={section} aria-label="Questions" className="mt-6 flex scroll-mt-2 flex-col gap-3">
      <h3 className="m-0 text-xs font-semibold uppercase tracking-wide muted">Questions</h3>
      {node.thread.map((m) =>
        m.role === 'user' ? (
          <div key={m.id} className="group rounded-lg bg-[var(--accent-soft)] px-3 py-2">
            {m.quote && <blockquote className="m-0 mb-1 border-l-2 border-[var(--accent)] pl-2 text-xs muted">{m.quote}</blockquote>}
            <div className="flex items-start justify-between gap-2">
              <span className="whitespace-pre-wrap">{m.text}</span>
              <button className="btn btn-ghost btn-sm opacity-0 group-hover:opacity-100 focus:opacity-100" disabled={busy} onClick={() => void useStore.getState().deleteMessage(node.id, m.id)} aria-label="Delete this question and its answer">✕</button>
            </div>
          </div>
        ) : (
          <div key={m.id} className="px-1">
            {m.status === 'generating' ? (
              stream?.kind === 'ask' && stream.text ? (
                <Markdown text={stream.text} fromNodeId={node.id} />
              ) : (
                <div className="flex flex-col gap-2" aria-busy="true">
                  <div className="skeleton w-11/12" />
                  <div className="skeleton w-3/4" />
                  <span className="text-xs muted">{stream?.phase === 'queued' ? 'Waiting…' : 'Writing the answer…'}</span>
                </div>
              )
            ) : m.status === 'error' ? (
              <div className="banner error rounded-lg">
                <span className="flex-1">{m.error?.message ?? 'Could not write this answer.'}</span>
                <button className="btn btn-sm" disabled={busy} onClick={() => void useStore.getState().retryAsk(node.id, m.id)}>Try again</button>
                <button className="btn btn-sm" disabled={busy} onClick={() => void useStore.getState().deleteMessage(node.id, m.id)}>Remove</button>
              </div>
            ) : (
              <Markdown text={m.text} fromNodeId={node.id} />
            )}
          </div>
        ),
      )}
    </section>
  );
}
