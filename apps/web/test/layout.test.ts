import { buildIndex } from '@mindmapper/shared';
import { describe, expect, it } from 'vitest';
import { NODE_H, NODE_W, computeLayout } from '../src/canvas/layout';
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

  it('leaves out collapsed subtrees and counts them', () => {
    const map = sampleMap();
    map.nodes.c!.collapsed = true;
    const l = computeLayout(map, buildIndex(map));
    expect(l.visible.sort()).toEqual(['c', 'r', 't']);
    expect(l.hidden.get('c')).toBe(1);
  });
});
