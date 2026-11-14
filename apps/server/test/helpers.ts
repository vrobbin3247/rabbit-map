import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { assertInvariants, type ConceptNode, type MapFile, type StreamEvent } from '@mindmapper/shared';
import { ensureDirs, loadConfig } from '../src/config';
import { JobManager } from '../src/generation/jobs';
import { createApp } from '../src/http/app';
import { Registry } from '../src/providers/registry';
import { MapStore } from '../src/store/mapStore';

export function makeEnv(extra: Record<string, string> = {}) {
  const dir = mkdtempSync(path.join(tmpdir(), 'mm-test-'));
  const config = loadConfig({
    MINDMAPPER_DATA_DIR: dir,
    MINDMAPPER_PROVIDER: 'fake',
    MINDMAPPER_FAKE_DELAY_MS: '0',
    MINDMAPPER_PORT: '8787',
    ...extra,
  });
  ensureDirs(config);
  const store = new MapStore(config.mapsDir, 5);
  const registry = new Registry(config);
  const jobs = new JobManager(config.maxConcurrency);
  const app = createApp({ config, store, registry, jobs });

  const call = (method: string, url: string, body?: unknown, headers: Record<string, string> = {}) =>
    app.request(`http://127.0.0.1:8787${url}`, {
      method,
      headers: { 'content-type': 'application/json', ...headers },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  const json = async <T = any>(method: string, url: string, body?: unknown): Promise<{ status: number; body: T }> => {
    const res = await call(method, url, body);
    const text = await res.text();
    return { status: res.status, body: (text ? JSON.parse(text) : null) as T };
  };
  const stream = async (url: string, body: unknown = {}): Promise<{ status: number; events: StreamEvent[]; json?: any }> => {
    const res = await call('POST', url, body);
    const text = await res.text();
    if (!res.headers.get('content-type')?.includes('text/event-stream')) {
      return { status: res.status, events: [], json: text ? JSON.parse(text) : null };
    }
    return { status: res.status, events: parseSse(text) };
  };
  const cleanup = async () => {
    await store.flush();
    rmSync(dir, { recursive: true, force: true });
  };
  return { dir, config, store, registry, jobs, app, call, json, stream, cleanup };
}

export function parseSse(text: string): StreamEvent[] {
  const out: StreamEvent[] = [];
  for (const block of text.split('\n\n')) {
    const ev = block.match(/^event: (.*)$/m)?.[1];
    const data = block.match(/^data: (.*)$/m)?.[1];
    if (ev && data) out.push({ event: ev, data: JSON.parse(data) } as StreamEvent);
  }
  return out;
}

export const names = (nodes: ConceptNode[]) => nodes.map((n) => n.title);

export function expectValid(map: MapFile): void {
  const problems = assertInvariants(map);
  if (problems.length) throw new Error('Invariants broken: ' + problems.join('; '));
}

export async function until(cond: () => boolean, ms = 3000): Promise<void> {
  const t0 = Date.now();
  while (!cond()) {
    if (Date.now() - t0 > ms) throw new Error('timed out waiting for condition');
    await new Promise((r) => setTimeout(r, 10));
  }
}
