const HAN = /\p{Script=Han}+/gu;

/** Preserve original words while indexing Chinese characters and adjacent pairs. */
export function memorySearchText(value: string): string {
  const normalized = value.normalize('NFKC').toLowerCase();
  const terms = new Set<string>();
  for (const match of normalized.matchAll(HAN)) {
    const chars = Array.from(match[0]);
    for (let i = 0; i < chars.length; i += 1) {
      terms.add(chars[i]!);
      if (chars[i + 1]) terms.add(chars[i]! + chars[i + 1]!);
    }
  }
  return `${normalized}\n${[...terms].join(' ')}`;
}

export function memorySearchQuery(value: string): string {
  const words = value.normalize('NFKC').toLowerCase().match(/[\p{L}\p{N}_]+/gu) ?? [];
  const terms: string[] = [];
  for (const word of words) {
    if (/^\p{Script=Han}+$/u.test(word)) {
      const chars = Array.from(word);
      if (chars.length === 1) terms.push(word);
      else for (let i = 0; i < chars.length - 1; i += 1) terms.push(chars[i]! + chars[i + 1]!);
    } else if (word.length > 1) terms.push(word);
  }
  return [...new Set(terms)].slice(0, 32).map(term => `"${term.replaceAll('"', '""')}"`).join(' OR ');
}
