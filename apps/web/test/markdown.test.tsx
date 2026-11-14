import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Markdown, safeUrl } from '../src/panel/Markdown';
import { useStore } from '../src/state/store';
import { jsonResponse, loadMap } from './helpers';

beforeEach(() => {
  loadMap();
  vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ view: {} })));
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('Markdown', () => {
  it('draws existing concepts and ghost links differently, matching by alias and plural', () => {
    render(<Markdown fromNodeId="r" text="See [[CNN]], [[Channels]], [[Transformer|attention nets]] and [[Pooling]]." />);
    const q = (t: string) => screen.getByText(t) as HTMLElement;
    expect(q('CNN').dataset.existing).toBe('true');
    expect(q('CNN').className).toBe('link-concept');
    expect(q('Channels').dataset.existing).toBe('true');
    expect(q('attention nets').dataset.existing).toBe('true');
    expect(q('Pooling').dataset.existing).toBe('false');
    expect(q('Pooling').className).toBe('link-ghost');
    expect(q('Pooling').title).toMatch(/Click to add/);
    expect(q('CNN').title).toBe('Image models.');
  });

  it('clicking an existing concept selects it and records the trail', () => {
    render(<Markdown fromNodeId="r" text="See [[Channels]]." />);
    fireEvent.click(screen.getByText('Channels'));
    const v = useStore.getState().map!.view;
    expect(v.selectedId).toBe('ch');
    expect(v.trail).toEqual(['r', 'ch']);
    expect(Object.keys(useStore.getState().map!.nodes)).toHaveLength(4);
  });

  it('clicking a ghost link asks the server to open the concept, passing the sentence', async () => {
    const calls: { url: string; body: unknown }[] = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url, body: init?.body ? JSON.parse(init.body as string) : null });
      if (url.endsWith('/nodes')) return jsonResponse({ node: { ...useStore.getState().map!.nodes.t!, id: 'new', title: 'Pooling', parentId: 'r', status: 'stub' }, created: true }, 201);
      return new Response('{}', { status: 400, headers: { 'content-type': 'application/json' } });
    }));
    render(<Markdown fromNodeId="r" text="First sentence. After convolution, [[Pooling]] shrinks maps." />);
    fireEvent.click(screen.getByText('Pooling'));
    await vi.waitFor(() => expect(useStore.getState().map!.view.selectedId).toBe('new'));
    const open = calls.find((c) => c.url.endsWith('/nodes'))!;
    expect(open.body).toMatchObject({ fromNodeId: 'r', term: 'Pooling' });
    expect((open.body as { snippet: string }).snippet).toContain('After convolution');
  });

  it('shows raw HTML as inert text', () => {
    const { container } = render(<Markdown fromNodeId="r" text={'<img src=x onerror="alert(1)"> <script>alert(2)</script> hello'} />);
    expect(container.querySelector('img')).toBeNull();
    expect(container.querySelector('script')).toBeNull();
    expect(container.textContent).toContain('hello');
  });

  it('renders math, code and tables; leaves links inside code alone', () => {
    const { container } = render(<Markdown fromNodeId="r" text={'Inline $x^2$.\n\n$$\\sum_i i$$\n\n```\n[[NotALink]]\n```\n\n| a | b |\n|---|---|\n| 1 | 2 |'} />);
    expect(container.querySelector('.katex')).not.toBeNull();
    expect(container.querySelector('table')).not.toBeNull();
    expect(container.querySelector('pre')?.textContent).toContain('[[NotALink]]');
    expect(container.querySelector('[data-concept]')).toBeNull();
  });

  it('leaves unfinished wikilinks as plain text while streaming', () => {
    const { container } = render(<Markdown fromNodeId="r" text="Uses [[Pool" />);
    expect(container.textContent).toContain('[[Pool');
    expect(container.querySelector('[data-concept]')).toBeNull();
  });

  it('only allows safe URL schemes', () => {
    expect(safeUrl('https://a.b')).toBe('https://a.b');
    expect(safeUrl('concept:X')).toBe('concept:X');
    expect(safeUrl('javascript:alert(1)')).toBe('');
    expect(safeUrl('data:text/html,x')).toBe('');
  });
});

describe('Markdown: prices and images', () => {
  it('shows prices as text and keeps links between them', () => {
    const { container } = render(<Markdown fromNodeId="r" text="A GPU costs $500 and a [[Transformer]] run costs $20 more." />);
    expect(container.querySelector('.katex')).toBeNull();
    expect(container.textContent).toBe('A GPU costs $500 and a Transformer run costs $20 more.');
    expect(container.querySelector('[data-concept="Transformer"]')).not.toBeNull();
  });

  it('still renders real math next to a price', () => {
    const { container } = render(<Markdown fromNodeId="r" text="A $5\times5$ image costs $20 to label." />);
    expect(container.querySelectorAll('.katex')).toHaveLength(1);
    expect(container.textContent).toContain('costs $20 to label.');
  });

  it('never loads an image', () => {
    const { container } = render(<Markdown fromNodeId="r" text="![a chart](https://evil.example/pixel.png) and ![](https://evil.example/x.png)" />);
    expect(container.querySelector('img')).toBeNull();
    expect(container.textContent).toContain('[image: a chart]');
    expect(container.innerHTML).not.toContain('evil.example');
  });
});
