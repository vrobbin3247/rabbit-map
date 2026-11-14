import { useState } from 'react';
import { subtreeOf, type ConceptNode } from '@mindmapper/shared';
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
