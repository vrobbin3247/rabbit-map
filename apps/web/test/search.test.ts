import { describe, expect, it } from 'vitest';
import { searchNodes } from '../src/nav/SearchPalette';
import { sampleMap } from './helpers';

describe('searchNodes', () => {
  const nodes = Object.values(sampleMap().nodes);
  it('matches titles and aliases, plural-insensitively, best match first', () => {
    expect(searchNodes(nodes, 'cnn').map((n) => n.id)).toEqual(['c']);
    expect(searchNodes(nodes, 'channels').map((n) => n.id)).toEqual(['ch']);
    expect(searchNodes(nodes, 'trans').map((n) => n.id)).toEqual(['t']);
    expect(searchNodes(nodes, 'neural').map((n) => n.id)).toEqual(['c']);
    expect(searchNodes(nodes, 'zzz')).toEqual([]);
    expect(searchNodes(nodes, '').length).toBe(4);
  });

  it('prefers the closer title among equal matches', () => {
    const long = { ...nodes[0]!, id: 'x', title: 'Deep learning Part A Detail Part B', aliases: [] };
    const short = { ...nodes[0]!, id: 'y', title: 'Deep learning Part B', aliases: [] };
    expect(searchNodes([long, short], 'part b').map((n) => n.id)).toEqual(['y', 'x']);
    expect(searchNodes([long, short], 'part b')[0]!.title).toBe('Deep learning Part B');
  });
});
