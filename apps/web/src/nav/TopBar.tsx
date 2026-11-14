import { useEffect, useRef, useState } from 'react';
import { api } from '../api/client';
import { useStore } from '../state/store';
import { Select } from '../ui/Select';
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
      // An open list inside the menu closes first; it handles Escape itself.
      if (e.key === 'Escape' && !ref.current?.querySelector('[role="listbox"]')) {
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
          <div className="mb-2 flex flex-col gap-1 text-sm">
            <span>Provider</span>
            <Select
              label="Provider"
              value={map.settings.provider}
              options={[
                ...(health?.providers ?? []).map((p) => ({
                  value: p.id,
                  label: `${p.id === 'claude' ? 'Claude' : p.id === 'codex' ? 'ChatGPT (Codex)' : p.id}${p.usable ? '' : ' (unavailable)'}`,
                  disabled: !p.usable && p.id !== map.settings.provider,
                })),
                ...(!provider ? [{ value: map.settings.provider, label: map.settings.provider }] : []),
              ]}
              onChange={(v) => void st().patchSettings({ provider: v, model: null })}
            />
          </div>
          {provider && provider.models.length > 0 && (
            <div className="mb-2 flex flex-col gap-1 text-sm">
              <span>Model</span>
              <Select
                label="Model"
                value={map.settings.model ?? ''}
                options={[{ value: '', label: 'default model' }, ...provider.models.map((m) => ({ value: m, label: m }))]}
                onChange={(v) => void st().patchSettings({ model: v || null })}
              />
            </div>
          )}
          <div className="flex flex-col gap-1 text-sm">
            <span>Your level</span>
            <Select
              label="Learner level"
              value={map.settings.level}
              options={[{ value: 'beginner', label: 'beginner' }, { value: 'intermediate', label: 'intermediate' }, { value: 'advanced', label: 'advanced' }]}
              onChange={(v) => void st().patchSettings({ level: v })}
            />
          </div>
        </div>
      )}
    </div>
  );
}

/** One slim row with no outlines: the logo is home, the breadcrumb says where you are, and search is the main control. */
export function TopBar() {
  const map = useStore((s) => s.map)!;
  const st = useStore.getState;

  return (
    <header className="topbar">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 px-4 py-2">
        <button className="btn btn-ghost logo-btn" aria-label="All maps" title="All maps" onClick={() => void st().closeMap()}>
          <span className="logo logo-sm" role="img" aria-label="Rabbit Map" />
        </button>

        <div className="mx-2 min-w-[12rem] flex-1 max-[1180px]:order-last max-[1180px]:mx-0 max-[1180px]:basis-full"><Breadcrumb /></div>

        {/* A magnifier that opens out into a bar when you point at it, so the breadcrumb keeps the room. */}
        <div className="search-slot">
          <button className="searchbar" aria-label="Search" title="Search cards (⌘K)" onClick={() => st().set({ searchOpen: true })}>
            <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden>
              <circle cx="11" cy="11" r="6.5" />
              <path d="M16 16l4.5 4.5" />
            </svg>
            <span className="muted">Search cards</span>
          </button>
        </div>
        <button
          className="btn btn-ghost btn-sm"
          aria-label="Export"
          title="Export: write each card as a Markdown file"
          onClick={async () => {
            try {
              const r = await api.exportMap(map.id);
              st().setBanner({ kind: 'info', text: `Exported ${r.files} files to ${r.path}` });
            } catch (e) {
              st().setBanner({ kind: 'error', text: (e as Error).message });
            }
          }}
        >
          <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="M12 4v11M7.5 10.5L12 15l4.5-4.5M5 19h14" />
          </svg>
        </button>

        <span className="mx-1 h-7 w-0.5 rounded bg-[var(--border)]" aria-hidden />
        <SettingsMenu />
        <ThemeToggle />
      </div>
    </header>
  );
}
