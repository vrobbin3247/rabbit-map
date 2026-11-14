import { useState } from 'react';
import { TONE_NAMES, subtreeOf, type ConceptNode } from '@mindmapper/shared';
import { useStore } from '../state/store';
import { ConfirmDialog, Dialog, PromptDialog } from '../ui/Dialog';

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

function ColourDialog({ node, onClose }: { node: ConceptNode; onClose: () => void }) {
  const depth = useStore((s) => s.index?.depth.get(node.id) ?? 0);
  const current = node.color ?? null;
  const pick = (c: number | null) => {
    void useStore.getState().setColor(node.id, c);
    onClose();
  };
  return (
    <Dialog title={`Colour for “${node.title}”`} onClose={onClose}>
      <p className="m-0 text-xs muted">By default a card's colour follows how deep it is. Pick one to set this card apart, for example to mark what you have understood.</p>
      <div className="flex flex-wrap gap-3" role="group" aria-label="Colours">
        {TONE_NAMES.map((name, i) => (
          <button
            key={name}
            aria-label={name}
            aria-pressed={current === i}
            title={name}
            onClick={() => pick(i)}
            className="h-9 w-9 rounded-lg border-2"
            style={{ background: `var(--tone-${i})`, borderColor: current === i ? 'var(--accent)' : `var(--tone-${i}-line)`, boxShadow: current === i ? '0 0 0 2px var(--accent)' : undefined }}
            autoFocus={current === i || (current === null && i === depth % TONE_NAMES.length)}
          />
        ))}
      </div>
      <div className="flex justify-between gap-2">
        <button className="btn" disabled={current === null} onClick={() => pick(null)}>Automatic (by depth)</button>
        <button className="btn" onClick={onClose}>Cancel</button>
      </div>
    </Dialog>
  );
}

/** The dialogs opened from either node menu. One host, so both menus share them. */
export function NodeDialogs() {
  const dialog = useStore((s) => s.nodeDialog);
  const map = useStore((s) => s.map);
  const st = useStore.getState;
  const node = dialog && map ? map.nodes[dialog.id] : undefined;
  if (!dialog || !map || !node) return null;
  const close = () => st().set({ nodeDialog: null });

  if (dialog.kind === 'rename') {
    return (
      <PromptDialog
        title="Rename node"
        initial={node.title}
        onClose={close}
        onSubmit={async (v) => {
          if (await st().renameNode(node.id, v)) close();
        }}
      />
    );
  }
  if (dialog.kind === 'addChild') {
    return (
      <PromptDialog
        title={`Add a concept under “${node.title}”`}
        confirm="Add"
        onClose={close}
        onSubmit={async (v) => {
          close();
          await st().openConcept(node.id, v, undefined, false);
        }}
      />
    );
  }
  if (dialog.kind === 'merge') return <MergeDialog node={node} onClose={close} />;
  if (dialog.kind === 'colour') return <ColourDialog node={node} onClose={close} />;

  const size = subtreeOf(map, node.id).length;
  return (
    <ConfirmDialog
      title="Delete node"
      danger
      confirm={size > 1 ? `Delete ${size} nodes` : 'Delete'}
      message={
        size > 1
          ? `“${node.title}” and ${size - 1} node${size > 2 ? 's' : ''} below it will be deleted. Links to them become ghost links.`
          : `“${node.title}” will be deleted. Links to it become ghost links.`
      }
      onClose={close}
      onConfirm={() => {
        close();
        void st().deleteNode(node.id);
      }}
    />
  );
}
