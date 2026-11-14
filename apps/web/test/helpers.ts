import { buildIndex, type ConceptNode, type MapFile } from '@mindmapper/shared';
import { useStore } from '../src/state/store';

let n = 0;
export function mkNode(p: Partial<ConceptNode> & { id: string; title: string }): ConceptNode {
  n++;
  return {
    aliases: [],
    parentId: null,
    summary: '',
    body: null,
    status: 'stub',
    error: null,
    origin: null,
    related: [],
    thread: [],
    collapsed: false,
    generatedBy: null,
    createdAt: `2026-01-01T00:00:${String(n % 60).padStart(2, '0')}.${String(n).padStart(3, '0')}Z`,
    updatedAt: '',
    ...p,
  };
}

export function sampleMap(): MapFile {
  const nodes = [
    mkNode({ id: 'r', title: 'Deep learning', status: 'ready', body: 'About [[CNN]] and [[Ghost Thing]].', summary: 'The field.' }),
    mkNode({ id: 'c', title: 'Convolutional Neural Network', aliases: ['CNN'], parentId: 'r', status: 'ready', body: 'Uses [[Channel]].', summary: 'Image models.' }),
    mkNode({ id: 'ch', title: 'Channel', parentId: 'c', summary: 'A feature plane.' }),
    mkNode({ id: 't', title: 'Transformer', parentId: 'r', summary: 'Attention models.' }),
  ];
  return {
    schemaVersion: 1,
    id: 'MAPID',
    title: 'Deep learning',
    createdAt: '',
    updatedAt: '',
    settings: { level: 'beginner', goal: null, provider: 'fake', model: null },
    rootId: 'r',
    nodes: Object.fromEntries(nodes.map((x) => [x.id, x])),
    view: { selectedId: 'r', anchorId: 'r', trail: ['r'], viewport: null },
  };
}

export function loadMap(map = sampleMap()) {
  useStore.setState({ map, index: buildIndex(map), forward: [], streams: {}, banner: null, askQuote: null });
  return map;
}

export function sseResponse(events: { event: string; data: unknown }[], status = 200): Response {
  const text = events.map((e) => `event: ${e.event}\ndata: ${JSON.stringify(e.data)}\n\n`).join('');
  return new Response(text, { status, headers: { 'content-type': 'text/event-stream' } });
}

export function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}
