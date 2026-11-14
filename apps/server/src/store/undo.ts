import { toSlug, type ConceptNode, type MapFile, type ViewState } from '@mindmapper/shared';
import { AppError } from '../errors';
import { newId } from '../ids';

/**
 * What a destructive action (delete, merge) changed, so it can be reversed. Only the nodes the
 * action touched are recorded, so work done elsewhere in the meantime is never overwritten.
 */
export interface UndoEntry {
  id: string;
  label: string;
  /** The nodes as they were. A changed node that did not exist before is not recorded (actions here never create nodes). */
  before: Record<string, ConceptNode>;
  /** Every node id the action changed or removed. */
  changedIds: string[];
  /** The changed nodes that still existed afterwards, as JSON, to notice if they change again. */
  afterJson: Record<string, string>;
  view: ViewState;
}

const MAX_PER_MAP = 10;

export function runWithUndo<T>(map: MapFile, label: string, op: () => T): { result: T; entry: UndoEntry } {
  const beforeNodes = structuredClone(map.nodes);
  const view = structuredClone(map.view);
  const result = op();
  const changedIds: string[] = [];
  const before: Record<string, ConceptNode> = {};
  const afterJson: Record<string, string> = {};
  for (const id of new Set([...Object.keys(beforeNodes), ...Object.keys(map.nodes)])) {
    const b = beforeNodes[id];
    const a = map.nodes[id];
    if (b && a && JSON.stringify(a) === JSON.stringify(b)) continue;
    changedIds.push(id);
    if (b) before[id] = b;
    if (a) afterJson[id] = JSON.stringify(a);
  }
  return { result, entry: { id: newId(), label, before, changedIds, afterJson, view } };
}

/** Put back what `entry` changed. Throws `conflict` if that is no longer safe. */
export function applyUndo(map: MapFile, entry: UndoEntry): void {
  for (const id of entry.changedIds) {
    const now = map.nodes[id];
    if (now && JSON.stringify(now) !== entry.afterJson[id]) {
      throw new AppError('conflict', `“${now.title}” changed after that, so it cannot be undone safely.`);
    }
  }
  const restored = new Set(Object.keys(entry.before));
  // A node made since with the same name would clash with a restored one.
  const taken = new Map<string, string>();
  for (const n of Object.values(map.nodes)) {
    if (restored.has(n.id)) continue;
    for (const name of [n.title, ...n.aliases]) taken.set(toSlug(name), n.title);
  }
  for (const n of Object.values(entry.before)) {
    for (const name of [n.title, ...n.aliases]) {
      const clash = taken.get(toSlug(name));
      if (clash) throw new AppError('conflict', `A node called “${clash}” now exists, so “${n.title}” cannot be restored.`);
    }
  }
  for (const id of entry.changedIds) {
    const b = entry.before[id];
    if (b) map.nodes[id] = structuredClone(b);
    else delete map.nodes[id];
  }
  for (const n of Object.values(entry.before)) {
    if (n.parentId && !map.nodes[n.parentId]) throw new AppError('conflict', 'The place it was in no longer exists.');
  }
  // Put the selection, anchor and trail back, keeping the current pan and zoom and dropping any id that is gone.
  const keep = (id: string) => !!map.nodes[id];
  const v = map.view;
  v.anchorId = keep(entry.view.anchorId) ? entry.view.anchorId : map.rootId;
  v.selectedId = entry.view.selectedId && keep(entry.view.selectedId) ? entry.view.selectedId : map.rootId;
  v.trail = entry.view.trail.filter(keep);
}

/** Recent undoable actions, per map, in memory. They are lost when the server restarts. */
export class UndoLog {
  private byMap = new Map<string, UndoEntry[]>();

  add(mapId: string, entry: UndoEntry): void {
    const list = [...(this.byMap.get(mapId) ?? []), entry].slice(-MAX_PER_MAP);
    this.byMap.set(mapId, list);
  }

  /** Remove and return an entry. Each can be used once. */
  take(mapId: string, id: string): UndoEntry | undefined {
    const list = this.byMap.get(mapId) ?? [];
    const entry = list.find((e) => e.id === id);
    if (entry) this.byMap.set(mapId, list.filter((e) => e !== entry));
    return entry;
  }

  /** Put an entry back, for when applying it failed and should stay available. */
  restore(mapId: string, entry: UndoEntry): void {
    this.add(mapId, entry);
  }

  forget(mapId: string): void {
    this.byMap.delete(mapId);
  }
}
