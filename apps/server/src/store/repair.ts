import type { MapFile } from '@mindmapper/shared';

/** Apply the load-time repairs from DATA-MODEL.md section 9. Returns true if anything changed. */
export function repairMap(map: MapFile): boolean {
  let changed = false;
  const nodes = map.nodes;
  const ids = new Set(Object.keys(nodes));

  for (const n of Object.values(nodes)) {
    if (n.status === 'generating') {
      n.status = n.body !== null ? 'ready' : 'stub';
      changed = true;
    }
    for (const m of n.thread) {
      if (m.status === 'generating') {
        m.status = 'error';
        m.error = { code: 'aborted', message: 'This answer was interrupted.' };
        changed = true;
      }
    }
    const related = n.related.filter((r) => ids.has(r));
    if (related.length !== n.related.length) {
      n.related = related;
      changed = true;
    }
    if (n.origin && !ids.has(n.origin.nodeId)) {
      n.origin = null;
      changed = true;
    }
    if (n.parentId !== null && !ids.has(n.parentId) && n.id !== map.rootId) {
      n.parentId = map.rootId;
      changed = true;
    }
    if (n.status !== 'error' && n.error) {
      n.error = null;
      changed = true;
    }
  }

  const v = map.view;
  const trail = v.trail.filter((t) => ids.has(t));
  if (trail.length !== v.trail.length) {
    v.trail = trail;
    changed = true;
  }
  if (!ids.has(v.anchorId)) {
    v.anchorId = map.rootId;
    changed = true;
  }
  if (v.selectedId && !ids.has(v.selectedId)) {
    v.selectedId = map.rootId;
    changed = true;
  }
  return changed;
}
