import { useCallback, useEffect, useState } from 'react';
import { MapCanvas } from './canvas/MapCanvas';
import { SearchPalette } from './nav/SearchPalette';
import { TopBar } from './nav/TopBar';
import { Trail } from './nav/Trail';
import { LeftDialog } from './panel/LeftDialog';
import { NodeDialogs } from './panel/NodeDialogs';
import { NodePanel } from './panel/NodePanel';
import { useStore } from './state/store';
import { Banners } from './ui/Banners';


const WIDTH_KEY = 'mindmapper.panelWidth';
function readWidth(): number {
  try {
    const v = Number(localStorage.getItem(WIDTH_KEY));
    return v >= 320 && v <= 800 ? v : 440;
  } catch {
    return 440;
  }
}

function typing(t: EventTarget | null): boolean {
  const el = t as HTMLElement | null;
  return !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable);
}

/** Keys that need the canvas or page, not a control, to have focus. */
function onCanvasOrPage(t: EventTarget | null): boolean {
  const el = t as HTMLElement | null;
  // The panel heading takes focus after a keyboard selection; arrows must keep working from there.
  return !el || el === document.body || !!el.closest('.react-flow') || el.matches('aside h2');
}

export function MapView() {
  const searchOpen = useStore((s) => s.searchOpen);
  const leftOpen = useStore((s) => s.leftOpen);
  const [width, setWidth] = useState(readWidth);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const st = useStore.getState();
      const map = st.map;
      if (!map || !st.index) return;
      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        return st.set({ searchOpen: !st.searchOpen });
      }
      if (st.searchOpen || document.querySelector('[role="dialog"]')) return;
      // The open-menu key works from the canvas, the page or the panel heading, like the arrow keys.
      if ((e.key === 'ContextMenu' || (e.shiftKey && e.key === 'F10')) && onCanvasOrPage(e.target)) {
        const id = map.view.selectedId;
        if (id) {
          e.preventDefault();
          const r = document.querySelector(`.react-flow__node[data-id="${id}"]`)?.getBoundingClientRect();
          st.set({ ctxMenu: { x: r ? r.left + r.width / 2 : window.innerWidth / 3, y: r ? r.top + r.height / 2 : window.innerHeight / 3, target: { kind: 'node', id } } });
        }
        return;
      }
      if (document.querySelector('[data-context-menu]')) return;
      // Cmd/Ctrl+Z undoes the last delete or merge, unless the learner is typing (then it undoes their typing).
      if (mod && !e.shiftKey && e.key.toLowerCase() === 'z' && !typing(e.target) && st.undo) {
        e.preventDefault();
        return void st.undoLast();
      }
      if (e.altKey && e.key === 'ArrowLeft') {
        e.preventDefault();
        return st.back();
      }
      if (e.altKey && e.key === 'ArrowRight') {
        e.preventDefault();
        return st.forwardNav();
      }
      if (e.key === 'Escape') {
        const sel = map.view.selectedId;
        if (sel && st.streams[sel]) st.stop(sel);
        return;
      }
      if (typing(e.target) || mod || e.altKey) return;
      if (e.key === '/') {
        e.preventDefault();
        return st.focusAsk();
      }
      if (!onCanvasOrPage(e.target)) return;
      if (e.key === 'a' || e.key === 'A') return st.goToAnchor();
      const sel = map.view.selectedId;
      const node = sel ? map.nodes[sel] : undefined;
      if (!sel || !node) return;
      if (e.key === 'Enter' && (node.status === 'stub' || node.status === 'error')) {
        e.preventDefault();
        return void st.explain(sel);
      }
      const siblings = node.parentId ? (st.index.children.get(node.parentId) ?? []) : [];
      const at = siblings.indexOf(sel);
      let target: string | undefined;
      if (e.key === 'ArrowLeft') target = node.parentId ?? undefined;
      else if (e.key === 'ArrowRight') target = st.index.children.get(sel)?.[0];
      else if (e.key === 'ArrowUp') target = siblings[at - 1];
      else if (e.key === 'ArrowDown') target = siblings[at + 1];
      else return;
      e.preventDefault();
      if (target) {
        st.select(target);
        document.querySelector<HTMLElement>('aside h2')?.focus();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // When the window becomes narrow, give the board the room: collapse the trail. (It stays the
  // learner's choice to open it again, and widening the window does not reopen it.)
  useEffect(() => {
    const mq = window.matchMedia?.('(max-width: 859px)');
    if (!mq) return;
    const onChange = (e: MediaQueryListEvent) => {
      if (e.matches) useStore.getState().set({ trailOpen: false });
    };
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);

  const startDrag = useCallback((e: React.PointerEvent) => {
    e.preventDefault();
    const move = (ev: PointerEvent) => setWidth(Math.min(800, Math.max(320, window.innerWidth - ev.clientX)));
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      setWidth((w) => {
        try {
          localStorage.setItem(WIDTH_KEY, String(w));
        } catch {
          /* storage unavailable */
        }
        return w;
      });
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  }, []);

  return (
    <div className="flex h-full flex-col">
      <Banners />
      <TopBar />
      {/* Wide: board and panel side by side. Narrow (under 860 px): the panel moves below the board. */}
      <div className="flex min-h-0 flex-1 flex-col min-[860px]:flex-row">
        <div className="flex min-h-0 min-w-0 flex-1">
          <Trail />
          <main className="relative min-h-0 min-w-0 flex-1" aria-label="Map">
            <MapCanvas />
          </main>
        </div>
        <div role="separator" aria-orientation="vertical" aria-label="Resize panel" tabIndex={0} className="hidden w-1.5 shrink-0 cursor-col-resize bg-[var(--border)] hover:bg-[var(--accent)] min-[860px]:block" onPointerDown={startDrag}
          onKeyDown={(e) => {
            if (e.key === 'ArrowLeft') setWidth((w) => Math.min(800, w + 20));
            if (e.key === 'ArrowRight') setWidth((w) => Math.max(320, w - 20));
          }} />
        <div
          style={{ '--panel-w': `${width}px` } as React.CSSProperties}
          className="h-[46%] min-h-0 shrink-0 border-t border-[var(--border)] min-[860px]:h-auto min-[860px]:w-[min(var(--panel-w),55vw)] min-[860px]:border-t-0"
        >
          <NodePanel />
        </div>
      </div>
      {searchOpen && <SearchPalette />}
      {leftOpen && <LeftDialog />}
      <NodeDialogs />
    </div>
  );
}
