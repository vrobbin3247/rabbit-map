import { buildIndex } from '@mindmapper/shared';
import { describe, expect, it } from 'vitest';
import { NODE_H, NODE_W, computeAuto, computeLayout, placeNodes } from '../src/canvas/layout';
import { sampleMap } from './helpers';

describe('computeLayout', () => {
  it('positions every node without overlap, root left of its children', () => {
    const map = sampleMap();
    const l = computeLayout(map, buildIndex(map));
    expect(l.visible.sort()).toEqual(['c', 'ch', 'r', 't']);
    const boxes = [...l.positions.values()];
    for (let i = 0; i < boxes.length; i++) {
      for (let j = i + 1; j < boxes.length; j++) {
        const a = boxes[i]!;
        const b = boxes[j]!;
        const overlap = a.x < b.x + NODE_W && b.x < a.x + NODE_W && a.y < b.y + NODE_H && b.y < a.y + NODE_H;
        expect(overlap).toBe(false);
      }
    }
    expect(l.positions.get('r')!.x).toBeLessThan(l.positions.get('c')!.x);
    expect(l.positions.get('c')!.x).toBeLessThan(l.positions.get('ch')!.x);
    expect(l.edges.map((e) => e.id).sort()).toEqual(['t:c-ch', 't:r-c', 't:r-t']);
  });

  it('a node the learner placed stays put, and its unplaced branch follows it', () => {
    const map = sampleMap();
    const before = computeLayout(map, buildIndex(map)).positions;
    map.nodes.c!.position = { x: before.get('c')!.x + 300, y: before.get('c')!.y + 150 };
    const after = computeLayout(map, buildIndex(map)).positions;
    expect(after.get('c')).toEqual({ x: before.get('c')!.x + 300, y: before.get('c')!.y + 150 });
    expect(after.get('ch')).toEqual({ x: before.get('ch')!.x + 300, y: before.get('ch')!.y + 150 }); // follows
    expect(after.get('t')).toEqual(before.get('t')); // sibling untouched
    expect(after.get('r')).toEqual(before.get('r'));
  });

  it('a child the learner placed does not follow its parent', () => {
    const map = sampleMap();
    const before = computeLayout(map, buildIndex(map)).positions;
    map.nodes.ch!.position = { x: 5, y: 7 };
    map.nodes.c!.position = { x: before.get('c')!.x + 100, y: before.get('c')!.y };
    const after = computeLayout(map, buildIndex(map)).positions;
    expect(after.get('ch')).toEqual({ x: 5, y: 7 });
  });

  it('live drag positions override without touching the map', () => {
    const map = sampleMap();
    const base = computeAuto(map, buildIndex(map));
    const live = placeNodes(map, base, { c: { x: 1000, y: 1000 } });
    expect(live.get('c')).toEqual({ x: 1000, y: 1000 });
    expect(live.get('ch')!.x).toBeGreaterThan(base.auto.get('ch')!.x + 500);
    expect(map.nodes.c!.position ?? null).toBeNull();
  });

  it('leaves out collapsed subtrees and counts them', () => {
    const map = sampleMap();
    map.nodes.c!.collapsed = true;
    const l = computeLayout(map, buildIndex(map));
    expect(l.visible.sort()).toEqual(['c', 'r', 't']);
    expect(l.hidden.get('c')).toBe(1);
  });
});
