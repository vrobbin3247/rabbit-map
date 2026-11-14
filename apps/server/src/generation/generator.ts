import {
  StreamFilter,
  EmptyOutputError,
  buildIndex,
  parseAskOutput,
  parseExpandOutput,
  resolve,
  subtreeOf,
  type ConceptNode,
  type ErrorCode,
  type Generation,
  type StreamEvent,
  type StreamPhase,
} from '@mindmapper/shared';
import { AppError } from '../errors';
import { now } from '../ids';
import { ProviderError, type Provider } from '../providers/types';
import type { Registry } from '../providers/registry';
import type { MapStore } from '../store/mapStore';
import {
  cancelAsk,
  cancelExpand,
  failAsk,
  failExpand,
  finishAsk,
  finishExpand,
  startAsk,
  startExpand,
  type AskStart,
  type ExpandPrev,
} from '../store/mutations';
import { buildAskPrompt, buildExpandPrompt } from './context';
import type { Job, JobManager } from './jobs';

export interface GenDeps {
  store: MapStore;
  registry: Registry;
  jobs: JobManager;
}

export type Emit = (e: StreamEvent) => void | Promise<void>;
export interface Runner {
  run(emit: Emit): Promise<void>;
  abort(): void;
}

export const jobKey = (mapId: string, nodeId: string) => `${mapId}:${nodeId}`;

async function usableProvider(deps: GenDeps, id: Parameters<Registry['get']>[0]): Promise<Provider> {
  const p = deps.registry.get(id);
  if (!p) throw new AppError('provider_not_installed', `The "${id}" provider is not available.`);
  const s = await p.check();
  if (!s.usable) {
    const code: ErrorCode = !s.installed
      ? 'provider_not_installed'
      : s.auth === 'api_key'
        ? 'provider_api_key_auth'
        : 'provider_not_logged_in';
    throw new AppError(code, [s.reason, s.fix].filter(Boolean).join(' '));
  }
  return p;
}

function toError(e: unknown): { code: ErrorCode; message: string } {
  if (e instanceof ProviderError || e instanceof AppError) return { code: e.code, message: e.message };
  if (e instanceof EmptyOutputError) return { code: 'empty_output', message: e.message };
  return { code: 'internal', message: (e as Error).message ?? 'Unexpected error.' };
}

function generation(provider: Provider, model: string | null, durationMs: number, metaRecovered: boolean): Generation {
  return { provider: provider.id, model, at: now(), durationMs, metaRecovered };
}

async function safeEmit(emit: Emit, e: StreamEvent): Promise<void> {
  try {
    await emit(e);
  } catch {
    /* client is gone */
  }
}

/** Validate everything that can fail before the stream opens, and register the job. */
export async function prepareExpand(deps: GenDeps, mapId: string, nodeId: string, regenerate: boolean): Promise<Runner> {
  const map = await deps.store.get(mapId);
  const node = map.nodes[nodeId];
  if (!node) throw new AppError('not_found', 'Node not found.');
  if (node.status === 'generating') throw new AppError('conflict', 'Something is already being written for this node.');
  if (node.status === 'ready' && !regenerate) throw new AppError('conflict', 'This node is already explained. Use regenerate to rewrite it.');
  const provider = await usableProvider(deps, map.settings.provider);
  const job = deps.jobs.begin(jobKey(mapId, nodeId));

  return {
    abort: () => job.abort(),
    run: (emit) => runExpand(deps, provider, job, mapId, nodeId, emit),
  };
}

function makeFilteredDelta(emit: Emit, pending: Promise<void>[]) {
  const filter = new StreamFilter();
  return {
    push: (t: string) => {
      const out = filter.push(t);
      if (out) pending.push(safeEmit(emit, { event: 'delta', data: { text: out } }));
    },
    flush: () => {
      const out = filter.flush();
      if (out) pending.push(safeEmit(emit, { event: 'delta', data: { text: out } }));
    },
  };
}

async function runExpand(
  deps: GenDeps,
  provider: Provider,
  job: Job,
  mapId: string,
  nodeId: string,
  emit: Emit,
): Promise<void> {
  const { store } = deps;
  let prev: ExpandPrev | null = null;
  const pending: Promise<void>[] = [];
  try {
    if (job.queued) await safeEmit(emit, { event: 'status', data: { phase: 'queued' } });
    await job.ready;

    prev = await store.mutate(mapId, (m) => startExpand(m, nodeId));
    const started = await store.get(mapId);
    await safeEmit(emit, { event: 'start', data: { nodes: [started.nodes[nodeId] as ConceptNode] } });

    const { system, prompt } = buildExpandPrompt(started, nodeId);
    const delta = makeFilteredDelta(emit, pending);
    const t0 = Date.now();
    const result = await provider.generate({
      system,
      prompt,
      model: started.settings.model,
      signal: job.signal,
      onDelta: delta.push,
      onStatus: (phase: StreamPhase) => pending.push(safeEmit(emit, { event: 'status', data: { phase } })),
    });
    delta.flush();
    await Promise.all(pending);

    const changed = await store.mutate(mapId, (m) => {
      const n = m.nodes[nodeId];
      if (!n) throw new AppError('not_found', 'The node was removed while it was being written.');
      const index = buildIndex(m);
      const parsed = parseExpandOutput(result.text, n.title, n.aliases, (name) => resolve(index, name));
      return finishExpand(m, nodeId, parsed, generation(provider, result.model, Date.now() - t0, parsed.metaRecovered));
    });
    const after = await store.get(mapId);
    await safeEmit(emit, { event: 'done', data: { nodes: changed.map((id) => after.nodes[id]).filter((n): n is ConceptNode => !!n) } });
  } catch (e) {
    await Promise.all(pending).catch(() => undefined);
    const err = toError(e);
    if (prev) {
      const p = prev;
      const aborted = err.code === 'aborted';
      await store
        .mutate(mapId, (m) => (aborted ? cancelExpand(m, nodeId, p) : failExpand(m, nodeId, p, err)))
        .catch(() => undefined);
    }
    const after = await store.get(mapId).catch(() => null);
    const node = after?.nodes[nodeId];
    await safeEmit(emit, { event: 'error', data: { ...err, nodes: node ? [node] : [] } });
  } finally {
    job.done();
  }
}

export interface AskInput {
  question?: string;
  quote?: string | null;
  retryMessageId?: string | null;
}

export async function prepareAsk(deps: GenDeps, mapId: string, nodeId: string, input: AskInput): Promise<Runner> {
  const map = await deps.store.get(mapId);
  const node = map.nodes[nodeId];
  if (!node) throw new AppError('not_found', 'Node not found.');
  if (node.status === 'generating') throw new AppError('conflict', 'Something is already being written for this node.');
  if (input.retryMessageId) {
    const i = node.thread.findIndex((m) => m.id === input.retryMessageId);
    const failed = node.thread[i];
    if (!failed || failed.role !== 'assistant' || failed.status !== 'error' || node.thread[i - 1]?.role !== 'user') {
      throw new AppError('invalid_request', 'Only a failed answer can be retried.');
    }
  } else if (!(input.question ?? '').trim()) {
    throw new AppError('invalid_request', 'The question is empty.');
  }
  const provider = await usableProvider(deps, map.settings.provider);
  const job = deps.jobs.begin(jobKey(mapId, nodeId));
  return {
    abort: () => job.abort(),
    run: (emit) => runAsk(deps, provider, job, mapId, nodeId, input, emit),
  };
}

async function runAsk(
  deps: GenDeps,
  provider: Provider,
  job: Job,
  mapId: string,
  nodeId: string,
  input: AskInput,
  emit: Emit,
): Promise<void> {
  const { store } = deps;
  let start: AskStart | null = null;
  const pending: Promise<void>[] = [];
  try {
    if (job.queued) await safeEmit(emit, { event: 'status', data: { phase: 'queued' } });
    await job.ready;

    start = await store.mutate(mapId, (m) => startAsk(m, nodeId, input));
    const started = await store.get(mapId);
    await safeEmit(emit, { event: 'start', data: { nodes: [started.nodes[nodeId] as ConceptNode], messageId: start.assistantId } });

    const { system, prompt } = buildAskPrompt(started, nodeId, start.question, start.quote);
    const delta = makeFilteredDelta(emit, pending);
    const t0 = Date.now();
    const s = start;
    const result = await provider.generate({
      system,
      prompt,
      model: started.settings.model,
      signal: job.signal,
      onDelta: delta.push,
      onStatus: (phase: StreamPhase) => pending.push(safeEmit(emit, { event: 'status', data: { phase } })),
    });
    delta.flush();
    await Promise.all(pending);

    const changed = await store.mutate(mapId, (m) => {
      const n = m.nodes[nodeId];
      if (!n) throw new AppError('not_found', 'The node was removed while it was being written.');
      const parsed = parseAskOutput(result.text, n.title, n.aliases);
      return finishAsk(m, nodeId, s.assistantId, parsed.text, generation(provider, result.model, Date.now() - t0, false), parsed.children);
    });
    const after = await store.get(mapId);
    await safeEmit(emit, { event: 'done', data: { nodes: changed.map((id) => after.nodes[id]).filter((n): n is ConceptNode => !!n) } });
  } catch (e) {
    await Promise.all(pending).catch(() => undefined);
    const err = toError(e);
    if (start) {
      const s = start;
      await store
        .mutate(mapId, (m) => (err.code === 'aborted' ? cancelAsk(m, nodeId, s) : failAsk(m, nodeId, s.assistantId, err)))
        .catch(() => undefined);
    }
    const after = await store.get(mapId).catch(() => null);
    const node = after?.nodes[nodeId];
    await safeEmit(emit, { event: 'error', data: { ...err, nodes: node ? [node] : [] } });
  } finally {
    job.done();
  }
}

/** Keys of every node in the subtree, for conflict checks on delete and merge. */
export function subtreeKeys(mapId: string, map: Parameters<typeof subtreeOf>[0], nodeId: string): string[] {
  return subtreeOf(map, nodeId).map((id) => jobKey(mapId, id));
}
