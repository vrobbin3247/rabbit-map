import {
  AskBodySchema,
  CreateMapBodySchema,
  ExpandBodySchema,
  MergeBodySchema,
  OpenConceptBodySchema,
  PatchMapBodySchema,
  PatchNodeBodySchema,
  PatchPositionsBodySchema,
  PatchViewBodySchema,
  type ConceptNode,
  type ProviderId,
} from '@mindmapper/shared';
import type { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';
import { AppError } from '../errors';
import { prepareAsk, prepareExpand, subtreeKeys, jobKey, type Runner } from '../generation/generator';
import { exportMap } from '../store/export';
import {
  createMap,
  deleteMessage,
  deleteNode,
  mergeNodes,
  openConcept,
  patchView,
  renameNode,
  resetPositions,
  setPositions,
} from '../store/mutations';
import { ULID_RE } from '../ids';
import { parseBody, type Deps } from './app';

const id = (v: string, what = 'id') => {
  if (!ULID_RE.test(v)) throw new AppError('invalid_request', `Invalid ${what}.`);
  return v;
};

export function registerRoutes(app: Hono, deps: Deps): void {
  const { store, registry, jobs, config } = deps;
  const gen = { store, registry, jobs };

  // ---------- health ----------
  app.get('/api/health', async (c) => c.json(await registry.health(c.req.query('refresh') === '1')));

  // ---------- maps ----------
  app.get('/api/maps', async (c) => c.json(await store.list()));

  app.post('/api/maps', async (c) => {
    const body = await parseBody(c, CreateMapBodySchema);
    const health = await registry.health();
    const provider: ProviderId | null = body.provider ?? health.defaultProvider;
    if (!provider) {
      const first = health.providers[0];
      throw new AppError(
        !first || !first.installed ? 'provider_not_installed' : 'provider_not_logged_in',
        health.providers.map((p) => [p.reason, p.fix].filter(Boolean).join(' ')).join(' ') || 'No provider is available.',
      );
    }
    const status = health.providers.find((p) => p.id === provider);
    if (!status) throw new AppError('invalid_request', `Unknown provider "${provider}".`);
    if (!status.usable) {
      throw new AppError(
        !status.installed ? 'provider_not_installed' : status.auth === 'api_key' ? 'provider_api_key_auth' : 'provider_not_logged_in',
        [status.reason, status.fix].filter(Boolean).join(' '),
      );
    }
    const map = createMap(body.topic, {
      level: body.level ?? 'beginner',
      goal: body.goal || null,
      provider,
      model: body.model ?? null,
    });
    await store.create(map);
    return c.json({ map }, 201);
  });

  app.get('/api/maps/:mapId', async (c) => c.json({ map: await store.get(id(c.req.param('mapId'))) }));

  app.patch('/api/maps/:mapId', async (c) => {
    const mapId = id(c.req.param('mapId'));
    const body = await parseBody(c, PatchMapBodySchema);
    if (body.settings?.provider && !registry.get(body.settings.provider)) {
      throw new AppError('invalid_request', `Unknown provider "${body.settings.provider}".`);
    }
    await store.mutate(mapId, (m) => {
      if (body.title) m.title = body.title;
      if (body.settings) {
        const s = body.settings;
        if (s.level) m.settings.level = s.level;
        if (s.goal !== undefined) m.settings.goal = s.goal || null;
        if (s.provider) m.settings.provider = s.provider;
        if (s.model !== undefined) m.settings.model = s.model;
      }
    });
    return c.json({ map: await store.get(mapId) });
  });

  app.delete('/api/maps/:mapId', async (c) => {
    const mapId = id(c.req.param('mapId'));
    await store.get(mapId); // 404 for an unknown map before anything is stopped
    // Stop anything still being written for this map, and let it finish restoring its node, so it
    // cannot spend plan quota for a map that is going away or write the file back afterwards.
    await jobs.abortAndWait(`${mapId}:`);
    await store.delete(mapId);
    return c.body(null, 204);
  });

  app.patch('/api/maps/:mapId/view', async (c) => {
    const mapId = id(c.req.param('mapId'));
    const body = await parseBody(c, PatchViewBodySchema);
    await store.mutate(mapId, (m) => patchView(m, body), { deferWrite: true });
    return c.json({ view: (await store.get(mapId)).view });
  });

  app.patch('/api/maps/:mapId/positions', async (c) => {
    const mapId = id(c.req.param('mapId'));
    const body = await parseBody(c, PatchPositionsBodySchema);
    const changed = await store.mutate(mapId, (m) => [
      ...(body.reset ? resetPositions(m) : []),
      ...(body.positions ? setPositions(m, body.positions) : []),
    ]);
    const after = await store.get(mapId);
    return c.json({ nodes: [...new Set(changed)].map((i) => after.nodes[i]).filter(Boolean) });
  });

  app.post('/api/maps/:mapId/export', async (c) => {
    const map = await store.get(id(c.req.param('mapId')));
    return c.json(await exportMap(map, config.exportsDir));
  });

  // ---------- nodes ----------
  app.post('/api/maps/:mapId/nodes', async (c) => {
    const mapId = id(c.req.param('mapId'));
    const body = await parseBody(c, OpenConceptBodySchema);
    const r = await store.mutate(mapId, (m) => openConcept(m, body.fromNodeId, body.term, body.snippet));
    const node = (await store.get(mapId)).nodes[r.node.id] as ConceptNode;
    return c.json({ node, created: r.created }, r.created ? 201 : 200);
  });

  app.patch('/api/maps/:mapId/nodes/:nodeId', async (c) => {
    const mapId = id(c.req.param('mapId'));
    const nodeId = id(c.req.param('nodeId'));
    const body = await parseBody(c, PatchNodeBodySchema);
    await store.mutate(mapId, (m) => {
      const n = m.nodes[nodeId];
      if (!n) throw new AppError('not_found', 'Node not found.');
      if (body.title) renameNode(m, nodeId, body.title);
      if (body.collapsed !== undefined) n.collapsed = body.collapsed;
    });
    return c.json({ node: (await store.get(mapId)).nodes[nodeId] });
  });

  app.delete('/api/maps/:mapId/nodes/:nodeId', async (c) => {
    const mapId = id(c.req.param('mapId'));
    const nodeId = id(c.req.param('nodeId'));
    const map = await store.get(mapId);
    if (!map.nodes[nodeId]) throw new AppError('not_found', 'Node not found.');
    if (jobs.hasAny(subtreeKeys(mapId, map, nodeId))) throw new AppError('conflict', 'Wait for the running generation to finish, or stop it first.');
    const r = await store.mutate(mapId, (m) => deleteNode(m, nodeId));
    const after = await store.get(mapId);
    return c.json({
      removedIds: r.removedIds,
      nodes: r.changedIds.map((i) => after.nodes[i]).filter(Boolean),
      view: after.view,
    });
  });

  app.post('/api/maps/:mapId/nodes/:nodeId/merge', async (c) => {
    const mapId = id(c.req.param('mapId'));
    const nodeId = id(c.req.param('nodeId'));
    const body = await parseBody(c, MergeBodySchema);
    if (jobs.hasAny([jobKey(mapId, nodeId), jobKey(mapId, body.intoId)])) {
      throw new AppError('conflict', 'Wait for the running generation to finish, or stop it first.');
    }
    const r = await store.mutate(mapId, (m) => mergeNodes(m, nodeId, body.intoId));
    const after = await store.get(mapId);
    return c.json({
      removedIds: r.removedIds,
      nodes: r.changedIds.map((i) => after.nodes[i]).filter(Boolean),
      view: after.view,
    });
  });

  app.delete('/api/maps/:mapId/nodes/:nodeId/thread/:messageId', async (c) => {
    const mapId = id(c.req.param('mapId'));
    const nodeId = id(c.req.param('nodeId'));
    const messageId = id(c.req.param('messageId'), 'message id');
    if (jobs.has(jobKey(mapId, nodeId))) throw new AppError('conflict', 'Wait for the running generation to finish, or stop it first.');
    await store.mutate(mapId, (m) => deleteMessage(m, nodeId, messageId));
    return c.json({ node: (await store.get(mapId)).nodes[nodeId] });
  });

  // ---------- generation (server-sent events) ----------
  const sse = (c: Parameters<typeof streamSSE>[0], runner: Runner) =>
    streamSSE(c, async (stream) => {
      stream.onAbort(() => runner.abort());
      const ping = setInterval(() => void stream.write(': ping\n\n').catch(() => undefined), 15_000);
      try {
        await runner.run(async (e) => {
          await stream.writeSSE({ event: e.event, data: JSON.stringify(e.data) });
        });
      } finally {
        clearInterval(ping);
      }
    });

  app.post('/api/maps/:mapId/nodes/:nodeId/expand', async (c) => {
    const mapId = id(c.req.param('mapId'));
    const nodeId = id(c.req.param('nodeId'));
    const body = await parseBody(c, ExpandBodySchema);
    return sse(c, await prepareExpand(gen, mapId, nodeId, body.regenerate === true));
  });

  app.post('/api/maps/:mapId/nodes/:nodeId/ask', async (c) => {
    const mapId = id(c.req.param('mapId'));
    const nodeId = id(c.req.param('nodeId'));
    const body = await parseBody(c, AskBodySchema);
    return sse(c, await prepareAsk(gen, mapId, nodeId, body));
  });
}
