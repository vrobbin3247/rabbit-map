/**
 * Escape a "$" that is a price, so the Markdown renderer does not read "$500 ... $20" as the start
 * of a formula. Real math is left alone: "$x^2$", "$5\times5$" and "$$...$$" keep working.
 *
 * A "$" followed by a digit starts math only when the text up to the next "$" on the same line looks
 * like a formula. If it contains words (two or more letters in a row, once commands such as \times
 * are removed) or there is no closing "$", it is a price.
 */
export function protectCurrency(markdown: string): string {
  // Code is never touched. Even indices of the split are ordinary text.
  const parts = markdown.split(/(```[\s\S]*?```|~~~[\s\S]*?~~~|`[^`\n]*`)/g);
  return parts.map((p, i) => (i % 2 === 1 ? p : escapeOutsideDisplayMath(p))).join('');
}

function escapeOutsideDisplayMath(text: string): string {
  const parts = text.split(/(\$\$[\s\S]+?\$\$)/g);
  return parts.map((p, i) => (i % 2 === 1 ? p : p.split('\n').map(escapeLine).join('\n'))).join('');
}

const looksLikeProse = (inner: string) => /[A-Za-z]{2,}/.test(inner.replace(/\\[A-Za-z]+/g, ''));

function escapeLine(line: string): string {
  let out = '';
  let i = 0;
  while (i < line.length) {
    const ch = line[i] as string;
    if (ch === '\\') {
      out += line.slice(i, i + 2); // an existing escape, such as \$
      i += 2;
    } else if (ch === '$' && /\d/.test(line[i + 1] ?? '')) {
      const close = line.indexOf('$', i + 1);
      if (close === -1 || looksLikeProse(line.slice(i + 1, close))) {
        out += '\\$';
        i += 1;
      } else {
        out += line.slice(i, close + 1); // a formula such as $5\times5$: keep it whole
        i = close + 1;
      }
    } else {
      out += ch;
      i += 1;
    }
  }
  return out;
}
