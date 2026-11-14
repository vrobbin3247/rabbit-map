import { useEffect, useState, type RefObject } from 'react';
import { useStore } from '../state/store';

interface Sel {
  text: string;
  snippet: string;
  x: number;
  y: number;
}

/** Shows "Explain this" and "Ask about this" for text selected inside `container`. */
export function SelectionPopover({ container, nodeId }: { container: RefObject<HTMLElement | null>; nodeId: string }) {
  const [sel, setSel] = useState<Sel | null>(null);

  useEffect(() => {
    const read = () => {
      const s = window.getSelection();
      const root = container.current;
      if (!s || s.isCollapsed || !root || !s.anchorNode || !root.contains(s.anchorNode) || !root.contains(s.focusNode)) return setSel(null);
      const text = s.toString().replace(/\s+/g, ' ').trim();
      if (!text) return setSel(null);
      const r = s.getRangeAt(0).getBoundingClientRect();
      const para = (s.anchorNode.parentElement?.closest('p, li, blockquote') ?? s.anchorNode.parentElement)?.textContent ?? text;
      setSel({ text, snippet: para.trim().slice(0, 400), x: Math.max(8, r.left + r.width / 2 - 100), y: Math.max(8, r.top - 44) });
    };
    const onUp = () => window.setTimeout(read, 0);
    const onChange = () => {
      if (window.getSelection()?.isCollapsed) setSel(null);
    };
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setSel(null);
    document.addEventListener('mouseup', onUp);
    document.addEventListener('keyup', onUp);
    document.addEventListener('selectionchange', onChange);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mouseup', onUp);
      document.removeEventListener('keyup', onUp);
      document.removeEventListener('selectionchange', onChange);
      document.removeEventListener('keydown', onKey);
    };
  }, [container]);

  useEffect(() => {
    setSel(null);
  }, [nodeId]);
  if (!sel) return null;
  const canExplain = sel.text.length >= 1 && sel.text.length <= 80;
  const done = () => {
    window.getSelection()?.removeAllRanges();
    setSel(null);
  };
  return (
    <div className="popover" style={{ left: sel.x, top: sel.y }} role="toolbar" aria-label="Selection actions" onMouseDown={(e) => e.preventDefault()}>
      <button
        className="btn btn-sm"
        disabled={!canExplain}
        title={canExplain ? undefined : 'Select 80 characters or fewer'}
        onClick={() => {
          void useStore.getState().openConcept(nodeId, sel.text, sel.snippet);
          done();
        }}
      >
        Explain this
      </button>
      <button
        className="btn btn-sm"
        onClick={() => {
          useStore.getState().set({ askQuote: sel.text.slice(0, 600) });
          useStore.getState().focusAsk();
          done();
        }}
      >
        Ask about this
      </button>
    </div>
  );
}
