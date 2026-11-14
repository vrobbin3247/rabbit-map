import { useState } from 'react';
import type { ProviderStatus } from '@mindmapper/shared';
import { useStore } from '../state/store';
import { Banners } from '../ui/Banners';
import { ConfirmDialog, PromptDialog } from '../ui/Dialog';
import { Select } from '../ui/Select';
import { ThemeToggle } from '../ui/ThemeToggle';

const NAMES: Record<string, string> = { claude: 'Claude', codex: 'ChatGPT (Codex)', fake: 'Fake (testing)' };

function stateText(p: ProviderStatus): string {
  if (p.usable) return `ready${p.plan ? ` · ${p.plan}` : ''}`;
  if (!p.installed) return 'not installed';
  if (p.auth === 'api_key') return 'API-key login (refused)';
  return 'not logged in';
}

export function ProviderChips() {
  const health = useStore((s) => s.health);
  const [open, setOpen] = useState<string | null>(null);
  if (!health) return <p className="muted">Checking providers…</p>;
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap gap-2" aria-label="Providers">
        {health.providers.map((p) => (
          <button
            key={p.id}
            className="chip"
            style={{ borderColor: p.usable ? 'var(--accent)' : 'var(--warn)' }}
            onClick={() => setOpen(open === p.id ? null : p.id)}
            aria-expanded={open === p.id}
          >
            <span aria-hidden>{p.usable ? '●' : '○'}</span> {NAMES[p.id] ?? p.id}: {stateText(p)}
          </button>
        ))}
        <button className="btn btn-ghost btn-sm" onClick={() => void useStore.getState().loadHealth(true)}>Check again</button>
      </div>
      {health.providers.filter((p) => open === p.id && !p.usable).map((p) => (
        <p key={p.id} className="m-0 text-sm muted">{p.reason} {p.fix && <code>{p.fix}</code>}</p>
      ))}
    </div>
  );
}

export function Home() {
  const maps = useStore((s) => s.maps);
  const unreadable = useStore((s) => s.unreadable);
  const health = useStore((s) => s.health);
  const [topic, setTopic] = useState('');
  const [level, setLevel] = useState('beginner');
  const [goal, setGoal] = useState('');
  const [busy, setBusy] = useState(false);
  const [menu, setMenu] = useState<{ id: string; title: string; kind: 'rename' | 'delete' } | null>(null);
  const noProvider = !!health && !health.defaultProvider;

  const create = async () => {
    if (!topic.trim() || busy) return;
    setBusy(true);
    await useStore.getState().createMap({ topic: topic.trim(), level, goal: goal.trim() });
    setBusy(false);
  };

  return (
    <div className="mx-auto flex h-full max-w-3xl flex-col gap-6 overflow-y-auto px-4 py-10">
      <Banners />
      <header className="flex items-start justify-between gap-4">
        <div>
          <h1 className="m-0 flex items-center gap-3 text-4xl"><span className="logo logo-mark" role="img" aria-label="Rabbit Map logo" />Mindmapper</h1>
          <p className="m-0 muted">Learn a topic without losing the thread.</p>
        </div>
        <ThemeToggle />
      </header>

      <ProviderChips />

      <form className="sheet flex flex-col gap-3 p-5" onSubmit={(e) => { e.preventDefault(); void create(); }}>
        <label className="flex flex-col gap-1">
          <span className="font-medium">What do you want to learn?</span>
          <input className="field text-base" value={topic} maxLength={200} placeholder="e.g. Deep learning" disabled={noProvider} onChange={(e) => setTopic(e.target.value)} autoFocus />
        </label>
        <div className="flex flex-wrap gap-3">
          <div className="flex min-w-[11rem] flex-col gap-1 text-sm">
            <span className="muted">Your level</span>
            <Select
              label="Your level"
              value={level}
              options={[{ value: 'beginner', label: 'Beginner' }, { value: 'intermediate', label: 'Intermediate' }, { value: 'advanced', label: 'Advanced' }]}
              onChange={setLevel}
            />
          </div>
          <label className="flex min-w-[12rem] flex-1 flex-col gap-1 text-sm">
            <span className="muted">Goal (optional)</span>
            <input className="field" value={goal} maxLength={500} placeholder="e.g. prepare for an exam" onChange={(e) => setGoal(e.target.value)} />
          </label>
        </div>
        <div className="flex items-center justify-end gap-3">
          {noProvider && <span className="text-sm text-[var(--warn)]">No provider is ready. Click a provider above to see what to do.</span>}
          <button className="btn btn-primary" type="submit" disabled={!topic.trim() || busy || noProvider}>{busy ? 'Creating…' : 'Start mapping'}</button>
        </div>
      </form>

      <section aria-label="Your maps">
        <h2 className="mb-2 mt-0 text-lg muted">Your maps</h2>
        {maps.length === 0 && <p className="muted">No maps yet.</p>}
        <ul className="m-0 flex list-none flex-col gap-2 p-0">
          {maps.map((m) => (
            <li key={m.id} className="sheet flex items-center gap-2 px-3 py-2">
              <button className="flex-1 text-left" onClick={() => void useStore.getState().openMap(m.id)}>
                <div className="font-medium">{m.title}</div>
                <div className="text-xs muted">{m.nodeCount} node{m.nodeCount === 1 ? '' : 's'} · opened {new Date(m.updatedAt).toLocaleString()}</div>
              </button>
              <button className="btn btn-sm" onClick={() => setMenu({ id: m.id, title: m.title, kind: 'rename' })}>Rename</button>
              <button className="btn btn-sm btn-danger" onClick={() => setMenu({ id: m.id, title: m.title, kind: 'delete' })}>Delete</button>
            </li>
          ))}
          {unreadable.map((u) => (
            <li key={u.id} className="rounded-lg border border-dashed border-[var(--warn)] px-3 py-2 text-sm">
              <strong>Unreadable map file</strong> <code>{u.id}.json</code>: {u.message}. It has been left untouched.
            </li>
          ))}
        </ul>
      </section>

      {menu?.kind === 'rename' && <PromptDialog title="Rename map" initial={menu.title} onClose={() => setMenu(null)} onSubmit={(v) => { void useStore.getState().renameMap(menu.id, v); setMenu(null); }} />}
      {menu?.kind === 'delete' && <ConfirmDialog title="Delete map" danger confirm="Delete" message={`“${menu.title}” and everything in it will be deleted from disk.`} onClose={() => setMenu(null)} onConfirm={() => { void useStore.getState().deleteMap(menu.id); setMenu(null); }} />}
    </div>
  );
}
