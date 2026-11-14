import { describe, expect, it } from 'vitest';
import { buildTrailTree, filterTrail, trailAncestors, type TrailNode } from '../src/nav/trailTree';
import { sampleMap } from './helpers';

const shape = (t: TrailNode[]): unknown => t.map((n) => ({ id: n.id, v: n.visits, d: n.direct, c: shape(n.children) }));

describe('buildTrailTree', () => {
  it('shows each card once, under its parent, with a visit count', () => {
    const m = sampleMap();
    // root, CNN, root again, CNN again, Channel
    const tree = buildTrailTree(m, ['r', 'c', 'r', 'c', 'ch']);
    expect(shape(tree)).toEqual([
      { id: 'r', v: 2, d: true, c: [{ id: 'c', v: 2, d: true, c: [{ id: 'ch', v: 1, d: true, c: [] }] }] },
    ]);
  });

  it('orders siblings by first visit, not by the map', () => {
    const m = sampleMap();
    const tree = buildTrailTree(m, ['r', 't', 'c']);
    expect(tree[0]!.children.map((n) => n.id)).toEqual(['t', 'c']);
  });

  it('a card whose parent was never visited hangs under its nearest visited ancestor, marked as a jump', () => {
    const m = sampleMap();
    const tree = buildTrailTree(m, ['r', 'ch']); // CNN was skipped
    expect(shape(tree)).toEqual([{ id: 'r', v: 1, d: true, c: [{ id: 'ch', v: 1, d: false, c: [] }] }]);
  });

  it('with no visited ancestor a card is a top-level entry; deleted cards are ignored', () => {
    const m = sampleMap();
    const tree = buildTrailTree(m, ['ch', 'gone', 't']);
    expect(tree.map((n) => n.id)).toEqual(['ch', 't']);
  });
});

describe('trailAncestors and filterTrail', () => {
  const m = sampleMap();
  const tree = buildTrailTree(m, ['r', 'c', 'ch', 't']);

  it('lists the cards above one, outermost first', () => {
    expect(trailAncestors(tree, 'ch')).toEqual(['r', 'c']);
    expect(trailAncestors(tree, 'r')).toEqual([]);
    expect(trailAncestors(tree, 'nope')).toEqual([]);
  });

  it('keeps matches and what is above them, ignoring case; no query means no filter', () => {
    const title = (id: string) => m.nodes[id]!.title;
    expect(filterTrail(tree, title, '  ')).toBeNull();
    expect([...filterTrail(tree, title, 'CHANNEL')!].sort()).toEqual(['c', 'ch', 'r']);
    expect([...filterTrail(tree, title, 'zzz')!]).toEqual([]);
  });
});
