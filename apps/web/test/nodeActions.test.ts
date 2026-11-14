import { buildIndex } from '@mindmapper/shared';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { nodeMenu, type MenuItem } from '../src/nav/nodeActions';
import { useStore } from '../src/state/store';
import { jsonResponse, loadMap } from './helpers';

const ids = (entries: ReturnType<typeof nodeMenu>) => entries.filter((e): e is MenuItem => e !== 'separator').map((e) => e.id);
const calm = { busy: false, streaming: false };

beforeEach(() => {
  loadMap();
  vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ nodes: [], view: {} })));
});

describe('nodeMenu', () => {
  const menu = (id: string, state = calm) => {
    const m = useStore.getState().map!;
    return nodeMenu(m, buildIndex(m), m.nodes[id]!, state);
  };

  it('a stub offers Explain; an explained node offers Regenerate; never both', () => {
    expect(ids(menu('ch'))).toContain('explain');
    expect(ids(menu('ch'))).not.toContain('regenerate');
    expect(ids(menu('c'))).toContain('regenerate');
    expect(ids(menu('c'))).not.toContain('explain');
  });

  it('a failed node offers Try again, and a node being written offers Stop only', () => {
    useStore.getState().map!.nodes.ch!.status = 'error';
    const failed = menu('ch').find((e) => e !== 'separator' && e.id === 'explain') as MenuItem;
    expect(failed.label).toBe('Try again');
    const writing = menu('ch', { busy: true, streaming: true });
    expect(ids(writing)).toContain('stop');
    expect(ids(writing)).not.toContain('explain');
    expect(ids(writing)).not.toContain('regenerate');
  });

  it('the root cannot be merged or deleted and has no parent to go to', () => {
    expect(ids(menu('r'))).toEqual(expect.arrayContaining(['ask', 'addChild', 'rename', 'child']));
    expect(ids(menu('r'))).not.toContain('delete');
    expect(ids(menu('r'))).not.toContain('merge');
    expect(ids(menu('r'))).not.toContain('parent');
    expect(ids(menu('ch'))).toEqual(expect.arrayContaining(['parent', 'delete', 'merge']));
    expect(ids(menu('ch'))).not.toContain('child'); // a leaf
  });

  it('Release position, Collapse and Copy explanation appear only when they apply', () => {
    expect(ids(menu('c'))).not.toContain('unpin');
    expect(ids(menu('ch'))).not.toContain('collapse');
    expect(ids(menu('ch'))).not.toContain('copyText'); // no body
    expect(ids(menu('c'))).toEqual(expect.arrayContaining(['collapse', 'copyText', 'copyLink']));
    useStore.getState().map!.nodes.c!.position = { x: 1, y: 2 };
    expect(ids(menu('c'))).toContain('unpin');
  });

  it('Set as anchor is disabled on the anchor; Delete and Merge are disabled while generating', () => {
    const find = (id: string, state = calm, node = 'r') => menu(node, state).find((e) => e !== 'separator' && e.id === id) as MenuItem;
    expect(find('anchor').disabled).toBe(true);
    expect(find('anchor', calm, 'c').disabled).toBeFalsy();
    expect(find('delete', { busy: true, streaming: false }, 'c').disabled).toBe(true);
    expect(find('merge', { busy: true, streaming: false }, 'c').disabled).toBe(true);
    expect(find('delete', calm, 'c').danger).toBe(true);
  });

  it('actions do what they say', async () => {
    const run = (id: string, node = 'c') => (menu(node).find((e) => e !== 'separator' && e.id === id) as MenuItem).run();
    run('anchor');
    expect(useStore.getState().map!.view.anchorId).toBe('c');
    run('parent', 'ch');
    expect(useStore.getState().map!.view.selectedId).toBe('c');
    run('rename');
    expect(useStore.getState().nodeDialog).toEqual({ kind: 'rename', id: 'c' });
    run('addChild');
    expect(useStore.getState().nodeDialog).toEqual({ kind: 'addChild', id: 'c' });
    run('collapse');
    await vi.waitFor(() => expect(vi.mocked(fetch).mock.calls.some((c) => String(c[0]).includes('/nodes/c'))).toBe(true));
  });
});

describe('add child concept (no model call)', () => {
  it('creates the stub without explaining it, and selects it', async () => {
    const calls: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      calls.push(url);
      return jsonResponse({ node: { ...useStore.getState().map!.nodes.t!, id: 'new', title: 'Custom', parentId: 'c', status: 'stub' }, created: true }, 201);
    }));
    await useStore.getState().openConcept('c', 'Custom', undefined, false);
    expect(useStore.getState().map!.view.selectedId).toBe('new');
    expect(calls.some((u) => u.endsWith('/expand'))).toBe(false);
    expect(useStore.getState().streams.new).toBeUndefined();
  });

  it('an existing name opens that node and says so', async () => {
    await useStore.getState().openConcept('c', 'transformer', undefined, false);
    expect(useStore.getState().map!.view.selectedId).toBe('t');
    expect(useStore.getState().banner?.text).toContain('already exists');
  });

  it('release position clears one node', async () => {
    useStore.getState().map!.nodes.c!.position = { x: 5, y: 5 };
    await useStore.getState().unpinNode('c');
    expect(useStore.getState().map!.nodes.c!.position).toBeNull();
    const call = vi.mocked(fetch).mock.calls.find((c) => String(c[0]).endsWith('/positions'))!;
    expect(JSON.parse((call[1] as RequestInit).body as string)).toEqual({ positions: { c: null } });
  });
});
