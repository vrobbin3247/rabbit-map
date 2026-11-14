import { describe, expect, it } from 'vitest';
import { assertInvariants, buildIndex, depthOf, isAncestor, pathOf, progress, resolve, subtreeOf, unopened } from '../src/graph';
import type { ConceptNode, MapFile } from '../src/types';

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
    createdAt: `2026-01-01T00:00:${String(n).padStart(2, '0')}Z`,
    updatedAt: '2026-01-01T00:00:00Z',
    ...p,
  };
}

function sampleMap(): MapFile {
  const root = mkNode({ id: 'r', title: 'Deep learning', body: 'About [[CNN]] and [[Channels]] and [[Ghost Thing]].', status: 'ready' });
  const cnn = mkNode({ id: 'c', title: 'Convolutional Neural Network', aliases: ['CNN'], parentId: 'r', body: 'Uses [[Channel]].', status: 'ready' });
  const ch = mkNode({ id: 'ch', title: 'Channel', parentId: 'c', body: 'x', status: 'ready' });
  const other = mkNode({
    id: 'o',
    title: 'Image Basics',
    parentId: 'r',
    related: ['ch'],
    status: 'ready',
    body: 'Pixels.',
    thread: [
      { id: 't1', role: 'assistant', text: 'See [[Deep learning]].', quote: null, status: 'ready', error: null, generatedBy: null, createdAt: '' },
    ],
  });
  return {
    schemaVersion: 1,
    id: 'm',
    title: 'Deep learning',
    createdAt: '',
    updatedAt: '',
    settings: { level: 'beginner', goal: null, provider: 'fake', model: null },
    rootId: 'r',
    nodes: { r: root, c: cnn, ch, o: other },
    view: { selectedId: 'r', anchorId: 'r', trail: ['r'], viewport: null },
  };
}

describe('graph', () => {
  const map = sampleMap();
  const idx = buildIndex(map);

  it('resolves titles, aliases, plurals and case', () => {
    expect(resolve(idx, 'cnn')).toBe('c');
    expect(resolve(idx, 'channels')).toBe('ch');
    expect(resolve(idx, 'Deep Learning')).toBe('r');
    expect(resolve(idx, 'nothing')).toBeUndefined();
  });

  it('title slugs beat alias slugs', () => {
    const m = sampleMap();
    (m.nodes.o as ConceptNode).aliases = ['Channel'];
    expect(resolve(buildIndex(m), 'Channel')).toBe('ch');
  });

  it('derives links, back-links and ghosts', () => {
    expect([...(idx.outLinks.get('r') ?? [])].sort()).toEqual(['c', 'ch']);
    expect([...(idx.outLinks.get('o') ?? [])].sort()).toEqual(['ch', 'r']);
    expect([...(idx.backLinks.get('ch') ?? [])].sort()).toEqual(['c', 'o', 'r']);
    expect(idx.ghostTargets.get('r')).toEqual(['Ghost Thing']);
  });

  it('computes depth, path, subtree and ancestry', () => {
    expect(idx.depth.get('ch')).toBe(2);
    expect(pathOf(map, 'ch')).toEqual(['r', 'c', 'ch']);
    expect(depthOf(map, 'ch')).toBe(2);
    expect(subtreeOf(map, 'c').sort()).toEqual(['c', 'ch']);
    expect(isAncestor(map, 'r', 'ch')).toBe(true);
    expect(isAncestor(map, 'ch', 'ch')).toBe(false);
    expect(isAncestor(map, 'o', 'ch')).toBe(false);
  });

  it('sample map satisfies invariants', () => {
    expect(assertInvariants(map)).toEqual([]);
  });
});

describe('unopened and progress', () => {
  function bigger(): MapFile {
    const m = sampleMap(); // r, c, ch and o are all explained
    m.nodes.s1 = mkNode({ id: 's1', title: 'Stub One', parentId: 'r', summary: 'first' });
    m.nodes.s2 = mkNode({ id: 's2', title: 'Stub Two', parentId: 'c', status: 'error', error: { code: 'rate_limited', message: 'x' } });
    m.nodes.g = mkNode({ id: 'g', title: 'Busy', parentId: 'o', status: 'generating' });
    return m;
  }

  it('lists stubs and failed cards, not explained or being-written ones, grouped by parent, shallow first', () => {
    const m = bigger();
    const groups = unopened(m, buildIndex(m));
    expect(groups.map((g) => [g.parentTitle, g.items.map((i) => i.title)])).toEqual([
      ['Deep learning', ['Stub One']],
      ['Convolutional Neural Network', ['Stub Two']],
    ]);
    expect(groups[1]!.items.map((i) => i.status)).toEqual(['error']);
    expect(groups[0]!.items[0]).toMatchObject({ summary: 'first', depth: 1 });
  });

  it('can be limited to one branch, without the branch root itself', () => {
    const m = bigger();
    const idx = buildIndex(m);
    expect(unopened(m, idx, 'c').flatMap((g) => g.items.map((i) => i.title))).toEqual(['Stub Two']);
    expect(unopened(m, idx, 's1')).toEqual([]); // a card's own branch does not include itself
    expect(unopened(m, idx, 'o')).toEqual([]);
  });

  it('counts progress', () => {
    const m = bigger();
    expect(progress(m)).toEqual({ total: 7, explained: 4, left: 2 });
    for (const n of Object.values(m.nodes)) if (n.status !== 'generating') n.status = 'ready';
    expect(progress(m)).toMatchObject({ left: 0 });
    expect(unopened(m, buildIndex(m))).toEqual([]);
  });
});
