import { useEffect, useRef, useState } from 'react';
import { api } from '../api/client';
import { progress } from '@mindmapper/shared';
import { useStore } from '../state/store';
import { ThemeToggle } from '../ui/ThemeToggle';
import { Breadcrumb } from './Breadcrumb';

const PROVIDER_NAMES: Record<string, string> = { claude: 'Claude', codex: 'ChatGPT', fake: 'Fake' };

/** One borderless button that summarises the AI settings and opens the three selects. */
function SettingsMenu() {
  const map = useStore((s) => s.map)!;
  const health = useStore((s) => s.health);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const st = useStore.getState;
  const provider = health?.providers.find((p) => p.id === map.settings.provider);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        setOpen(false);
      }
    };
    document.addEventListener('pointerdown', onDown);
    document.addEventListener('keydown', onKey, true);
    return () => {
      document.removeEventListener('pointerdown', onDown);
      document.removeEventListener('keydown', onKey, true);
    };
  }, [open]);

  const summary = [PROVIDER_NAMES[map.settings.provider] ?? map.settings.provider, map.settings.model, map.settings.level].filter(Boolean).join(' · ');

  return (
    <div ref={ref} className="relative">
      <button className="btn btn-ghost btn-sm" aria-haspopup="true" aria-expanded={open} title="AI provider, model and your level" onClick={() => setOpen((o) => !o)}>
        {summary} <span aria-hidden>⌄</span>
      </button>
      {open && (
        <div className="menu" style={{ minWidth: 230, padding: 12 }} role="group" aria-label="AI settings">
          <label className="mb-2 flex flex-col gap-1 text-sm">
            Provider
            <select
              className="field"
              aria-label="Provider"
              value={map.settings.provider}
              onChange={(e) => void st().patchSettings({ provider: e.target.value, model: null })}
            >
              {(health?.providers ?? []).map((p) => (
                <option key={p.id} value={p.id} disabled={!p.usable && p.id !== map.settings.provider}>
                  {p.id === 'claude' ? 'Claude' : p.id === 'codex' ? 'ChatGPT (Codex)' : p.id}{p.usable ? '' : ' (unavailable)'}
                </option>
              ))}
              {!provider && <option value={map.settings.provider}>{map.settings.provider}</option>}
            </select>
          </label>
          {provider && provider.models.length > 0 && (
            <label className="mb-2 flex flex-col gap-1 text-sm">
              Model
              <select className="field" aria-label="Model" value={map.settings.model ?? ''} onChange={(e) => void st().patchSettings({ model: e.target.value || null })}>
                <option value="">default model</option>
                {provider.models.map((m) => <option key={m} value={m}>{m}</option>)}
              </select>
            </label>
          )}
          <label className="flex flex-col gap-1 text-sm">
            Your level
            <select className="field" aria-label="Learner level" value={map.settings.level} onChange={(e) => void st().patchSettings({ level: e.target.value })}>
              <option value="beginner">beginner</option>
              <option value="intermediate">intermediate</option>
              <option value="advanced">advanced</option>
            </select>
          </label>
        </div>
      )}
    </div>
  );
}

/** Everything lives on one row, and nothing is outlined: controls are text until you point at them. */
export function TopBar() {
  const map = useStore((s) => s.map)!;
  const index = useStore((s) => s.index)!;
  const forwardCount = useStore((s) => s.forward.length);
  const st = useStore.getState;
  const sel = map.view.selectedId;
  const depth = sel ? (index.depth.get(sel) ?? 0) : 0;
  const anchor = map.nodes[map.view.anchorId];
  const awayFromAnchor = sel !== map.view.anchorId;
  const left = progress(map).left;

  return (
    <header className="topbar">
      <div className="flex flex-wrap items-center gap-x-1 gap-y-1 px-3 py-1.5">
        <span className="logo logo-stacked" role="img" aria-label="Rabbit Map" />
        <button className="btn btn-ghost btn-sm" onClick={() => void st().closeMap()}>‹ Maps</button>
        <button className="btn btn-ghost btn-sm" aria-label="Back" title="Back (Alt+←)" disabled={map.view.trail.length < 2} onClick={() => st().back()}>←</button>
        <button className="btn btn-ghost btn-sm" aria-label="Forward" title="Forward (Alt+→)" disabled={forwardCount === 0} onClick={() => st().forwardNav()}>→</button>

        <div className="mx-2 min-w-[12rem] flex-1 max-[1100px]:order-last max-[1100px]:mx-0 max-[1100px]:basis-full"><Breadcrumb /></div>

        <span className={`px-1 text-sm ${depth >= 5 ? 'text-[var(--warn)]' : 'muted'}`} title={depth >= 5 ? 'You are deep in a branch. The anchor takes you back.' : 'Levels below the root'}>depth {depth}</span>
        <span className="muted" aria-hidden>•</span>
        <button
          className="btn btn-ghost btn-sm"
          onClick={() => st().set({ leftOpen: true })}
          title={left ? `${left} card${left === 1 ? ' has' : 's have'} not been explained yet. Click to see them.` : 'Every card has been explained.'}
        >
          {left ? `${left} left` : '✓ all opened'}
        </button>
        {awayFromAnchor && sel && (
          <button className="btn btn-ghost btn-sm" aria-label="Set anchor here" title="Make this node the anchor" onClick={() => st().setAnchor(sel)}>Set anchor</button>
        )}
        <button
          className={`btn btn-ghost btn-sm ${awayFromAnchor ? 'text-[var(--accent)]' : ''}`}
          title={`Back to anchor: ${anchor?.title ?? 'anchor'} (A)`}
          onClick={() => st().goToAnchor()}
        >
          {/* The root's name is already the start of the breadcrumb, so only a moved anchor is named. */}
          ⚓{map.view.anchorId !== map.rootId && anchor && <span className="max-w-[10rem] truncate"> {anchor.title}</span>}
        </button>
        <button className="btn btn-ghost btn-sm" aria-label="Search" title="Search cards (⌘K)" onClick={() => st().set({ searchOpen: true })}>
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
            <circle cx="11" cy="11" r="6.5" />
            <path d="M16 16l4.5 4.5" />
          </svg>
          <span className="kbd">⌘K</span>
        </button>
        <button
          className="btn btn-ghost btn-sm"
          title="Write each node as a Markdown file"
          onClick={async () => {
            try {
              const r = await api.exportMap(map.id);
              st().setBanner({ kind: 'info', text: `Exported ${r.files} files to ${r.path}` });
            } catch (e) {
              st().setBanner({ kind: 'error', text: (e as Error).message });
            }
          }}
        >
          Export
        </button>

        <span className="mx-1 h-5 w-px bg-[var(--border)]" aria-hidden />
        <SettingsMenu />
        <ThemeToggle />
      </div>
    </header>
  );
}
