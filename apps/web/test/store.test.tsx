import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useStore } from '../src/state/store';
import { jsonResponse, loadMap, sampleMap, sseResponse } from './helpers';

const st = () => useStore.getState();

beforeEach(() => {
  loadMap();
  vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ view: {} })));
});
afterEach(() => vi.unstubAllGlobals());

describe('navigation', () => {
  it('records the trail, collapsing consecutive duplicates', () => {
    st().select('c');
    st().select('c');
    st().select('ch');
    expect(st().map!.view.trail).toEqual(['r', 'c', 'ch']);
    expect(st().map!.view.selectedId).toBe('ch');
  });

  it('back and forward step through the trail like a browser', () => {
    st().select('c');
    st().select('ch');
    st().back();
    expect(st().map!.view.selectedId).toBe('c');
    expect(st().map!.view.trail).toEqual(['r', 'c']);
    expect(st().forward).toEqual(['ch']);
    st().back();
    expect(st().map!.view.selectedId).toBe('r');
    st().back(); // at the start: nothing happens
    expect(st().map!.view.selectedId).toBe('r');
    st().forwardNav();
    st().forwardNav();
    expect(st().map!.view.selectedId).toBe('ch');
    expect(st().forward).toEqual([]);
    st().back();
    st().select('t'); // a new visit clears forward
    expect(st().forward).toEqual([]);
    expect(st().map!.view.trail).toEqual(['r', 'c', 't']);
  });

  it('anchor: set, go back to it', () => {
    st().select('c');
    st().setAnchor('c');
    st().select('ch');
    st().select('t');
    st().goToAnchor();
    expect(st().map!.view.selectedId).toBe('c');
    expect(st().map!.view.anchorId).toBe('c');
  });

  it('ignores unknown ids', () => {
    st().select('nope');
    st().setAnchor('nope');
    expect(st().map!.view.selectedId).toBe('r');
    expect(st().map!.view.anchorId).toBe('r');
  });

  it('persists view changes to the server', () => {
    st().select('c');
    const f = vi.mocked(fetch);
    const call = f.mock.calls.find((c) => String(c[0]).endsWith('/view'))!;
    expect(JSON.parse((call[1] as RequestInit).body as string)).toEqual({ selectedId: 'c', trail: ['r', 'c'] });
  });
});

describe('explain', () => {
  const node = (over: object) => ({ ...sampleMap().nodes.ch!, ...over });

  it('applies start, deltas and done from the stream', async () => {
    const seen: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async () => sseResponse([
      { event: 'start', data: { nodes: [node({ status: 'generating' })] } },
      { event: 'status', data: { phase: 'generating' } },
      { event: 'delta', data: { text: 'Hello ' } },
      { event: 'delta', data: { text: '[[World]]' } },
      { event: 'done', data: { nodes: [node({ status: 'ready', body: 'Hello [[World]]' }), node({ id: 'w', title: 'World', parentId: 'ch', status: 'stub' })] } },
    ])));
    const unsub = useStore.subscribe((s) => {
      const x = s.streams.ch;
      if (x) seen.push(`${x.phase}:${x.text}`);
    });
    await st().explain('ch');
    unsub();
    expect(seen).toContain('generating:Hello [[World]]');
    expect(st().streams.ch).toBeUndefined();
    expect(st().map!.nodes.ch!.status).toBe('ready');
    expect(st().map!.nodes.ch!.body).toBe('Hello [[World]]');
    expect(st().map!.nodes.w!.title).toBe('World');
    expect(st().index!.children.get('ch')).toEqual(['w']);
  });

  it('shows the node error from an error event', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => sseResponse([
      { event: 'start', data: { nodes: [node({ status: 'generating' })] } },
      { event: 'error', data: { code: 'rate_limited', message: 'Usage limit reached.', nodes: [node({ status: 'error', error: { code: 'rate_limited', message: 'Usage limit reached.' } })] } },
    ])));
    await st().explain('ch');
    expect(st().map!.nodes.ch!.status).toBe('error');
    expect(st().map!.nodes.ch!.error!.message).toBe('Usage limit reached.');
    expect(st().streams.ch).toBeUndefined();
  });

  it('a JSON error before the stream becomes a banner', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ error: { code: 'provider_not_logged_in', message: 'Run "claude" and /login.' } }, 503)));
    await st().explain('ch');
    expect(st().banner).toMatchObject({ kind: 'error', text: 'Run "claude" and /login.' });
    expect(st().streams.ch).toBeUndefined();
  });

  it('Stop aborts the request and re-reads the map from the server', async () => {
    const restored = sampleMap();
    let aborted = false;
    vi.stubGlobal('fetch', vi.fn((url: string, init?: RequestInit) => {
      if (init?.method === 'POST') {
        return new Promise<Response>((_, reject) => {
          init.signal!.addEventListener('abort', () => {
            aborted = true;
            reject(new DOMException('aborted', 'AbortError'));
          });
        });
      }
      return Promise.resolve(jsonResponse({ map: restored }));
    }));
    const p = st().explain('ch');
    await vi.waitFor(() => expect(st().streams.ch).toBeDefined());
    st().stop('ch');
    await p;
    expect(aborted).toBe(true);
    expect(st().streams.ch).toBeUndefined();
    expect(st().banner).toBeNull();
    expect(st().map!.nodes.ch!.status).toBe('stub');
  });

  it('does not start a second stream for the same node', async () => {
    let posts = 0;
    vi.stubGlobal('fetch', vi.fn((url: string, init?: RequestInit) => {
      if (init?.method === 'POST') {
        posts++;
        return new Promise<Response>((_, reject) => init.signal!.addEventListener('abort', () => reject(new DOMException('a', 'AbortError'))));
      }
      return Promise.resolve(jsonResponse({ map: sampleMap() }));
    }));
    const a = st().explain('ch');
    await vi.waitFor(() => expect(st().streams.ch).toBeDefined());
    void st().explain('ch');
    expect(posts).toBe(1);
    st().stop('ch');
    await a;
  });
});

describe('structure changes', () => {
  it('delete applies removed ids and cleans the forward stack', async () => {
    st().select('c');
    st().select('ch');
    st().back();
    expect(st().forward).toEqual(['ch']);
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ removedIds: ['c', 'ch'], nodes: [], view: { selectedId: 'r', anchorId: 'r', trail: ['r'], viewport: null } })));
    await st().deleteNode('c');
    expect(Object.keys(st().map!.nodes).sort()).toEqual(['r', 't']);
    expect(st().forward).toEqual([]);
    expect(st().map!.view.selectedId).toBe('r');
    expect(st().index!.children.get('r')).toEqual(['t']);
  });

  it('openConcept selects an existing node without calling the server', async () => {
    const f = vi.fn();
    vi.stubGlobal('fetch', f);
    await st().openConcept('r', 'channels');
    expect(st().map!.view.selectedId).toBe('ch');
    expect(f.mock.calls.filter((c) => String(c[0]).endsWith('/nodes'))).toHaveLength(0);
  });

  it('a failed rename returns false and raises a banner', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ error: { code: 'conflict', message: '"Transformer" already uses that name.' } }, 409)));
    expect(await st().renameNode('ch', 'transformer')).toBe(false);
    expect(st().banner?.text).toContain('already uses');
  });
});
