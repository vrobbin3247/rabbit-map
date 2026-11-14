import type { ConceptNode, MapFile, MapIndex } from '@mindmapper/shared';
import { useStore } from '../state/store';

export interface MenuItem {
  id: string;
  label: string;
  hint?: string;
  danger?: boolean;
  disabled?: boolean;
  run: () => void;
}
export type MenuEntry = MenuItem | 'separator';

async function copy(text: string, what: string) {
  const st = useStore.getState();
  try {
    await navigator.clipboard.writeText(text);
    st.setBanner({ kind: 'info', text: `Copied ${what}.` });
  } catch {
    st.setBanner({ kind: 'error', text: 'Could not copy. The browser blocked clipboard access.' });
  }
}

/**
 * The actions for one node, shared by the panel's ⋯ menu and the right-click menu.
 * `busy` is true while any generation is running; `streaming` while this node is being written.
 */
export function nodeMenu(
  map: MapFile,
  index: MapIndex,
  node: ConceptNode,
  state: { busy: boolean; streaming: boolean },
): MenuEntry[] {
  const st = useStore.getState;
  const isRoot = node.id === map.rootId;
  const firstChild = index.children.get(node.id)?.[0];
  const hasKids = (index.children.get(node.id)?.length ?? 0) > 0;
  const dialog = (kind: 'rename' | 'merge' | 'delete' | 'addChild') => () => st().set({ nodeDialog: { kind, id: node.id } });
  const out: MenuEntry[] = [];

  if (state.streaming || node.status === 'generating') {
    out.push({ id: 'stop', label: 'Stop writing', hint: 'Esc', disabled: !state.streaming, run: () => st().stop(node.id) });
  } else if (node.status === 'stub') {
    out.push({ id: 'explain', label: 'Explain', hint: 'Enter', run: () => void st().explain(node.id) });
  } else if (node.status === 'error') {
    out.push({ id: 'explain', label: 'Try again', hint: 'Enter', run: () => void st().explain(node.id) });
  } else {
    out.push({ id: 'regenerate', label: 'Regenerate', run: () => void st().explain(node.id, true) });
  }
  out.push({
    id: 'ask',
    label: 'Ask a question…',
    hint: '/',
    run: () => {
      st().select(node.id);
      st().focusAsk();
    },
  });
  out.push({ id: 'addChild', label: 'Add child concept…', run: dialog('addChild') });
  out.push('separator');

  if (node.parentId) out.push({ id: 'parent', label: 'Go to parent', hint: '←', run: () => st().select(node.parentId as string) });
  if (firstChild) out.push({ id: 'child', label: 'Go to first child', hint: '→', run: () => st().select(firstChild) });
  out.push({ id: 'anchor', label: 'Set as anchor', disabled: map.view.anchorId === node.id, run: () => st().setAnchor(node.id) });
  if (node.position) out.push({ id: 'unpin', label: 'Release position', run: () => void st().unpinNode(node.id) });
  if (hasKids) out.push({ id: 'collapse', label: node.collapsed ? 'Expand branch' : 'Collapse branch', run: () => void st().toggleCollapse(node.id) });
  out.push('separator');

  out.push({ id: 'copyLink', label: 'Copy link [[Title]]', run: () => void copy(`[[${node.title}]]`, 'the link') });
  if (node.body) out.push({ id: 'copyText', label: 'Copy explanation', run: () => void copy(`# ${node.title}\n\n${node.body}`, 'the explanation') });
  out.push('separator');

  out.push({ id: 'rename', label: 'Rename…', run: dialog('rename') });
  if (!isRoot) out.push({ id: 'merge', label: 'Merge into…', disabled: state.busy, run: dialog('merge') });
  if (!isRoot) out.push({ id: 'delete', label: 'Delete…', danger: true, disabled: state.busy, run: dialog('delete') });
  return out;
}
