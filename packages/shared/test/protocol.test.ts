import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { EmptyOutputError, META_DELIMITER, StreamFilter, parseAskOutput, parseExpandOutput } from '../src/protocol';

const fixture = readFileSync(new URL('./fixtures/expand-claude-cnn.txt', import.meta.url), 'utf8');
const none = () => undefined;
const bodyOf = (t: string) => t.slice(0, t.indexOf('\n' + META_DELIMITER));

describe('parseExpandOutput', () => {
  it('parses the verified Claude fixture', () => {
    const r = parseExpandOutput(fixture, 'Convolutional Neural Network', [], none);
    expect(r.body.startsWith('A **Convolutional')).toBe(true);
    expect(r.body).not.toContain('===META===');
    expect(r.summary).toMatch(/^Deep learning model/);
    expect(r.aliases).toEqual(['CNN', 'ConvNet']);
    expect(r.children.map((c) => c.title)).toEqual([
      'Convolutional Layers',
      'Pooling Layers',
      'Feature Maps',
      'Image Classification',
    ]);
    expect(r.metaRecovered).toBe(false);
  });

  it('falls back to links when metadata is missing', () => {
    const noMeta = bodyOf(fixture);
    const known = new Set(['deep learning', 'neuron', 'activation function', 'backpropagation']);
    const r = parseExpandOutput(noMeta, 'Convolutional Neural Network', [], (n) => known.has(n.toLowerCase()));
    expect(r.metaRecovered).toBe(true);
    expect(r.children.map((c) => c.title)).toEqual(['Convolutional Layers', 'Feature Maps', 'Pooling Layers']);
    expect(r.summary.startsWith('A Convolutional Neural Network (CNN) is a specialized Deep learning')).toBe(true);
  });

  it('falls back when the JSON is invalid', () => {
    const r = parseExpandOutput('Text with [[Thing]].\n===META===\n{not json', 'Topic', [], none);
    expect(r.metaRecovered).toBe(true);
    expect(r.children).toEqual([{ title: 'Thing', summary: '' }]);
  });

  it('accepts fenced JSON and trailing text', () => {
    const t = 'Body\n===META===\n```json\n{"summary":"S","aliases":[],"children":[]}\n```\nthanks';
    const r = parseExpandOutput(t, 'Topic', [], none);
    expect(r.metaRecovered).toBe(false);
    expect(r.summary).toBe('S');
  });

  it('removes a leading heading equal to the title or an alias', () => {
    const r = parseExpandOutput('# Convolutional Neural Network\n\nBody here.', 'Convolutional Neural Network', [], none);
    expect(r.body).toBe('Body here.');
    const r2 = parseExpandOutput('## CNN\n\nBody here.', 'Convolutional Neural Network', ['CNN'], none);
    expect(r2.body).toBe('Body here.');
  });

  it('keeps a heading that is not the title', () => {
    expect(parseExpandOutput('# Other\n\nBody', 'Topic', [], none).body).toBe('# Other\n\nBody');
  });

  it('drops self, duplicate and bracketed children, and caps at 7', () => {
    const kids = [
      { title: 'Topic', summary: '' },
      { title: '[[A]]', summary: 'a' },
      { title: 'a', summary: 'dup of A by slug' },
      ...'BCDEFGHIJ'.split('').map((c) => ({ title: `Concept ${c}`, summary: '' })),
    ];
    const t = `Body\n===META===\n${JSON.stringify({ summary: '', aliases: [], children: kids })}`;
    const r = parseExpandOutput(t, 'Topic', [], none);
    expect(r.children).toHaveLength(7);
    expect(r.children[0]).toEqual({ title: 'A', summary: 'a' });
    expect(r.children.map((c) => c.title)).not.toContain('Topic');
    expect(r.children.map((c) => c.title)).not.toContain('a');
  });

  it('throws on an empty body', () => {
    expect(() => parseExpandOutput('   \n===META===\n{}', 'T', [], none)).toThrow(EmptyOutputError);
    expect(() => parseExpandOutput('', 'T', [], none)).toThrow(EmptyOutputError);
  });

  it('uses the last delimiter line', () => {
    const r = parseExpandOutput('a\n===META===\nb\n===META===\n{"summary":"x"}', 'T', [], none);
    expect(r.summary).toBe('x');
    expect(r.body).toBe('a\n===META===\nb');
  });
});

describe('real provider fixtures', () => {
  for (const f of ['expand-codex-cnn.txt', 'expand-claude-sonnet-cnn.txt']) {
    it(`parses ${f}`, () => {
      const text = readFileSync(new URL(`./fixtures/${f}`, import.meta.url), 'utf8');
      const r = parseExpandOutput(text, 'Convolutional Neural Network', [], none);
      expect(r.metaRecovered).toBe(false);
      expect(r.body.startsWith('#')).toBe(false);
      expect(r.body).not.toContain('===META');
      expect(r.summary.length).toBeGreaterThan(10);
      expect(r.children.length).toBeGreaterThanOrEqual(3);
      expect(r.aliases).toContain('CNN');
      for (const cut of [7, 50, text.length - 5]) {
        const sf = new StreamFilter();
        const out = sf.push(text.slice(0, cut)) + sf.push(text.slice(cut)) + sf.flush();
        expect(out.trim()).toBe(text.slice(0, text.lastIndexOf('\n' + META_DELIMITER)).trim());
      }
    });
  }
});

describe('parseAskOutput', () => {
  const kinds = '{"children":[{"title":"Same Padding","summary":"Keeps the size."},{"title":"[[Valid Padding]]","summary":"No zeros."},{"title":"Padding","summary":"self"},{"title":"same padding","summary":"dup"}]}';

  it('returns the text and the concepts the answer introduced', () => {
    const r = parseAskOutput(`Kinds: [[Same Padding]] and [[Valid Padding]].\n\n===META===\n${kinds}`, 'Padding', []);
    expect(r.text).toBe('Kinds: [[Same Padding]] and [[Valid Padding]].');
    expect(r.children).toEqual([
      { title: 'Same Padding', summary: 'Keeps the size.' },
      { title: 'Valid Padding', summary: 'No zeros.' },
    ]); // brackets removed, the node itself and the duplicate dropped
  });

  it('an answer with no metadata adds no nodes, and its links stay as they are', () => {
    const r = parseAskOutput('Answer [[X]]', 'Padding');
    expect(r).toEqual({ text: 'Answer [[X]]', children: [] });
  });

  it('invalid metadata adds no nodes and is not an error', () => {
    expect(parseAskOutput('Answer\n===META===\n{not json', 'P').children).toEqual([]);
    expect(parseAskOutput('Answer\n===META===\n{}', 'P').children).toEqual([]);
  });

  it('accepts fenced JSON, skips aliases of the node, and caps at five', () => {
    const many = JSON.stringify({ children: [...'ABCDEFGH'].map((c) => ({ title: `Kind ${c}`, summary: '' })).concat([{ title: 'CNN', summary: '' }]) });
    const r = parseAskOutput(`A\n===META===\n\`\`\`json\n${many}\n\`\`\``, 'Convolutional Neural Network', ['CNN']);
    expect(r.children.map((c) => c.title)).toEqual(['Kind A', 'Kind B', 'Kind C', 'Kind D', 'Kind E']);
  });

  it('drops a stray metadata tail from the text', () => {
    expect(parseAskOutput('Answer [[X]]\n===META===\n{}').text).toBe('Answer [[X]]');
  });
  it('throws when empty', () => {
    expect(() => parseAskOutput('  ')).toThrow(EmptyOutputError);
  });
});

describe('StreamFilter', () => {
  const expected = bodyOf(fixture);

  it('outputs the body for every single split position', () => {
    for (let i = 0; i <= fixture.length; i++) {
      const f = new StreamFilter();
      const out = f.push(fixture.slice(0, i)) + f.push(fixture.slice(i)) + f.flush();
      expect(out.trim()).toBe(expected.trim());
      expect(out).not.toContain('===META');
    }
  });

  it('works with tiny chunks', () => {
    const f = new StreamFilter();
    let out = '';
    for (let i = 0; i < fixture.length; i += 3) out += f.push(fixture.slice(i, i + 3));
    out += f.flush();
    expect(out.trim()).toBe(expected.trim());
  });

  it('hides a delimiter at the very start', () => {
    const f = new StreamFilter();
    expect(f.push('===META===\n{}') + f.flush()).toBe('');
  });

  it('passes text with no delimiter and text containing ===', () => {
    const f = new StreamFilter();
    const out = f.push('a === b\n=== c ') + f.push('end') + f.flush();
    expect(out).toBe('a === b\n=== c end');
  });
});
