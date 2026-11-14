function singularise(word: string): string {
  if (word.length <= 3) return word;
  if (word.endsWith('ies')) return word.slice(0, -3) + 'y';
  if (/(sses|ches|shes|xes|zes)$/.test(word)) return word.slice(0, -2);
  if (word.endsWith('s') && !/(ss|us|is|as|os)$/.test(word)) return word.slice(0, -1);
  return word;
}

/** Two names refer to the same concept when their slugs are equal. */
export function toSlug(name: string): string {
  const base = name
    .normalize('NFKD')
    .replace(/\p{M}+/gu, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/\+/g, ' plus ')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
  if (!base) return '';
  const words = base.split(/\s+/);
  const last = words.length - 1;
  words[last] = singularise(words[last] as string);
  return words.join('-');
}
