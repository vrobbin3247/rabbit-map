import { describe, expect, it } from 'vitest';
import { protectCurrency } from '../src/markdown';

describe('protectCurrency', () => {
  it('escapes prices', () => {
    expect(protectCurrency('A GPU costs $500 and a [T](concept:T) run costs $20 more.')).toBe(
      'A GPU costs \\$500 and a [T](concept:T) run costs \\$20 more.',
    );
    expect(protectCurrency('It is $5.')).toBe('It is \\$5.');
    expect(protectCurrency('Coffee is $3 and tea is $2.50, so $5.50 total.')).toBe(
      'Coffee is \\$3 and tea is \\$2.50, so \\$5.50 total.',
    );
    expect(protectCurrency('$1,000 up front')).toBe('\\$1,000 up front');
  });

  it('keeps formulas, including ones that start with a digit', () => {
    for (const m of ['$x^2$', '$5\\times5$', '$3 \\times 3$', '$2n+1$', '$\\frac{1}{2}$', '$5$', '$$\\sum_i 5$$', '$$\n5 + 5\n$$']) {
      expect(protectCurrency(`See ${m} here.`)).toBe(`See ${m} here.`);
    }
  });

  it('handles prices and formulas in the same line', () => {
    expect(protectCurrency('A $5\\times5$ image costs $20 to label.')).toBe('A $5\\times5$ image costs \\$20 to label.');
  });

  it('never touches code', () => {
    const md = 'Use `price = $5` or\n```\ncost = "$500 and $20"\n```\nthen pay $9.';
    expect(protectCurrency(md)).toBe('Use `price = $5` or\n```\ncost = "$500 and $20"\n```\nthen pay \\$9.');
  });

  it('is idempotent and leaves existing escapes alone', () => {
    const once = protectCurrency('Costs $500 and $20.');
    expect(protectCurrency(once)).toBe(once);
    expect(protectCurrency('Already \\$5 here')).toBe('Already \\$5 here');
  });

  it('leaves text without dollars unchanged, and a "$" before a letter', () => {
    expect(protectCurrency('No money here.')).toBe('No money here.');
    expect(protectCurrency('Let $x$ be a number.')).toBe('Let $x$ be a number.');
  });
});
