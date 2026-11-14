import { describe, expect, it } from 'vitest';
import { toSlug } from '../src/slug';

const table: [string, string][] = [
  ['Channels', 'channel'],
  ['channel', 'channel'],
  ['Pooling Layers', 'pooling-layer'],
  ['Activation Function', 'activation-function'],
  ['CNNs', 'cnn'],
  ['GPU', 'gpu'],
  ['Bias', 'bias'],
  ['Loss', 'loss'],
  ['Analysis', 'analysis'],
  ['Batches', 'batch'],
  ['Classes', 'class'],
  ['Dependencies', 'dependency'],
  ['C++', 'c-plus-plus'],
  ['ResNet-50', 'resnet-50'],
  ['Naïve Bayes', 'naive-baye'],
];

describe('toSlug', () => {
  it.each(table)('%s -> %s', (input, expected) => {
    expect(toSlug(input)).toBe(expected);
  });
  it('is empty for punctuation only', () => {
    expect(toSlug('  ?! ')).toBe('');
  });
});
