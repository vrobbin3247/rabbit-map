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

  it('clearTrail keeps only the card you are on, drops forward history and does not touch the map', () => {
    st().select('c');
    st().select('ch');
    st().back();
    st().clearTrail();
    expect(st().map!.view.trail).toEqual(['c']);
    expect(st().map!.view.selectedId).toBe('c');
    expect(st().forward).toEqual([]);
    expect(Object.keys(st().map!.nodes).sort()).toEqual(['c', 'ch', 'r', 't']);
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

describe('moving nodes', () => {
  it('applies the position at once and saves it', async () => {
    const f = vi.fn(async () => jsonResponse({ nodes: [] }));
    vi.stubGlobal('fetch', f);
    const p = st().moveNodes({ c: { x: 40, y: 50 } });
    expect(st().map!.nodes.c!.position).toEqual({ x: 40, y: 50 }); // before the request finishes
    await p;
    const call = f.mock.calls.find((c) => String((c as unknown[])[0]).endsWith('/positions')) as unknown as [string, RequestInit];
    expect(call[1].method).toBe('PATCH');
    expect(JSON.parse(call[1].body as string)).toEqual({ positions: { c: { x: 40, y: 50 } } });
  });

  it('tidy up clears every position', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ nodes: [] })));
    await st().moveNodes({ c: { x: 1, y: 2 }, t: { x: 3, y: 4 } });
    await st().tidyUp();
    expect(Object.values(st().map!.nodes).every((n) => !n.position)).toBe(true);
  });

  it('re-reads the map when saving fails', async () => {
    const server = sampleMap();
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) =>
      init?.method === 'PATCH' ? jsonResponse({ error: { code: 'storage_failed', message: 'disk full' } }, 500) : jsonResponse({ map: server })));
    await st().moveNodes({ c: { x: 9, y: 9 } });
    expect(st().banner?.text).toBe('disk full');
    expect(st().map!.nodes.c!.position ?? null).toBeNull();
  });
});

describe('card colour', () => {
  it('shows the colour at once, then keeps what the server says', async () => {
    let release!: (r: Response) => void;
    vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>((res) => (release = res))));
    const p = st().setColor('c', 3);
    expect(st().map!.nodes.c!.color).toBe(3); // before the server has answered
    release(jsonResponse({ node: { ...st().map!.nodes.c!, color: 3 } }));
    await p;
    expect(st().map!.nodes.c!.color).toBe(3);
  });

  it('goes back to the old colour when saving fails', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ error: { code: 'storage_failed', message: 'disk full' } }, 500)));
    await st().setColor('c', 2);
    expect(st().map!.nodes.c!.color ?? null).toBeNull();
    expect(st().banner?.text).toBe('disk full');
  });

  it('null returns the card to its depth colour', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ node: { ...st().map!.nodes.c!, color: null } })));
    st().map!.nodes.c!.color = 4;
    await st().setColor('c', null);
    expect(st().map!.nodes.c!.color).toBeNull();
  });
});

describe('add the rest', () => {
  it('adds the cards the server created and says how many', async () => {
    const created = { ...sampleMap().nodes.t!, id: 'n1', title: 'Mentioned One', parentId: 'c', status: 'stub' as const };
    const f = vi.fn(async () => jsonResponse({ created: 1, nodes: [useStore.getState().map!.nodes.c!, created] }));
    vi.stubGlobal('fetch', f);
    await st().adoptGhosts('c');
    expect(st().map!.nodes.n1?.title).toBe('Mentioned One');
    expect(st().index!.children.get('c')).toContain('n1');
    expect(st().banner?.text).toBe('Added 1 card.');
    expect(JSON.parse((f.mock.calls[0] as unknown as [string, RequestInit])[1].body as string)).toEqual({});
  });

  it('can be limited to some concepts, and reports when there was nothing to add', async () => {
    const f = vi.fn(async () => jsonResponse({ created: 0, nodes: [] }));
    vi.stubGlobal('fetch', f);
    await st().adoptGhosts('c', ['Only This']);
    expect(JSON.parse((f.mock.calls[0] as unknown as [string, RequestInit])[1].body as string)).toEqual({ terms: ['Only This'] });
    expect(st().banner?.text).toBe('Nothing to add.');
  });
});

describe('undo', () => {
  const deleted = (id: string, label: string) =>
    jsonResponse({ removedIds: [id], nodes: [], view: { selectedId: 'r', anchorId: 'r', trail: ['r'], viewport: null }, undo: { id: 'U1', label } });

  it('a delete offers Undo, with a button on the message', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => deleted('t', 'Deleted “Transformer”')));
    await st().deleteNode('t');
    expect(st().undo).toEqual({ id: 'U1', label: 'Deleted “Transformer”' });
    expect(st().banner).toMatchObject({ kind: 'info', text: 'Deleted “Transformer”', action: { label: 'Undo' } });
    expect(st().map!.nodes.t).toBeUndefined();
  });

  it('Undo puts the map back from the server, clears the offer, and says so', async () => {
    const full = sampleMap();
    vi.stubGlobal('fetch', vi.fn(async (url: string) => (String(url).endsWith('/undo') ? jsonResponse({ map: full, label: 'Deleted “Transformer”' }) : deleted('t', 'Deleted “Transformer”'))));
    await st().deleteNode('t');
    st().banner!.action!.run();
    await vi.waitFor(() => expect(st().undo).toBeNull());
    expect(st().map!.nodes.t?.title).toBe('Transformer');
    expect(st().index!.children.get('r')).toContain('t'); // the board's index was rebuilt
    expect(st().banner?.text).toBe('Undone: Deleted “Transformer”.');
  });

  it('sends the id it was given, once', async () => {
    const f = vi.fn(async (url: string) => (String(url).endsWith('/undo') ? jsonResponse({ map: sampleMap(), label: 'x' }) : deleted('t', 'x')));
    vi.stubGlobal('fetch', f);
    await st().deleteNode('t');
    await st().undoLast();
    await st().undoLast(); // nothing left to undo: no second request
    const calls = f.mock.calls.filter((c) => String(c[0]).endsWith('/undo')) as unknown as [string, RequestInit][];
    expect(calls).toHaveLength(1);
    expect(JSON.parse(calls[0]![1].body as string)).toEqual({ undoId: 'U1' });
  });

  it('a refused undo shows the reason and can be retried; an expired one is forgotten', async () => {
    let code = 'conflict';
    vi.stubGlobal('fetch', vi.fn(async (url: string) => (String(url).endsWith('/undo') ? jsonResponse({ error: { code, message: 'It changed after that.' } }, code === 'conflict' ? 409 : 404) : deleted('t', 'x'))));
    await st().deleteNode('t');
    await st().undoLast();
    expect(st().banner).toMatchObject({ kind: 'error', text: 'It changed after that.' });
    expect(st().undo).not.toBeNull(); // still offered
    code = 'not_found';
    await st().undoLast();
    expect(st().undo).toBeNull();
  });

  it('a merge offers Undo too, and opening another map forgets it', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ removedIds: ['ch'], nodes: [], view: { selectedId: 'r', anchorId: 'r', trail: ['r'], viewport: null }, undo: { id: 'U2', label: 'Merged “Channel” into “Transformer”' } })));
    await st().mergeNode('ch', 't');
    expect(st().undo?.id).toBe('U2');
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ map: { ...sampleMap(), id: 'OTHER' }, maps: [], unreadable: [], providers: [] })));
    await st().openMap('OTHER');
    expect(st().undo).toBeNull();
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
