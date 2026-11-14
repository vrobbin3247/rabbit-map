import { describe, expect, it } from 'vitest';
import { extractWikilinks, stripWikilinks, wikilinksToMarkdownLinks } from '../src/wikilink';

describe('extractWikilinks', () => {
  it('reads plain and labelled links, several per line', () => {
    const r = extractWikilinks('A [[Pooling]] and [[Activation Function|activation]] here.');
    expect(r.map((l) => [l.target, l.label])).toEqual([
      ['Pooling', 'Pooling'],
      ['Activation Function', 'activation'],
    ]);
  });
  it('ignores over-long targets', () => {
    expect(extractWikilinks(`[[${'x'.repeat(81)}]]`)).toEqual([]);
  });
  it('ignores links in fenced code, inline code and math', () => {
    const md = [
      'real [[One]]',
      '```',
      'x = [[Two]]',
      '```',
      'inline `[[Three]]` and math $a[[Four]]b$ and $$[[Five]]$$ and [[Six]]',
    ].join('\n');
    expect(extractWikilinks(md).map((l) => l.target)).toEqual(['One', 'Six']);
  });
  it('does not treat currency as math', () => {
    expect(extractWikilinks('costs $5 and [[Gradient]] is $10').map((l) => l.target)).toEqual(['Gradient']);
  });
});

describe('wikilinksToMarkdownLinks', () => {
  it('rewrites to concept: links with encoded targets', () => {
    expect(wikilinksToMarkdownLinks('See [[Pooling Layers|pooling]] now')).toBe(
      'See [pooling](concept:Pooling%20Layers) now',
    );
  });
  it('leaves code untouched', () => {
    expect(wikilinksToMarkdownLinks('`[[X]]` [[Y]]')).toBe('`[[X]]` [Y](concept:Y)');
  });
});

describe('stripWikilinks', () => {
  it('keeps the label', () => {
    expect(stripWikilinks('a [[B|bee]] c [[D]]')).toBe('a bee c D');
  });
});
