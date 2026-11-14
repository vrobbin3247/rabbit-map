import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { buildIndex, type ConceptNode, type MapFile } from '@mindmapper/shared';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { MapStore } from '../src/store/mapStore';
import { expectValid, makeEnv, names, until } from './helpers';

let env: ReturnType<typeof makeEnv>;
beforeEach(() => {
  env = makeEnv();
});
afterEach(async () => {
  await env.cleanup();
});

const byTitle = (m: MapFile, t: string) => Object.values(m.nodes).find((n) => n.title === t) as ConceptNode;
async function newMap(topic = 'Deep learning') {
  const r = await env.json<{ map: MapFile }>('POST', '/api/maps', { topic });
  return r.body.map;
}
const getMap = async (id: string) => (await env.json<{ map: MapFile }>('GET', `/api/maps/${id}`)).body.map;

describe('guards', () => {
  it('rejects a foreign Host', async () => {
    const res = await env.app.request('http://evil.example/api/health', { headers: { host: 'evil.example' } });
    expect(res.status).toBe(403);
  });
  it('rejects a foreign Origin, allows the app origin', async () => {
    expect((await env.call('GET', '/api/health', undefined, { origin: 'https://example.com' })).status).toBe(403);
    expect((await env.call('GET', '/api/health', undefined, { origin: 'http://127.0.0.1:8787' })).status).toBe(200);
  });
  it('requires JSON content type on POST', async () => {
    const res = await env.app.request('http://127.0.0.1:8787/api/maps', { method: 'POST', headers: { 'content-type': 'text/plain' }, body: '{}' });
    expect(res.status).toBe(400);
  });
  it('rejects bad ids and unknown fields', async () => {
    expect((await env.json('GET', '/api/maps/not-an-id')).status).toBe(400);
    expect((await env.json('POST', '/api/maps', { topic: 'x', nope: 1 })).status).toBe(400);
    expect((await env.json('POST', '/api/maps', { topic: '' })).status).toBe(400);
  });
  it('404s unknown endpoints and maps', async () => {
    expect((await env.json('GET', '/api/nothing')).status).toBe(404);
    expect((await env.json('GET', '/api/maps/01ARZ3NDEKTSV4RRFFQ69G5FAV')).status).toBe(404);
  });
});

describe('health', () => {
  it('lists only the forced provider', async () => {
    const r = await env.json('GET', '/api/health');
    expect(r.body.providers.map((p: any) => p.id)).toEqual(['fake']);
    expect(r.body.defaultProvider).toBe('fake');
  });
});

describe('walkthrough', () => {
  it('create, expand, open ghost, expand, ask, share concept, reload from disk', async () => {
    const map = await newMap();
    expect(Object.keys(map.nodes)).toHaveLength(1);
    expect(map.view.anchorId).toBe(map.rootId);

    // expand root
    const e1 = await env.stream(`/api/maps/${map.id}/nodes/${map.rootId}/expand`);
    expect(e1.status).toBe(200);
    const kinds = e1.events.map((e) => e.event);
    expect(kinds[0]).toBe('start');
    expect(kinds.at(-1)).toBe('done');
    expect(kinds.filter((k) => k === 'done' || k === 'error')).toHaveLength(1);
    const streamed = e1.events.filter((e) => e.event === 'delta').map((e: any) => e.data.text).join('');
    expect(streamed).toContain('[[Deep learning Part A]]');
    expect(streamed).not.toContain('===META');
    const done: any = e1.events.at(-1);
    expect(names(done.data.nodes)).toEqual(['Deep learning', 'Deep learning Part A', 'Deep learning Part B', 'Deep learning Part C', 'Shared Concept']);

    let m = await getMap(map.id);
    const shared = byTitle(m, 'Shared Concept');
    expect(m.nodes[map.rootId]?.status).toBe('ready');
    expect(m.nodes[map.rootId]?.summary).toBe('Summary of Deep learning.');
    expect(shared.parentId).toBe(map.rootId);
    expect(shared.status).toBe('stub');
    expect(shared.origin?.snippet).toContain('also related to Shared Concept');

    // ghost concept: no model call
    const open = await env.json<{ node: ConceptNode; created: boolean }>('POST', `/api/maps/${map.id}/nodes`, {
      fromNodeId: byTitle(m, 'Deep learning Part A').id,
      term: '  Pooling  ',
      snippet: 'Pooling shrinks maps.',
    });
    expect(open.status).toBe(201);
    expect(open.body.created).toBe(true);
    expect(open.body.node.status).toBe('stub');
    const again = await env.json<{ created: boolean; node: ConceptNode }>('POST', `/api/maps/${map.id}/nodes`, { fromNodeId: map.rootId, term: 'pooling' });
    expect(again.status).toBe(200);
    expect(again.body.created).toBe(false);
    expect(again.body.node.id).toBe(open.body.node.id);

    // expand the ghost concept under a different branch: its child "Shared Concept" already exists
    const e2 = await env.stream(`/api/maps/${map.id}/nodes/${open.body.node.id}/expand`);
    expect(e2.events.at(-1)?.event).toBe('done');
    m = await getMap(map.id);
    const pooling = m.nodes[open.body.node.id] as ConceptNode;
    expect(Object.values(m.nodes).filter((n) => n.title === 'Shared Concept')).toHaveLength(1);
    expect(pooling.related).toEqual([shared.id]);
    expect(names(Object.values(m.nodes).filter((n) => n.parentId === pooling.id))).toEqual(['Pooling Part A', 'Pooling Part B', 'Pooling Part C']);
    expectValid(m);

    // ask a question
    const a = await env.stream(`/api/maps/${map.id}/nodes/${pooling.id}/ask`, { question: 'why?', quote: 'shrinks' });
    expect(a.events[0]?.event).toBe('start');
    expect((a.events[0] as any).data.messageId).toBeTruthy();
    expect(a.events.at(-1)?.event).toBe('done');
    m = await getMap(map.id);
    const thread = (m.nodes[pooling.id] as ConceptNode).thread;
    expect(thread.map((t) => [t.role, t.status])).toEqual([['user', 'ready'], ['assistant', 'ready']]);
    expect(thread[0]?.quote).toBe('shrinks');
    expect(thread[1]?.text).toBe('Answer about **Pooling**: why?. See [[Shared Concept]] and [[Pooling Detail]].');

    // view state
    const part = byTitle(m, 'Pooling Part A');
    const v = await env.json('PATCH', `/api/maps/${map.id}/view`, { selectedId: part.id, trail: [map.rootId, part.id, 'bogus'], anchorId: pooling.id });
    expect(v.body.view.trail).toEqual([map.rootId, part.id]);
    expect(v.body.view.anchorId).toBe(pooling.id);

    // flush and reload from disk with a fresh store
    await env.store.flush();
    const fresh = new MapStore(env.config.mapsDir);
    const reloaded = await fresh.get(map.id);
    expect(reloaded.nodes).toEqual(m.nodes);
    expect(reloaded.view.anchorId).toBe(pooling.id);
    expectValid(reloaded);
    expect(readdirSync(env.config.mapsDir).filter((f) => f.endsWith('.tmp'))).toEqual([]);

    const list = await env.json('GET', '/api/maps');
    expect(list.body.maps).toEqual([expect.objectContaining({ id: map.id, nodeCount: Object.keys(m.nodes).length })]);
  });

  it('refuses to expand a ready node unless regenerating, and regenerating keeps children and thread', async () => {
    const map = await newMap();
    await env.stream(`/api/maps/${map.id}/nodes/${map.rootId}/expand`);
    const again = await env.stream(`/api/maps/${map.id}/nodes/${map.rootId}/expand`);
    expect(again.status).toBe(409);
    await env.stream(`/api/maps/${map.id}/nodes/${map.rootId}/ask`, { question: 'q' });
    const before = await getMap(map.id);
    const regen = await env.stream(`/api/maps/${map.id}/nodes/${map.rootId}/expand`, { regenerate: true });
    expect(regen.events.at(-1)?.event).toBe('done');
    const after = await getMap(map.id);
    expect(Object.keys(after.nodes).sort()).toEqual(Object.keys(before.nodes).sort());
    expect((after.nodes[map.rootId] as ConceptNode).thread).toHaveLength(2);
    expectValid(after);
  });

  it('expanding a node whose suggested child is an ancestor or existing child makes no cross-link', async () => {
    const map = await newMap('Topic');
    await env.stream(`/api/maps/${map.id}/nodes/${map.rootId}/expand`);
    let m = await getMap(map.id);
    const a = byTitle(m, 'Topic Part A');
    const open = await env.json('POST', `/api/maps/${map.id}/nodes`, { fromNodeId: a.id, term: 'Topic Part A Part A' });
    // renaming the child to the root's name is rejected as a conflict
    expect((await env.json('PATCH', `/api/maps/${map.id}/nodes/${open.body.node.id}`, { title: 'Topic' })).status).toBe(409);
    await env.stream(`/api/maps/${map.id}/nodes/${a.id}/expand`);
    m = await getMap(map.id);
    expect(m.nodes[a.id]?.related).toEqual([byTitle(m, 'Shared Concept').id]);
    expectValid(m);
  });
});

describe('failures', () => {
  it('a failed first explanation leaves an error node that can be retried', async () => {
    const map = await newMap('Topic __ratelimit__');
    const r = await env.stream(`/api/maps/${map.id}/nodes/${map.rootId}/expand`);
    const last: any = r.events.at(-1);
    expect(last.event).toBe('error');
    expect(last.data.code).toBe('rate_limited');
    expect(last.data.message).toBe('Fake rate limit.');
    expect(last.data.nodes[0].status).toBe('error');
    const m = await getMap(map.id);
    expect(m.nodes[map.rootId]?.status).toBe('error');
    expect(m.nodes[map.rootId]?.error?.code).toBe('rate_limited');
    expectValid(m);
    expect(env.jobs.activeCount).toBe(0);
    // retry is allowed (status error)
    const retry = await env.stream(`/api/maps/${map.id}/nodes/${map.rootId}/expand`);
    expect(retry.events.at(-1)?.event).toBe('error');
  });

  it('a failed regeneration restores the old body', async () => {
    const map = await newMap();
    await env.stream(`/api/maps/${map.id}/nodes/${map.rootId}/expand`);
    const old = (await getMap(map.id)).nodes[map.rootId]?.body;
    await env.json('PATCH', `/api/maps/${map.id}/nodes/${map.rootId}`, { title: 'Deep learning __fail__' });
    const r = await env.stream(`/api/maps/${map.id}/nodes/${map.rootId}/expand`, { regenerate: true });
    expect((r.events.at(-1) as any).data.code).toBe('provider_failed');
    const m = await getMap(map.id);
    expect(m.nodes[map.rootId]?.status).toBe('ready');
    expect(m.nodes[map.rootId]?.body).toBe(old);
  });

  it('empty model output is empty_output', async () => {
    const map = await newMap('Topic __empty__');
    const r = await env.stream(`/api/maps/${map.id}/nodes/${map.rootId}/expand`);
    expect((r.events.at(-1) as any).data.code).toBe('empty_output');
  });

  it('missing or malformed metadata still gives an explanation and children from links', async () => {
    for (const trigger of ['__nometa__', '__badjson__']) {
      const map = await newMap(`Topic ${trigger}`);
      const r = await env.stream(`/api/maps/${map.id}/nodes/${map.rootId}/expand`);
      expect(r.events.at(-1)?.event).toBe('done');
      const m = await getMap(map.id);
      const root = m.nodes[map.rootId] as ConceptNode;
      expect(root.status).toBe('ready');
      expect(root.generatedBy?.metaRecovered).toBe(true);
      expect(root.summary).toMatch(/^Topic .* is explained here for testing\./);
      expect(Object.values(m.nodes).filter((n) => n.parentId === root.id).length).toBeGreaterThanOrEqual(3);
      expectValid(m);
    }
  });

  it('removes a leading title heading', async () => {
    const map = await newMap('Topic __heading__');
    await env.stream(`/api/maps/${map.id}/nodes/${map.rootId}/expand`);
    expect((await getMap(map.id)).nodes[map.rootId]?.body?.startsWith('**Topic')).toBe(true);
  });

  it('aborting a stream restores the node and frees the job', async () => {
    const map = await newMap('Topic __hang__');
    const res = await env.call('POST', `/api/maps/${map.id}/nodes/${map.rootId}/expand`, {});
    const reader = (res.body as ReadableStream<Uint8Array>).getReader();
    await reader.read(); // first chunk: start event
    await until(() => env.jobs.activeCount === 1);
    await reader.cancel();
    await until(() => env.jobs.activeCount === 0);
    const m = await getMap(map.id);
    expect(m.nodes[map.rootId]?.status).toBe('stub');
    expect(m.nodes[map.rootId]?.body).toBeNull();
    expectValid(m);
  });

  it('a second request for a node that is being written gets 409', async () => {
    const map = await newMap('Topic __hang__');
    const res = await env.call('POST', `/api/maps/${map.id}/nodes/${map.rootId}/expand`, {});
    const reader = (res.body as ReadableStream<Uint8Array>).getReader();
    await reader.read();
    const second = await env.stream(`/api/maps/${map.id}/nodes/${map.rootId}/expand`);
    expect(second.status).toBe(409);
    expect((await env.stream(`/api/maps/${map.id}/nodes/${map.rootId}/ask`, { question: 'x' })).status).toBe(409);
    await reader.cancel();
    await until(() => env.jobs.activeCount === 0);
  });

  it('a cancelled question removes both messages; a failed one can be retried', async () => {
    const map = await newMap();
    await env.stream(`/api/maps/${map.id}/nodes/${map.rootId}/expand`);
    const res = await env.call('POST', `/api/maps/${map.id}/nodes/${map.rootId}/ask`, { question: 'hold __hang__' });
    const reader = (res.body as ReadableStream<Uint8Array>).getReader();
    await reader.read();
    await reader.cancel();
    await until(() => env.jobs.activeCount === 0);
    expect((await getMap(map.id)).nodes[map.rootId]?.thread).toEqual([]);

    const failed = await env.stream(`/api/maps/${map.id}/nodes/${map.rootId}/ask`, { question: 'boom __fail__' });
    expect((failed.events.at(-1) as any).data.code).toBe('provider_failed');
    let m = await getMap(map.id);
    const t = (m.nodes[map.rootId] as ConceptNode).thread;
    expect(t.map((x) => x.status)).toEqual(['ready', 'error']);
    const retry = await env.stream(`/api/maps/${map.id}/nodes/${map.rootId}/ask`, { retryMessageId: t[1]?.id });
    expect((retry.events.at(-1) as any).data.code).toBe('provider_failed');
    m = await getMap(map.id);
    expect((m.nodes[map.rootId] as ConceptNode).thread).toHaveLength(2);
    expect((await env.stream(`/api/maps/${map.id}/nodes/${map.rootId}/ask`, { retryMessageId: t[0]?.id })).status).toBe(400);
  });
});

describe('questions that name concepts', () => {
  it('adds them as stubs under the node, links the answer, and reuses existing concepts', async () => {
    const map = await newMap('Topic');
    await env.stream(`/api/maps/${map.id}/nodes/${map.rootId}/expand`);
    let m = await getMap(map.id);
    const a = byTitle(m, 'Topic Part A');
    const shared = byTitle(m, 'Shared Concept');
    const before = Object.keys(m.nodes).length;

    const r = await env.stream(`/api/maps/${map.id}/nodes/${a.id}/ask`, { question: 'what kinds are there? __children__' });
    const done: any = r.events.at(-1);
    expect(done.event).toBe('done');
    // the stream carries the node and the new stubs, so the board can draw them at once
    expect(names(done.data.nodes)).toEqual(['Topic Part A', 'Topic Part A Kind One', 'Topic Part A Kind Two']);
    const streamed = r.events.filter((e) => e.event === 'delta').map((e: any) => e.data.text).join('');
    expect(streamed).not.toContain('===META');

    m = await getMap(map.id);
    expect(Object.keys(m.nodes).length).toBe(before + 2);
    const one = byTitle(m, 'Topic Part A Kind One');
    expect(one).toMatchObject({ parentId: a.id, status: 'stub', summary: 'First kind of Topic Part A.' });
    expect(one.origin?.snippet).toContain('Kinds:');
    expect(m.nodes[a.id]?.related).toContain(shared.id); // already existed elsewhere: cross-link, not a copy
    expect(Object.values(m.nodes).filter((n) => n.title === 'Shared Concept')).toHaveLength(1);
    // the saved answer is the text only, and its links now resolve to the new nodes
    const answer = m.nodes[a.id]!.thread.at(-1)!.text;
    expect(answer).toContain('[[Topic Part A Kind One]]');
    expect(answer).not.toContain('===META');
    expectValid(m);

    // asking again does not duplicate them
    await env.stream(`/api/maps/${map.id}/nodes/${a.id}/ask`, { question: 'again? __children__' });
    expect(Object.keys((await getMap(map.id)).nodes).length).toBe(before + 2);
  });

  it('an ordinary answer adds no nodes', async () => {
    const map = await newMap('Topic');
    await env.stream(`/api/maps/${map.id}/nodes/${map.rootId}/expand`);
    const before = Object.keys((await getMap(map.id)).nodes).length;
    const r = await env.stream(`/api/maps/${map.id}/nodes/${map.rootId}/ask`, { question: 'plain question' });
    expect(names((r.events.at(-1) as any).data.nodes)).toEqual(['Topic']);
    expect(Object.keys((await getMap(map.id)).nodes).length).toBe(before);
  });

  it('a stub that is asked about gets children too', async () => {
    const map = await newMap('Topic');
    const r = await env.stream(`/api/maps/${map.id}/nodes/${map.rootId}/ask`, { question: 'kinds? __children__' });
    expect((r.events.at(-1) as any).event).toBe('done');
    const m = await getMap(map.id);
    expect(m.nodes[map.rootId]?.status).toBe('stub');
    expect(Object.values(m.nodes).filter((n) => n.parentId === map.rootId).map((n) => n.title).sort()).toEqual(['Shared Concept', 'Topic Kind One', 'Topic Kind Two']);
  });
});

describe('management', () => {
  async function built() {
    const map = await newMap('Topic');
    await env.stream(`/api/maps/${map.id}/nodes/${map.rootId}/expand`);
    let m = await getMap(map.id);
    const a = byTitle(m, 'Topic Part A');
    await env.stream(`/api/maps/${map.id}/nodes/${a.id}/expand`);
    m = await getMap(map.id);
    return { map, m, a };
  }

  it('rename keeps the old title as an alias; conflicts are rejected', async () => {
    const { map, m, a } = await built();
    const r = await env.json('PATCH', `/api/maps/${map.id}/nodes/${a.id}`, { title: 'Alpha' });
    expect(r.body.node.title).toBe('Alpha');
    expect(r.body.node.aliases).toContain('Topic Part A');
    const conflict = await env.json('PATCH', `/api/maps/${map.id}/nodes/${a.id}`, { title: 'topic part b' });
    expect(conflict.status).toBe(409);
    expect(conflict.body.error.code).toBe('conflict');
    expect(byTitle(m, 'Topic Part B')).toBeTruthy();
    // linking by the old name still resolves
    const open = await env.json('POST', `/api/maps/${map.id}/nodes`, { fromNodeId: map.rootId, term: 'Topic Part A' });
    expect(open.body.created).toBe(false);
    expect(open.body.node.id).toBe(a.id);
  });

  it('collapse toggles', async () => {
    const { map, a } = await built();
    const r = await env.json('PATCH', `/api/maps/${map.id}/nodes/${a.id}`, { collapsed: true });
    expect(r.body.node.collapsed).toBe(true);
  });

  it('delete removes the subtree, cleans references and repairs the view', async () => {
    const { map, m, a } = await built();
    const shared = byTitle(m, 'Shared Concept');
    expect(m.nodes[a.id]?.related).toEqual([shared.id]);

    // deleting a node that others cross-link to cleans their `related`
    const r0 = await env.json('DELETE', `/api/maps/${map.id}/nodes/${shared.id}`);
    expect(r0.body.removedIds).toEqual([shared.id]);
    expect(r0.body.nodes.map((n: ConceptNode) => n.id)).toEqual([a.id]);
    expect((await getMap(map.id)).nodes[a.id]?.related).toEqual([]);

    const deep = byTitle(m, 'Topic Part A Part A');
    await env.json('PATCH', `/api/maps/${map.id}/view`, { selectedId: deep.id, anchorId: a.id, trail: [map.rootId, a.id, deep.id] });
    const r = await env.json('DELETE', `/api/maps/${map.id}/nodes/${a.id}`);
    expect(r.status).toBe(200);
    expect(r.body.removedIds).toHaveLength(4);
    expect(r.body.view.anchorId).toBe(map.rootId);
    expect(r.body.view.selectedId).toBe(map.rootId);
    expect(r.body.view.trail).toEqual([map.rootId]);
    const after = await getMap(map.id);
    expect(after.nodes[a.id]).toBeUndefined();
    expectValid(after);
    expect((await env.json('DELETE', `/api/maps/${map.id}/nodes/${map.rootId}`)).status).toBe(409);
  });

  it('merge moves children and thread, keeps names as aliases, and fixes references', async () => {
    const { map, m, a } = await built();
    const b = byTitle(m, 'Topic Part B');
    await env.stream(`/api/maps/${map.id}/nodes/${b.id}/ask`, { question: 'in b' });
    await env.stream(`/api/maps/${map.id}/nodes/${a.id}/ask`, { question: 'in a' });
    await env.json('PATCH', `/api/maps/${map.id}/view`, { trail: [map.rootId, a.id, b.id], anchorId: a.id, selectedId: a.id });
    const r = await env.json('POST', `/api/maps/${map.id}/nodes/${a.id}/merge`, { intoId: b.id });
    expect(r.status).toBe(200);
    expect(r.body.removedIds).toEqual([a.id]);
    const after = await getMap(map.id);
    const target = after.nodes[b.id] as ConceptNode;
    expect(after.nodes[a.id]).toBeUndefined();
    expect(target.aliases).toContain('Topic Part A');
    expect(target.thread.filter((t) => t.role === 'user').map((t) => t.text).sort()).toEqual(['in a', 'in b']);
    expect(Object.values(after.nodes).filter((n) => n.parentId === b.id).length).toBeGreaterThanOrEqual(3);
    expect(after.view.anchorId).toBe(b.id);
    expect(after.view.trail).toEqual([map.rootId, b.id]);
    const open = await env.json('POST', `/api/maps/${map.id}/nodes`, { fromNodeId: map.rootId, term: 'Topic Part A' });
    expect(open.body.node.id).toBe(b.id);
    expectValid(after);
    // invalid merges
    expect((await env.json('POST', `/api/maps/${map.id}/nodes/${b.id}/merge`, { intoId: b.id })).status).toBe(409);
    expect((await env.json('POST', `/api/maps/${map.id}/nodes/${map.rootId}/merge`, { intoId: b.id })).status).toBe(409);
    const child = Object.values(after.nodes).find((n) => n.parentId === b.id) as ConceptNode;
    expect((await env.json('POST', `/api/maps/${map.id}/nodes/${b.id}/merge`, { intoId: child.id })).status).toBe(409);
  });

  it('deletes a thread message, taking the answer with a question', async () => {
    const { map, a } = await built();
    await env.stream(`/api/maps/${map.id}/nodes/${a.id}/ask`, { question: 'one' });
    const t = (await getMap(map.id)).nodes[a.id]?.thread ?? [];
    const r = await env.json('DELETE', `/api/maps/${map.id}/nodes/${a.id}/thread/${t[0]?.id}`);
    expect(r.body.node.thread).toEqual([]);
  });

  it('patches map settings and title, deletes the map', async () => {
    const map = await newMap();
    const r = await env.json('PATCH', `/api/maps/${map.id}`, { title: 'Renamed', settings: { level: 'advanced', goal: 'exam' } });
    expect(r.body.map.title).toBe('Renamed');
    expect(r.body.map.settings).toMatchObject({ level: 'advanced', goal: 'exam', provider: 'fake' });
    expect((await env.json('PATCH', `/api/maps/${map.id}`, { settings: { provider: 'codex' } })).status).toBe(400);
    expect((await env.json('DELETE', `/api/maps/${map.id}`)).status).toBe(204);
    expect((await env.json('GET', `/api/maps/${map.id}`)).status).toBe(404);
  });

  it('exports one Markdown file per node', async () => {
    const { map, m } = await built();
    const r = await env.json('POST', `/api/maps/${map.id}/export`, {});
    expect(r.body.files).toBe(Object.keys(m.nodes).length);
    const files = readdirSync(r.body.path).sort();
    expect(files).toContain('Topic.md');
    expect(files).toContain('Shared Concept.md');
    const text = readFileSync(path.join(r.body.path, 'Topic Part A.md'), 'utf8');
    expect(text).toContain('parent: "[[Topic]]"');
    expect(text).toContain('[[Shared Concept]]');
  });
});

describe('positions', () => {
  it('pins nodes, persists them, and tidy-up releases them', async () => {
    const map = await newMap('Topic');
    await env.stream(`/api/maps/${map.id}/nodes/${map.rootId}/expand`);
    const m = await getMap(map.id);
    const a = byTitle(m, 'Topic Part A');
    const b = byTitle(m, 'Topic Part B');
    expect(a.position ?? null).toBeNull();

    const r = await env.json('PATCH', `/api/maps/${map.id}/positions`, {
      positions: { [a.id]: { x: 120.5, y: -40 }, [b.id]: { x: 1e9, y: 3 }, bogus: { x: 1, y: 1 } },
    });
    expect(r.status).toBe(200);
    expect(r.body.nodes.map((n: ConceptNode) => n.id).sort()).toEqual([a.id, b.id].sort());
    const after = await getMap(map.id);
    expect(after.nodes[a.id]?.position).toEqual({ x: 120.5, y: -40 });
    expect(after.nodes[b.id]?.position).toEqual({ x: 1e5, y: 3 }); // clamped
    expectValid(after);

    await env.store.flush();
    expect((await new MapStore(env.config.mapsDir).get(map.id)).nodes[a.id]?.position).toEqual({ x: 120.5, y: -40 });

    // release one node
    await env.json('PATCH', `/api/maps/${map.id}/positions`, { positions: { [b.id]: null } });
    expect((await getMap(map.id)).nodes[b.id]?.position).toBeNull();

    // tidy up releases everything
    const reset = await env.json('PATCH', `/api/maps/${map.id}/positions`, { reset: true });
    expect(reset.body.nodes.map((n: ConceptNode) => n.id)).toEqual([a.id]);
    expect((await getMap(map.id)).nodes[a.id]?.position).toBeNull();
  });

  it('rejects malformed bodies', async () => {
    const map = await newMap();
    expect((await env.json('PATCH', `/api/maps/${map.id}/positions`, { positions: { x: { x: 'a', y: 1 } } })).status).toBe(400);
    expect((await env.json('PATCH', `/api/maps/${map.id}/positions`, { nope: 1 })).status).toBe(400);
  });

  it('old map files without positions still load', async () => {
    const map = await newMap();
    await env.store.flush();
    const doc = JSON.parse(readFileSync(path.join(env.config.mapsDir, `${map.id}.json`), 'utf8')) as MapFile;
    for (const n of Object.values(doc.nodes)) delete (n as { position?: unknown }).position;
    writeFileSync(path.join(env.config.mapsDir, `${map.id}.json`), JSON.stringify(doc));
    expect((await new MapStore(env.config.mapsDir).get(map.id)).rootId).toBe(map.rootId);
  });
});

describe('card colour', () => {
  it('sets, clears, persists, and rejects bad values', async () => {
    const map = await newMap('Topic');
    const set = await env.json('PATCH', `/api/maps/${map.id}/nodes/${map.rootId}`, { color: 3 });
    expect(set.status).toBe(200);
    expect(set.body.node.color).toBe(3);
    await env.store.flush();
    expect((await new MapStore(env.config.mapsDir).get(map.id)).nodes[map.rootId]?.color).toBe(3);
    expect((await env.json('PATCH', `/api/maps/${map.id}/nodes/${map.rootId}`, { color: null })).body.node.color).toBeNull();
    for (const bad of [6, -1, 1.5, 'pink']) {
      expect((await env.json('PATCH', `/api/maps/${map.id}/nodes/${map.rootId}`, { color: bad })).status).toBe(400);
    }
    expectValid(await getMap(map.id));
  });

  it('is kept by undo of a delete', async () => {
    const map = await newMap('Topic');
    await env.stream(`/api/maps/${map.id}/nodes/${map.rootId}/expand`);
    const a = byTitle(await getMap(map.id), 'Topic Part A');
    await env.json('PATCH', `/api/maps/${map.id}/nodes/${a.id}`, { color: 5 });
    const d = await env.json('DELETE', `/api/maps/${map.id}/nodes/${a.id}`);
    await env.json('POST', `/api/maps/${map.id}/undo`, { undoId: d.body.undo.id });
    expect((await getMap(map.id)).nodes[a.id]?.color).toBe(5);
  });
});

describe('add the rest (concepts mentioned but without a card)', () => {
  async function withManyMentions() {
    const map = await newMap('Topic');
    await env.stream(`/api/maps/${map.id}/nodes/${map.rootId}/expand`);
    const a = byTitle(await getMap(map.id), 'Topic Part A');
    await env.stream(`/api/maps/${map.id}/nodes/${a.id}/ask`, { question: 'what kinds? __many__' });
    return { map, a };
  }

  it('an answer naming eight concepts adds five, and the rest (and its other mention) can be added in one step', async () => {
    const { map, a } = await withManyMentions();
    let m = await getMap(map.id);
    const kinds = Object.values(m.nodes).filter((n) => n.title.startsWith('Topic Part A Kind'));
    expect(kinds.map((n) => n.title).sort()).toEqual(['Topic Part A Kind Five', 'Topic Part A Kind Four', 'Topic Part A Kind One', 'Topic Part A Kind Three', 'Topic Part A Kind Two']);
    // the fake answer also links "<node> Detail", so four concepts are mentioned without a card
    expect(buildIndex(m).ghostTargets.get(a.id)).toEqual(['Topic Part A Detail', 'Topic Part A Kind Six', 'Topic Part A Kind Seven', 'Topic Part A Kind Eight']);

    const r = await env.json('POST', `/api/maps/${map.id}/nodes/${a.id}/adopt`, {});
    expect(r.status).toBe(200);
    expect(r.body.created).toBe(4);
    expect(names(r.body.nodes)).toEqual(['Topic Part A', 'Topic Part A Detail', 'Topic Part A Kind Six', 'Topic Part A Kind Seven', 'Topic Part A Kind Eight']);
    m = await getMap(map.id);
    for (const t of ['Six', 'Seven', 'Eight']) {
      const n = byTitle(m, `Topic Part A Kind ${t}`);
      expect(n).toMatchObject({ parentId: a.id, status: 'stub' });
      expect(n.origin?.snippet).toContain('Kinds:'); // remembers where it was mentioned
    }
    expect(buildIndex(m).ghostTargets.get(a.id)).toEqual([]); // every link in the answer now resolves
    expectValid(m);

    // adding again does nothing
    const again = await env.json('POST', `/api/maps/${map.id}/nodes/${a.id}/adopt`, {});
    expect(again.body.created).toBe(0);
    expect(Object.keys((await getMap(map.id)).nodes).length).toBe(Object.keys(m.nodes).length);
  });

  it('can add just some, and ignores names that are not mentioned', async () => {
    const { map, a } = await withManyMentions();
    const r = await env.json('POST', `/api/maps/${map.id}/nodes/${a.id}/adopt`, { terms: ['topic part a kind seven', 'Something Never Mentioned'] });
    expect(r.body.created).toBe(1);
    const m = await getMap(map.id);
    expect(byTitle(m, 'Topic Part A Kind Seven').parentId).toBe(a.id);
    expect(Object.values(m.nodes).some((n) => n.title === 'Something Never Mentioned')).toBe(false);
    expect(buildIndex(m).ghostTargets.get(a.id)).toEqual(['Topic Part A Detail', 'Topic Part A Kind Six', 'Topic Part A Kind Eight']);
  });

  it('rejects unknown cards and malformed bodies', async () => {
    const { map } = await withManyMentions();
    expect((await env.json('POST', `/api/maps/${map.id}/nodes/01ARZ3NDEKTSV4RRFFQ69G5FAV/adopt`, {})).status).toBe(404);
    expect((await env.json('POST', `/api/maps/${map.id}/nodes/${map.rootId}/adopt`, { terms: 'x' })).status).toBe(400);
    expect((await env.json('POST', `/api/maps/${map.id}/nodes/${map.rootId}/adopt`, { terms: ['x'], more: 1 })).status).toBe(400);
  });
});

describe('undo', () => {
  async function built() {
    const map = await newMap('Topic');
    await env.stream(`/api/maps/${map.id}/nodes/${map.rootId}/expand`);
    let m = await getMap(map.id);
    const a = byTitle(m, 'Topic Part A');
    await env.stream(`/api/maps/${map.id}/nodes/${a.id}/expand`);
    await env.stream(`/api/maps/${map.id}/nodes/${a.id}/ask`, { question: 'a question' });
    m = await getMap(map.id);
    return { map, m, a };
  }
  const undo = (mapId: string, undoId: string) => env.json('POST', `/api/maps/${mapId}/undo`, { undoId });

  it('undoing a delete restores every node exactly, its references, and the view', async () => {
    const { map, m, a } = await built();
    const shared = byTitle(m, 'Shared Concept');
    await env.json('PATCH', `/api/maps/${map.id}/positions`, { positions: { [a.id]: { x: 12, y: 34 } } });
    const deep = byTitle(await getMap(map.id), 'Topic Part A Part A');
    await env.json('PATCH', `/api/maps/${map.id}/view`, { selectedId: deep.id, anchorId: a.id, trail: [map.rootId, a.id, deep.id] });
    const before = await getMap(map.id);

    // delete a node that others cross-link to, then a whole branch
    const d1 = await env.json('DELETE', `/api/maps/${map.id}/nodes/${shared.id}`);
    expect(d1.body.undo.label).toBe('Deleted “Shared Concept”');
    const d2 = await env.json('DELETE', `/api/maps/${map.id}/nodes/${a.id}`);
    expect(d2.body.undo.label).toBe('Deleted “Topic Part A” and 3 below it');
    expect((await getMap(map.id)).nodes[a.id]).toBeUndefined();

    // undo in reverse order
    const u2 = await undo(map.id, d2.body.undo.id);
    expect(u2.status).toBe(200);
    expect(u2.body.map.nodes[a.id].position).toEqual({ x: 12, y: 34 });
    const u1 = await undo(map.id, d1.body.undo.id);
    expect(u1.status).toBe(200);

    const after = await getMap(map.id);
    expect(after.nodes).toEqual(before.nodes); // every node, thread, cross-link and position, exactly
    expect(after.view.anchorId).toBe(a.id);
    expect(after.view.selectedId).toBe(deep.id);
    expect(after.view.trail).toEqual([map.rootId, a.id, deep.id]);
    expectValid(after);
    await env.store.flush();
    expect((await new MapStore(env.config.mapsDir).get(map.id)).nodes).toEqual(before.nodes); // and it was saved

    // each undo can be used once
    expect((await undo(map.id, d2.body.undo.id)).status).toBe(404);
  });

  it('undoing a merge restores both nodes, the threads, and the children', async () => {
    const { map, m, a } = await built();
    const b = byTitle(m, 'Topic Part B');
    await env.stream(`/api/maps/${map.id}/nodes/${b.id}/ask`, { question: 'in b' });
    const before = await getMap(map.id);
    const r = await env.json('POST', `/api/maps/${map.id}/nodes/${a.id}/merge`, { intoId: b.id });
    expect(r.body.undo.label).toBe('Merged “Topic Part A” into “Topic Part B”');
    const merged = await getMap(map.id);
    expect(merged.nodes[a.id]).toBeUndefined();
    expect(merged.nodes[b.id]!.thread.length).toBeGreaterThan(before.nodes[b.id]!.thread.length);

    expect((await undo(map.id, r.body.undo.id)).status).toBe(200);
    const after = await getMap(map.id);
    expect(after.nodes).toEqual(before.nodes);
    expect(after.view).toEqual({ ...before.view, viewport: after.view.viewport });
    expectValid(after);
  });

  it('keeps work done elsewhere after the action', async () => {
    const { map, m } = await built();
    const c = byTitle(m, 'Topic Part C');
    const b = byTitle(m, 'Topic Part B');
    const d = await env.json('DELETE', `/api/maps/${map.id}/nodes/${c.id}`);
    await env.stream(`/api/maps/${map.id}/nodes/${b.id}/expand`); // unrelated work afterwards
    expect((await undo(map.id, d.body.undo.id)).status).toBe(200);
    const after = await getMap(map.id);
    expect(after.nodes[c.id]).toBeTruthy();
    expect(after.nodes[b.id]?.status).toBe('ready'); // still explained
    expectValid(after);
  });

  it('refuses, and changes nothing, when a node it touched has changed since', async () => {
    const { map, m, a } = await built();
    const shared = byTitle(m, 'Shared Concept');
    const d = await env.json('DELETE', `/api/maps/${map.id}/nodes/${shared.id}`); // also cleans Part A's cross-link
    await env.json('PATCH', `/api/maps/${map.id}/nodes/${a.id}`, { title: 'Alpha' });
    const before = await getMap(map.id);
    const r = await undo(map.id, d.body.undo.id);
    expect(r.status).toBe(409);
    expect(r.body.error.message).toContain('changed after that');
    expect((await getMap(map.id)).nodes).toEqual(before.nodes);
  });

  it('refuses when a node with the same name now exists, and works once that is resolved', async () => {
    const { map, m } = await built();
    const c = byTitle(m, 'Topic Part C');
    const d = await env.json('DELETE', `/api/maps/${map.id}/nodes/${c.id}`);
    const created = await env.json('POST', `/api/maps/${map.id}/nodes`, { fromNodeId: map.rootId, term: 'Topic Part C' });
    expect(created.status).toBe(201);
    const refused = await undo(map.id, d.body.undo.id);
    expect(refused.status).toBe(409);
    expect(refused.body.error.message).toContain('now exists');
    // the refused undo is still available: remove the clash and try again
    await env.json('DELETE', `/api/maps/${map.id}/nodes/${created.body.node.id}`);
    expect((await undo(map.id, d.body.undo.id)).status).toBe(200);
    expect((await getMap(map.id)).nodes[c.id]).toBeTruthy();
  });

  it('rejects unknown ids and malformed bodies', async () => {
    const map = await newMap();
    expect((await undo(map.id, 'nope')).status).toBe(404);
    expect((await env.json('POST', `/api/maps/${map.id}/undo`, {})).status).toBe(400);
    expect((await env.json('POST', `/api/maps/${map.id}/undo`, { undoId: 'x', extra: 1 })).status).toBe(400);
  });

  it('an undo id from one map does not work on another', async () => {
    const one = await built();
    const other = await newMap('Other');
    const d = await env.json('DELETE', `/api/maps/${one.map.id}/nodes/${byTitle(one.m, 'Topic Part C').id}`);
    expect((await undo(other.id, d.body.undo.id)).status).toBe(404);
  });
});

describe('export safety', () => {
  const exportTitled = async (title: string) => {
    const m = (await env.json('POST', '/api/maps', { topic: title })).body.map;
    const r = await env.json('POST', `/api/maps/${m.id}/export`, {});
    return { status: r.status, path: r.body?.path as string | undefined, map: m };
  };

  it.each(['..', '.', '...', '../..', '../../maps', '/', '\\', '.hidden'])('export of a map titled %j stays inside the exports folder', async (title) => {
    writeFileSync(path.join(env.config.mapsDir, 'KEEPME.txt'), 'precious');
    writeFileSync(path.join(env.config.dataDir, 'KEEPME-too.txt'), 'precious');
    const r = await exportTitled(title);
    expect(r.status).toBe(200);
    expect(path.dirname(r.path!)).toBe(path.resolve(env.config.exportsDir));
    expect(readFileSync(path.join(env.config.mapsDir, 'KEEPME.txt'), 'utf8')).toBe('precious');
    expect(readFileSync(path.join(env.config.dataDir, 'KEEPME-too.txt'), 'utf8')).toBe('precious');
    expect(readdirSync(env.config.mapsDir).filter((f) => f.endsWith('.json'))).toHaveLength(1); // the map itself survives
    expect(path.basename(r.path!)).not.toMatch(/^\./);
  });

  it('replaces its own earlier export but never a folder it did not make', async () => {
    const first = await exportTitled('Notes');
    writeFileSync(path.join(first.path!, 'stale.md'), 'old');
    const again = await env.json('POST', `/api/maps/${first.map.id}/export`, {});
    expect(again.body.path).toBe(first.path);
    expect(existsSync(path.join(first.path!, 'stale.md'))).toBe(false); // ours: replaced

    // someone else's folder with the same name is left alone and a new one is used
    const theirs = path.join(env.config.exportsDir, 'Mine');
    mkdirSync(theirs, { recursive: true });
    writeFileSync(path.join(theirs, 'my-notes.md'), 'my own notes');
    const r = await exportTitled('Mine');
    expect(readFileSync(path.join(theirs, 'my-notes.md'), 'utf8')).toBe('my own notes');
    expect(path.basename(r.path!)).toBe('Mine (2)');
  });
});

describe('deleting a map while it is being written', () => {
  it('stops the generation, restores state, and leaves no file behind', async () => {
    const m = (await env.json('POST', '/api/maps', { topic: 'Busy __hang__' })).body.map;
    const res = await env.call('POST', `/api/maps/${m.id}/nodes/${m.rootId}/expand`, {});
    const reader = (res.body as ReadableStream<Uint8Array>).getReader();
    await reader.read();
    // A browser keeps reading, so the final event can be written. Do the same here.
    void (async () => {
      while (!(await reader.read().catch(() => ({ done: true }))).done) {
        /* drain */
      }
    })();
    await until(() => env.jobs.activeCount === 1);

    const del = await env.json('DELETE', `/api/maps/${m.id}`);
    expect(del.status).toBe(204);
    expect(env.jobs.activeCount).toBe(0); // it waited for the job to wind down
    await new Promise((r) => setTimeout(r, 100));
    expect(existsSync(path.join(env.config.mapsDir, `${m.id}.json`))).toBe(false); // not written back
    expect((await env.json('GET', `/api/maps/${m.id}`)).status).toBe(404);
  });

  it('an unknown map is a plain 404 and stops nothing else', async () => {
    const other = (await env.json('POST', '/api/maps', { topic: 'Other __hang__' })).body.map;
    const res = await env.call('POST', `/api/maps/${other.id}/nodes/${other.rootId}/expand`, {});
    const reader = (res.body as ReadableStream<Uint8Array>).getReader();
    await reader.read();
    expect((await env.json('DELETE', '/api/maps/01ARZ3NDEKTSV4RRFFQ69G5FAV')).status).toBe(404);
    expect(env.jobs.activeCount).toBe(1);
    await reader.cancel();
    await until(() => env.jobs.activeCount === 0);
  });
});

describe('the page the server serves', () => {
  it('sends a policy that blocks anything from another origin', async () => {
    const dist = env.config.webDist;
    if (!existsSync(path.join(dist, 'index.html'))) return; // the web app has not been built
    const res = await env.app.request('http://127.0.0.1:8787/');
    expect(res.headers.get('content-security-policy')).toContain("img-src 'self' data:");
    expect(res.headers.get('content-security-policy')).toContain("connect-src 'self'");
  });
});

describe('storage', () => {
  it('reports a corrupt file without overwriting it, and repairs interrupted generations on load', async () => {
    const map = await newMap();
    await env.stream(`/api/maps/${map.id}/nodes/${map.rootId}/expand`);
    await env.store.flush();
    const good = path.join(env.config.mapsDir, `${map.id}.json`);
    const doc = JSON.parse(readFileSync(good, 'utf8')) as MapFile;
    const root = doc.nodes[map.rootId] as ConceptNode;
    root.status = 'generating';
    root.body = null;
    root.thread.push({ id: 'x', role: 'assistant', text: '', quote: null, status: 'generating', error: null, generatedBy: null, createdAt: '' });
    writeFileSync(good, JSON.stringify(doc));
    const bad = path.join(env.config.mapsDir, '01ARZ3NDEKTSV4RRFFQ69G5FAV.json');
    writeFileSync(bad, '{ nope');

    const fresh = new MapStore(env.config.mapsDir);
    const list = await fresh.list();
    expect(list.maps.map((x) => x.id)).toEqual([map.id]);
    expect(list.unreadable.map((u) => u.id)).toEqual(['01ARZ3NDEKTSV4RRFFQ69G5FAV']);
    expect(readFileSync(bad, 'utf8')).toBe('{ nope');
    const loaded = await fresh.get(map.id);
    expect(loaded.nodes[map.rootId]?.status).toBe('stub');
    expect(loaded.nodes[map.rootId]?.thread[0]?.status).toBe('error');
    expectValid(loaded);
  });
});
