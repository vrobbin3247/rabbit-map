import { create } from 'zustand';
import {
  LIMITS,
  buildIndex,
  pathOf,
  resolve,
  subtreeOf,
  type ConceptNode,
  type HealthResponse,
  type MapFile,
  type MapIndex,
  type MapSummary,
  type StreamEvent,
  type StreamPhase,
  type ViewState,
} from '@mindmapper/shared';
import { ApiError, api } from '../api/client';
import { postStream } from '../api/sse';

export interface StreamState {
  kind: 'expand' | 'ask';
  text: string;
  phase: StreamPhase | null;
  startedAt: number;
  messageId?: string;
}

export interface Banner {
  kind: 'error' | 'info';
  text: string;
  sticky?: boolean;
}

interface Store {
  health: HealthResponse | null;
  maps: MapSummary[];
  unreadable: { id: string; message: string }[];
  map: MapFile | null;
  index: MapIndex | null;
  forward: string[];
  streams: Record<string, StreamState>;
  banner: Banner | null;
  showAllCrossLinks: boolean;
  trailOpen: boolean;
  searchOpen: boolean;
  askQuote: string | null;
  askFocusTick: number;

  init(): Promise<void>;
  loadHealth(refresh?: boolean): Promise<void>;
  loadMaps(): Promise<void>;
  createMap(input: { topic: string; level: string; goal: string }): Promise<void>;
  openMap(id: string): Promise<void>;
  closeMap(): Promise<void>;
  renameMap(id: string, title: string): Promise<void>;
  deleteMap(id: string): Promise<void>;
  patchSettings(settings: Record<string, unknown>): Promise<void>;

  select(id: string): void;
  back(): void;
  forwardNav(): void;
  goToAnchor(): void;
  setAnchor(id: string): void;
  saveViewport(v: { x: number; y: number; zoom: number }): void;

  explain(id: string, regenerate?: boolean): Promise<void>;
  ask(id: string, question: string): Promise<void>;
  retryAsk(id: string, messageId: string): Promise<void>;
  stop(id: string): void;
  openConcept(fromId: string, term: string, snippet?: string): Promise<void>;
  renameNode(id: string, title: string): Promise<boolean>;
  deleteNode(id: string): Promise<void>;
  mergeNode(id: string, intoId: string): Promise<boolean>;
  toggleCollapse(id: string): Promise<void>;
  deleteMessage(nodeId: string, messageId: string): Promise<void>;

  setBanner(b: Banner | null): void;
  set(p: Partial<Pick<Store, 'showAllCrossLinks' | 'trailOpen' | 'searchOpen' | 'askQuote'>>): void;
  focusAsk(): void;
}

const aborters = new Map<string, AbortController>();

function errorText(e: unknown): string {
  return e instanceof ApiError ? e.message : (e as Error).message;
}

export const useStore = create<Store>()((set, get) => {
  const fail = (e: unknown) => {
    if ((e as Error).name === 'AbortError') return;
    const sticky = e instanceof ApiError && (e.code === 'storage_failed' || e.code === 'network');
    set({ banner: { kind: 'error', text: errorText(e), sticky } });
  };

  const setMap = (map: MapFile) => set({ map, index: buildIndex(map) });

  const applyNodes = (nodes: ConceptNode[]) => {
    const m = get().map;
    if (!m || !nodes.length) return;
    setMap({ ...m, nodes: { ...m.nodes, ...Object.fromEntries(nodes.map((n) => [n.id, n])) } });
  };

  const applyChanges = (c: { removedIds: string[]; nodes: ConceptNode[]; view: ViewState }) => {
    const m = get().map;
    if (!m) return;
    const nodes = { ...m.nodes };
    for (const id of c.removedIds) delete nodes[id];
    for (const n of c.nodes) nodes[n.id] = n;
    const removed = new Set(c.removedIds);
    set({ forward: get().forward.filter((f) => !removed.has(f)) });
    setMap({ ...m, nodes, view: c.view });
  };

  const patchView = (patch: object) => {
    const m = get().map;
    if (m) api.patchView(m.id, patch).catch(fail);
  };

  const refreshMap = async () => {
    const m = get().map;
    if (!m) return;
    try {
      setMap((await api.getMap(m.id)).map);
    } catch (e) {
      fail(e);
    }
  };

  /**
   * After Stop the server restores the node asynchronously, so a single re-read can still see it
   * "generating". Re-read until it settles (or give up after about three seconds).
   */
  const settleAfterStop = async (nodeId: string) => {
    for (let i = 0; i < 15; i++) {
      await refreshMap();
      const n = get().map?.nodes[nodeId];
      if (!n || (n.status !== 'generating' && !n.thread.some((m) => m.status === 'generating'))) return;
      await new Promise((r) => setTimeout(r, 200));
    }
  };

  const runStream = async (kind: 'expand' | 'ask', nodeId: string, url: string, body: object) => {
    const m = get().map;
    if (!m) return;
    if (aborters.has(nodeId)) return;
    const mapId = m.id;
    const ac = new AbortController();
    aborters.set(nodeId, ac);
    set({ streams: { ...get().streams, [nodeId]: { kind, text: '', phase: null, startedAt: Date.now() } } });
    const current = () => get().map?.id === mapId;
    const patchStream = (p: Partial<StreamState>) => {
      const s = get().streams[nodeId];
      if (s) set({ streams: { ...get().streams, [nodeId]: { ...s, ...p } } });
    };
    let aborted = false;
    try {
      await postStream(`/maps/${mapId}${url}`, body, ac.signal, (ev: StreamEvent) => {
        if (!current()) return;
        switch (ev.event) {
          case 'start':
            applyNodes(ev.data.nodes);
            if (ev.data.messageId) patchStream({ messageId: ev.data.messageId });
            break;
          case 'status':
            patchStream({ phase: ev.data.phase });
            break;
          case 'delta':
            patchStream({ text: (get().streams[nodeId]?.text ?? '') + ev.data.text });
            break;
          case 'done':
            applyNodes(ev.data.nodes);
            break;
          case 'error':
            applyNodes(ev.data.nodes);
            if (ev.data.code === 'storage_failed') set({ banner: { kind: 'error', text: ev.data.message, sticky: true } });
            break;
        }
      });
    } catch (e) {
      aborted = (e as Error).name === 'AbortError';
      if (!aborted) fail(e);
    } finally {
      aborters.delete(nodeId);
      const { [nodeId]: _gone, ...rest } = get().streams;
      set({ streams: rest });
      if (aborted && current()) await settleAfterStop(nodeId);
    }
  };

  return {
    health: null,
    maps: [],
    unreadable: [],
    map: null,
    index: null,
    forward: [],
    streams: {},
    banner: null,
    showAllCrossLinks: false,
    trailOpen: true,
    searchOpen: false,
    askQuote: null,
    askFocusTick: 0,

    async init() {
      await Promise.all([get().loadHealth(), get().loadMaps()]);
    },
    async loadHealth(refresh = false) {
      try {
        set({ health: await api.health(refresh) });
      } catch (e) {
        fail(e);
      }
    },
    async loadMaps() {
      try {
        const r = await api.listMaps();
        set({ maps: r.maps, unreadable: r.unreadable });
      } catch (e) {
        fail(e);
      }
    },
    async createMap(input) {
      try {
        const { map } = await api.createMap({ topic: input.topic, level: input.level, goal: input.goal || null });
        await get().openMap(map.id);
        void get().explain(map.rootId);
      } catch (e) {
        fail(e);
      }
    },
    async openMap(id) {
      try {
        const { map } = await api.getMap(id);
        for (const a of aborters.values()) a.abort();
        set({ forward: [], streams: {}, banner: null, askQuote: null });
        setMap(map);
        void get().loadHealth();
      } catch (e) {
        fail(e);
      }
    },
    async closeMap() {
      for (const a of aborters.values()) a.abort();
      set({ map: null, index: null, forward: [], streams: {} });
      await get().loadMaps();
    },
    async renameMap(id, title) {
      try {
        const { map } = await api.patchMap(id, { title });
        if (get().map?.id === id) setMap(map);
        await get().loadMaps();
      } catch (e) {
        fail(e);
      }
    },
    async deleteMap(id) {
      try {
        await api.deleteMap(id);
        if (get().map?.id === id) set({ map: null, index: null });
        await get().loadMaps();
      } catch (e) {
        fail(e);
      }
    },
    async patchSettings(settings) {
      const m = get().map;
      if (!m) return;
      try {
        setMap((await api.patchMap(m.id, { settings })).map);
      } catch (e) {
        fail(e);
      }
    },

    select(id) {
      const m = get().map;
      if (!m || !m.nodes[id]) return;
      let trail = m.view.trail;
      if (trail[trail.length - 1] !== id) trail = [...trail, id].slice(-LIMITS.trailMax);
      const changed = m.view.selectedId !== id;
      set({ map: { ...m, view: { ...m.view, selectedId: id, trail } }, forward: changed ? [] : get().forward });
      patchView({ selectedId: id, trail });
    },
    back() {
      const m = get().map;
      if (!m || m.view.trail.length < 2) return;
      const trail = m.view.trail.slice();
      const last = trail.pop() as string;
      const target = trail[trail.length - 1] as string;
      set({ map: { ...m, view: { ...m.view, selectedId: target, trail } }, forward: [...get().forward, last] });
      patchView({ selectedId: target, trail });
    },
    forwardNav() {
      const m = get().map;
      const f = get().forward;
      if (!m || !f.length) return;
      const next = f[f.length - 1] as string;
      const trail = [...m.view.trail, next].slice(-LIMITS.trailMax);
      set({ map: { ...m, view: { ...m.view, selectedId: next, trail } }, forward: f.slice(0, -1) });
      patchView({ selectedId: next, trail });
    },
    goToAnchor() {
      const m = get().map;
      if (m) get().select(m.view.anchorId);
    },
    setAnchor(id) {
      const m = get().map;
      if (!m || !m.nodes[id]) return;
      set({ map: { ...m, view: { ...m.view, anchorId: id } } });
      patchView({ anchorId: id });
    },
    saveViewport(v) {
      const m = get().map;
      if (!m) return;
      patchView({ viewport: v });
    },

    async explain(id, regenerate = false) {
      const m = get().map;
      if (!m) return;
      await runStream('expand', id, `/nodes/${id}/expand`, { regenerate });
    },
    async ask(id, question) {
      const quote = get().askQuote;
      set({ askQuote: null });
      await runStream('ask', id, `/nodes/${id}/ask`, { question, quote });
    },
    async retryAsk(id, messageId) {
      await runStream('ask', id, `/nodes/${id}/ask`, { retryMessageId: messageId });
    },
    stop(id) {
      aborters.get(id)?.abort();
    },
    async openConcept(fromId, term, snippet) {
      const m = get().map;
      if (!m) return;
      try {
        const existing = get().index ? resolve(get().index as MapIndex, term) : undefined;
        if (existing) return get().select(existing);
        const r = await api.openConcept(m.id, { fromNodeId: fromId, term, snippet: snippet?.slice(0, LIMITS.snippetMax) });
        applyNodes([r.node]);
        get().select(r.node.id);
        if (r.created) void get().explain(r.node.id);
      } catch (e) {
        fail(e);
      }
    },
    async renameNode(id, title) {
      const m = get().map;
      if (!m) return false;
      try {
        applyNodes([(await api.patchNode(m.id, id, { title })).node]);
        return true;
      } catch (e) {
        fail(e);
        return false;
      }
    },
    async deleteNode(id) {
      const m = get().map;
      if (!m) return;
      try {
        applyChanges(await api.deleteNode(m.id, id));
      } catch (e) {
        fail(e);
      }
    },
    async mergeNode(id, intoId) {
      const m = get().map;
      if (!m) return false;
      try {
        applyChanges(await api.mergeNode(m.id, id, intoId));
        return true;
      } catch (e) {
        fail(e);
        return false;
      }
    },
    async toggleCollapse(id) {
      const m = get().map;
      const n = m?.nodes[id];
      if (!m || !n) return;
      try {
        applyNodes([(await api.patchNode(m.id, id, { collapsed: !n.collapsed })).node]);
      } catch (e) {
        fail(e);
      }
    },
    async deleteMessage(nodeId, messageId) {
      const m = get().map;
      if (!m) return;
      try {
        applyNodes([(await api.deleteMessage(m.id, nodeId, messageId)).node]);
      } catch (e) {
        fail(e);
      }
    },

    setBanner(b) {
      set({ banner: b });
    },
    set(p) {
      set(p);
    },
    focusAsk() {
      set({ askFocusTick: get().askFocusTick + 1 });
    },
  };
});

/** Helpers shared by components. */
export function selectedNode(s: Pick<Store, 'map'>): ConceptNode | null {
  const m = s.map;
  return m && m.view.selectedId ? (m.nodes[m.view.selectedId] ?? null) : null;
}

export function pathIds(map: MapFile, id: string): string[] {
  return pathOf(map, id);
}

export function subtreeSize(map: MapFile, id: string): number {
  return subtreeOf(map, id).length;
}
