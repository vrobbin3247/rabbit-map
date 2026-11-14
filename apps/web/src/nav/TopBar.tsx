import { useState } from 'react';
import { api } from '../api/client';
import { progress } from '@mindmapper/shared';
import { useStore } from '../state/store';
import { PromptDialog } from '../ui/Dialog';
import { ThemeToggle } from '../ui/ThemeToggle';
import { Breadcrumb } from './Breadcrumb';

export function TopBar() {
  const map = useStore((s) => s.map)!;
  const index = useStore((s) => s.index)!;
  const health = useStore((s) => s.health);
  const forwardCount = useStore((s) => s.forward.length);
  const [renaming, setRenaming] = useState(false);
  const st = useStore.getState;
  const sel = map.view.selectedId;
  const depth = sel ? (index.depth.get(sel) ?? 0) : 0;
  const anchor = map.nodes[map.view.anchorId];
  const awayFromAnchor = sel !== map.view.anchorId;
  const left = progress(map).left;
  const provider = health?.providers.find((p) => p.id === map.settings.provider);

  return (
    <header className="border-b border-[var(--border)] bg-[var(--panel)]">
      <div className="flex flex-wrap items-center gap-2 px-3 py-2">
        <button className="btn btn-sm" onClick={() => void st().closeMap()}>‹ Maps</button>
        <button className="btn btn-ghost font-semibold" title="Rename map" onClick={() => setRenaming(true)}>{map.title}</button>
        <div className="flex-1" />
        <select
          className="field w-auto py-1 text-xs"
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
        {provider && provider.models.length > 0 && (
          <select className="field w-auto py-1 text-xs" aria-label="Model" value={map.settings.model ?? ''} onChange={(e) => void st().patchSettings({ model: e.target.value || null })}>
            <option value="">default model</option>
            {provider.models.map((m) => <option key={m} value={m}>{m}</option>)}
          </select>
        )}
        <select className="field w-auto py-1 text-xs" aria-label="Learner level" value={map.settings.level} onChange={(e) => void st().patchSettings({ level: e.target.value })}>
          <option value="beginner">beginner</option>
          <option value="intermediate">intermediate</option>
          <option value="advanced">advanced</option>
        </select>
        <ThemeToggle />
        <button className="btn btn-sm" onClick={() => st().set({ searchOpen: true })}>Search <span className="kbd">⌘K</span></button>
        <button
          className="btn btn-sm"
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
      </div>
      <div className="flex flex-wrap items-center gap-2 border-t border-[var(--border)] px-3 py-1.5">
        <button className="btn btn-sm" aria-label="Back" title="Back (Alt+←)" disabled={map.view.trail.length < 2} onClick={() => st().back()}>←</button>
        <button className="btn btn-sm" aria-label="Forward" title="Forward (Alt+→)" disabled={forwardCount === 0} onClick={() => st().forwardNav()}>→</button>
        <div className="min-w-0 flex-1"><Breadcrumb /></div>
        <span className={`rounded-full px-2 py-0.5 text-xs ${depth >= 5 ? 'bg-[var(--warn-soft)] text-[var(--warn)]' : 'bg-[var(--sunken)] muted'}`} title={depth >= 5 ? 'You are deep in a branch. The anchor takes you back.' : 'Levels below the root'}>depth {depth}</span>
        <button
          className="chip"
          onClick={() => st().set({ leftOpen: true })}
          title={left ? `${left} card${left === 1 ? ' has' : 's have'} not been explained yet. Click to see them.` : 'Every card has been explained.'}
        >
          {left ? `${left} left` : '✓ all opened'}
        </button>
        {awayFromAnchor && sel && (
          <button className="btn btn-sm" title="Make this node the anchor" onClick={() => st().setAnchor(sel)}>Set anchor here</button>
        )}
        <button className={`btn btn-sm ${awayFromAnchor ? 'btn-hl' : ''}`} title="Back to anchor (A)" onClick={() => st().goToAnchor()}>
          ⚓ {anchor?.title ?? 'anchor'}
        </button>
      </div>
      {renaming && (
        <PromptDialog title="Rename map" initial={map.title} onClose={() => setRenaming(false)} onSubmit={(v) => { void st().renameMap(map.id, v); setRenaming(false); }} />
      )}
    </header>
  );
}
