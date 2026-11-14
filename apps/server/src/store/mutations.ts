import {
  LIMITS,
  buildIndex,
  extractWikilinks,
  isAncestor,
  pathOf,
  resolve,
  stripWikilinks,
  subtreeOf,
  toSlug,
  type ConceptNode,
  type ErrorInfo,
  type Generation,
  type MapFile,
  type MapSettings,
  type ParsedExpand,
  type ThreadMessage,
} from '@mindmapper/shared';
import { AppError } from '../errors';
import { newId, now } from '../ids';

const squash = (s: string) => s.replace(/\s+/g, ' ').trim();

function blankNode(id: string, title: string, parentId: string | null, p: Partial<ConceptNode> = {}): ConceptNode {
  const t = now();
  return {
    id,
    title,
    aliases: [],
    parentId,
    summary: '',
    body: null,
    status: 'stub',
    error: null,
    origin: null,
    related: [],
    thread: [],
    collapsed: false,
    generatedBy: null,
    createdAt: t,
    updatedAt: t,
    ...p,
  };
}

function node(map: MapFile, id: string): ConceptNode {
  const n = map.nodes[id];
  if (!n) throw new AppError('not_found', 'Node not found.');
  return n;
}

export function createMap(topic: string, settings: MapSettings): MapFile {
  const t = now();
  const title = squash(topic);
  const rootId = newId();
  const mapId = newId();
  return {
    schemaVersion: 1,
    id: mapId,
    title,
    createdAt: t,
    updatedAt: t,
    settings,
    rootId,
    nodes: { [rootId]: blankNode(rootId, title.slice(0, LIMITS.titleMax), null) },
    view: { selectedId: rootId, anchorId: rootId, trail: [rootId], viewport: null },
  };
}

// ---------- explanation ----------

export interface ExpandPrev {
  status: ConceptNode['status'];
  body: string | null;
  error: ErrorInfo | null;
}

export function startExpand(map: MapFile, nodeId: string): ExpandPrev {
  const n = node(map, nodeId);
  const prev = { status: n.status, body: n.body, error: n.error };
  n.status = 'generating';
  n.error = null;
  n.updatedAt = now();
  return prev;
}

export function cancelExpand(map: MapFile, nodeId: string, prev: ExpandPrev): void {
  const n = map.nodes[nodeId];
  if (!n) return;
  n.status = prev.status === 'generating' ? (prev.body !== null ? 'ready' : 'stub') : prev.status;
  n.body = prev.body;
  n.error = prev.error;
  n.updatedAt = now();
}

export function failExpand(map: MapFile, nodeId: string, prev: ExpandPrev, error: ErrorInfo): void {
  const n = map.nodes[nodeId];
  if (!n) return;
  n.updatedAt = now();
  if (prev.body !== null) {
    n.status = 'ready';
    n.body = prev.body;
    n.error = null;
  } else {
    n.status = 'error';
    n.error = error;
  }
}

/** The sentence of `body` that holds the first wikilink to `slug`, with markup removed. */
function snippetFor(body: string, slug: string): string {
  const link = extractWikilinks(body).find((l) => toSlug(l.target) === slug);
  if (!link) return '';
  let a = link.index;
  while (a > 0 && !/[.!?\n]/.test(body[a - 1] as string)) a--;
  let b = link.index + link.length;
  while (b < body.length && !/[.!?\n]/.test(body[b] as string)) b++;
  if (b < body.length && body[b] !== '\n') b++;
  return squash(stripWikilinks(body.slice(a, b))).slice(0, LIMITS.snippetMax);
}

/** DATA-MODEL.md 7.2. Returns ids of every node created or changed. */
export function finishExpand(map: MapFile, nodeId: string, parsed: ParsedExpand, gen: Generation): string[] {
  const n = node(map, nodeId);
  const changed = new Set<string>([nodeId]);
  const t = now();

  n.body = parsed.body;
  if (parsed.summary) n.summary = parsed.summary;

  const ownSlug = toSlug(n.title);
  let index = buildIndex(map);
  for (const alias of parsed.aliases) {
    if (n.aliases.length >= LIMITS.aliasesMax) break;
    const s = toSlug(alias);
    if (!s || s === ownSlug || index.slugToId.has(s)) continue;
    n.aliases.push(alias);
    index.slugToId.set(s, n.id);
  }
  index = buildIndex(map);

  let processed = 0;
  for (const child of parsed.children) {
    if (processed >= LIMITS.childrenMax) break;
    const slug = toSlug(child.title);
    if (!slug || slug === ownSlug) continue;
    const existingId = index.slugToId.get(slug);
    if (existingId) {
      if (existingId === n.id || isAncestor(map, existingId, n.id)) continue;
      if (map.nodes[existingId]?.parentId === n.id) continue;
      if (!n.related.includes(existingId)) n.related.push(existingId);
      processed++;
      continue;
    }
    const id = newId();
    map.nodes[id] = blankNode(id, child.title, n.id, {
      summary: child.summary,
      origin: { nodeId: n.id, snippet: snippetFor(parsed.body, slug) },
    });
    index.slugToId.set(slug, id);
    changed.add(id);
    processed++;
  }

  n.status = 'ready';
  n.error = null;
  n.generatedBy = gen;
  n.updatedAt = t;
  return [...changed];
}

// ---------- questions ----------

export interface AskStart {
  question: string;
  quote: string | null;
  userId: string;
  assistantId: string;
  restore: ThreadMessage | null;
}

export function startAsk(
  map: MapFile,
  nodeId: string,
  input: { question?: string; quote?: string | null; retryMessageId?: string | null },
): AskStart {
  const n = node(map, nodeId);
  const t = now();
  let question = (input.question ?? '').trim();
  let quote = input.quote ? input.quote.trim() || null : null;
  let userId: string;
  let restore: ThreadMessage | null = null;

  if (input.retryMessageId) {
    const i = n.thread.findIndex((m) => m.id === input.retryMessageId);
    const failed = n.thread[i];
    const user = n.thread[i - 1];
    if (!failed || failed.role !== 'assistant' || failed.status !== 'error' || !user || user.role !== 'user') {
      throw new AppError('invalid_request', 'Only a failed answer can be retried.');
    }
    restore = failed;
    question = user.text;
    quote = user.quote;
    userId = user.id;
    n.thread.splice(i, 1);
  } else {
    if (!question) throw new AppError('invalid_request', 'The question is empty.');
    userId = newId();
    n.thread.push({ id: userId, role: 'user', text: question, quote, status: 'ready', error: null, generatedBy: null, createdAt: t });
  }
  const assistantId = newId();
  n.thread.push({ id: assistantId, role: 'assistant', text: '', quote: null, status: 'generating', error: null, generatedBy: null, createdAt: t });
  n.updatedAt = t;
  return { question, quote, userId, assistantId, restore };
}

export function finishAsk(map: MapFile, nodeId: string, assistantId: string, text: string, gen: Generation): void {
  const n = node(map, nodeId);
  const m = n.thread.find((x) => x.id === assistantId);
  if (!m) return;
  m.text = text;
  m.status = 'ready';
  m.error = null;
  m.generatedBy = gen;
  n.updatedAt = now();
}

export function failAsk(map: MapFile, nodeId: string, assistantId: string, error: ErrorInfo): void {
  const n = map.nodes[nodeId];
  const m = n?.thread.find((x) => x.id === assistantId);
  if (!n || !m) return;
  m.status = 'error';
  m.error = error;
  n.updatedAt = now();
}

export function cancelAsk(map: MapFile, nodeId: string, start: AskStart): void {
  const n = map.nodes[nodeId];
  if (!n) return;
  n.thread = n.thread.filter((m) => m.id !== start.assistantId && (start.restore ? true : m.id !== start.userId));
  if (start.restore) {
    const i = n.thread.findIndex((m) => m.id === start.userId);
    n.thread.splice(i + 1, 0, start.restore);
  }
  n.updatedAt = now();
}

export function deleteMessage(map: MapFile, nodeId: string, messageId: string): void {
  const n = node(map, nodeId);
  const i = n.thread.findIndex((m) => m.id === messageId);
  if (i < 0) throw new AppError('not_found', 'Message not found.');
  const remove = n.thread[i]?.role === 'user' && n.thread[i + 1]?.role === 'assistant' ? 2 : 1;
  n.thread.splice(i, remove);
  n.updatedAt = now();
}

// ---------- structure ----------

export function openConcept(
  map: MapFile,
  fromNodeId: string,
  rawTerm: string,
  snippet?: string,
): { node: ConceptNode; created: boolean } {
  node(map, fromNodeId);
  const term = squash(rawTerm);
  if (!toSlug(term) || term.length > LIMITS.titleMax) throw new AppError('invalid_request', 'That is not a usable concept name.');
  const index = buildIndex(map);
  const existing = resolve(index, term);
  if (existing) return { node: node(map, existing), created: false };
  const id = newId();
  const created = blankNode(id, term, fromNodeId, {
    origin: { nodeId: fromNodeId, snippet: (snippet ?? '').slice(0, LIMITS.snippetMax) },
  });
  map.nodes[id] = created;
  return { node: created, created: true };
}

export function renameNode(map: MapFile, nodeId: string, rawTitle: string): void {
  const n = node(map, nodeId);
  const title = squash(rawTitle);
  const slug = toSlug(title);
  if (!slug) throw new AppError('invalid_request', 'That is not a usable name.');
  const owner = resolve(buildIndex(map), title);
  if (owner && owner !== nodeId) {
    throw new AppError('conflict', `"${node(map, owner).title}" already uses that name. Merge the nodes instead.`);
  }
  const old = n.title;
  n.title = title;
  n.aliases = n.aliases.filter((a) => toSlug(a) !== slug);
  if (toSlug(old) !== slug && !n.aliases.some((a) => toSlug(a) === toSlug(old))) n.aliases.push(old);
  n.updatedAt = now();
}

export function fixView(map: MapFile, removed: Set<string>, selectedFallback: string | null): void {
  const v = map.view;
  v.trail = v.trail.filter((id) => !removed.has(id));
  if (removed.has(v.anchorId)) v.anchorId = map.rootId;
  if (v.selectedId && removed.has(v.selectedId)) v.selectedId = selectedFallback ?? map.rootId;
}

export function deleteNode(map: MapFile, nodeId: string): { removedIds: string[]; changedIds: string[] } {
  const n = node(map, nodeId);
  if (nodeId === map.rootId) throw new AppError('conflict', 'The root node cannot be deleted.');
  const removedIds = subtreeOf(map, nodeId);
  const removed = new Set(removedIds);
  for (const id of removedIds) delete map.nodes[id];
  const changed = new Set<string>();
  for (const other of Object.values(map.nodes)) {
    const before = other.related.length;
    other.related = other.related.filter((r) => !removed.has(r));
    let touched = other.related.length !== before;
    if (other.origin && removed.has(other.origin.nodeId)) {
      other.origin = null;
      touched = true;
    }
    if (touched) {
      other.updatedAt = now();
      changed.add(other.id);
    }
  }
  fixView(map, removed, n.parentId);
  return { removedIds, changedIds: [...changed] };
}

export function mergeNodes(map: MapFile, sourceId: string, targetId: string): { removedIds: string[]; changedIds: string[] } {
  const source = node(map, sourceId);
  const target = node(map, targetId);
  if (sourceId === targetId) throw new AppError('conflict', 'Choose a different node to merge into.');
  if (sourceId === map.rootId) throw new AppError('conflict', 'The root node cannot be merged into another node.');
  if (subtreeOf(map, sourceId).includes(targetId)) throw new AppError('conflict', 'Cannot merge a node into its own descendant.');

  const changed = new Set<string>([targetId]);
  for (const c of Object.values(map.nodes)) {
    if (c.parentId === sourceId) {
      c.parentId = targetId;
      c.updatedAt = now();
      changed.add(c.id);
    }
  }
  target.thread.push(...source.thread);
  const targetSlug = toSlug(target.title);
  for (const name of [source.title, ...source.aliases]) {
    const s = toSlug(name);
    if (s && s !== targetSlug && !target.aliases.some((a) => toSlug(a) === s)) target.aliases.push(name);
  }
  target.related = [...new Set([...target.related, ...source.related])].filter((r) => r !== targetId && r !== sourceId);
  for (const other of Object.values(map.nodes)) {
    if (other.id === sourceId) continue;
    if (other.related.includes(sourceId)) {
      other.related = [...new Set(other.related.map((r) => (r === sourceId ? targetId : r)))].filter((r) => r !== other.id);
      changed.add(other.id);
    }
    if (other.origin?.nodeId === sourceId) {
      other.origin = { ...other.origin, nodeId: targetId };
      changed.add(other.id);
    }
  }
  const v = map.view;
  const swap = (id: string) => (id === sourceId ? targetId : id);
  v.trail = v.trail.map(swap).filter((id, i, a) => id !== a[i - 1]);
  v.anchorId = swap(v.anchorId);
  if (v.selectedId) v.selectedId = swap(v.selectedId);
  delete map.nodes[sourceId];
  target.updatedAt = now();
  changed.delete(sourceId);
  return { removedIds: [sourceId], changedIds: [...changed] };
}

/** Pin nodes where the learner dropped them, or release them (null) back to automatic layout. */
export function setPositions(map: MapFile, positions: Record<string, { x: number; y: number } | null>): string[] {
  const changed: string[] = [];
  for (const [id, pos] of Object.entries(positions)) {
    const n = map.nodes[id];
    if (!n) continue;
    // Keep coordinates within a sane range so a bad request cannot push the board off to infinity.
    n.position = pos ? { x: Math.max(-1e5, Math.min(1e5, pos.x)), y: Math.max(-1e5, Math.min(1e5, pos.y)) } : null;
    changed.push(id);
  }
  return changed;
}

export function resetPositions(map: MapFile): string[] {
  const changed: string[] = [];
  for (const n of Object.values(map.nodes)) {
    if (n.position) {
      n.position = null;
      changed.push(n.id);
    }
  }
  return changed;
}

export function patchView(
  map: MapFile,
  patch: { selectedId?: string | null; anchorId?: string; trail?: string[]; viewport?: MapFile['view']['viewport'] },
): void {
  const v = map.view;
  if (patch.selectedId !== undefined && (patch.selectedId === null || map.nodes[patch.selectedId])) v.selectedId = patch.selectedId;
  if (patch.anchorId !== undefined && map.nodes[patch.anchorId]) v.anchorId = patch.anchorId;
  if (patch.trail !== undefined) {
    const t = patch.trail.filter((id) => map.nodes[id]).filter((id, i, a) => id !== a[i - 1]);
    v.trail = t.slice(-LIMITS.trailMax);
  }
  if (patch.viewport !== undefined) v.viewport = patch.viewport;
}

export { pathOf };
