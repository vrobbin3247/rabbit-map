import { useEffect, useRef, useState } from 'react';
import type { ConceptNode } from '@mindmapper/shared';
import { LIMITS } from '@mindmapper/shared';
import { useStore } from '../state/store';

export function AskBox({ node }: { node: ConceptNode }) {
  const [text, setText] = useState('');
  const ref = useRef<HTMLTextAreaElement>(null);
  const quote = useStore((s) => s.askQuote);
  const tick = useStore((s) => s.askFocusTick);
  const busy = useStore((s) => !!s.streams[node.id]);

  useEffect(() => {
    if (tick > 0) ref.current?.focus();
  }, [tick]);
  useEffect(() => {
    if (quote) ref.current?.focus();
  }, [quote]);

  const send = () => {
    const q = text.trim();
    if (!q || busy) return;
    setText('');
    void useStore.getState().ask(node.id, q);
  };

  return (
    <div className="border-t-2 border-[var(--ink)] bg-[var(--panel)] p-3">
      {quote && (
        <div className="mb-2 flex items-start gap-2 rounded-lg bg-[var(--sunken)] px-2 py-1 text-xs">
          <span className="flex-1 italic muted">“{quote}”</span>
          <button className="btn btn-ghost btn-sm" aria-label="Remove quote" onClick={() => useStore.getState().set({ askQuote: null })}>✕</button>
        </div>
      )}
      <div className="flex items-end gap-2">
        <textarea
          ref={ref}
          className="field min-h-[38px] resize-none"
          rows={2}
          value={text}
          maxLength={LIMITS.questionMax}
          placeholder={`Ask about ${node.title}…`}
          aria-label={`Ask about ${node.title}`}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              send();
            }
          }}
        />
        <button className="btn btn-primary" disabled={busy || !text.trim()} onClick={send}>Ask</button>
      </div>
    </div>
  );
}
