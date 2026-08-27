const ENGLISH_STOP_WORDS = new Set([
  'a', 'an', 'and', 'are', 'can', 'did', 'do', 'does', 'for', 'how', 'i', 'in', 'is',
  'it', 'me', 'my', 'of', 'on', 'or', 'the', 'to', 'was', 'what', 'when', 'where',
  'which', 'who', 'why', 'with', 'you', 'your',
]);

export function normalizeRetrievalText(value: string): string {
  return value.normalize('NFKC').toLowerCase().replace(/\s+/g, ' ').trim();
}

export function extractLexicalTerms(value: string): string[] {
  const terms = normalizeRetrievalText(value)
    .match(/[\p{L}\p{N}_]+/gu)
    ?.filter((term) => term.length > 1 && !ENGLISH_STOP_WORDS.has(term)) ?? [];
  return [...new Set(terms)];
}

export function extractCjkBigrams(value: string): string[] {
  const features: string[] = [];
  for (const sequence of normalizeRetrievalText(value).match(/\p{Script=Han}+/gu) ?? []) {
    const characters = [...sequence];
    for (let index = 0; index < characters.length - 1; index += 1) {
      features.push(`${characters[index]}${characters[index + 1]}`);
    }
  }
  return [...new Set(features)];
}

export function extractRetrievalIdentifiers(value: string): string[] {
  const normalized = normalizeRetrievalText(value);
  const identifiers = [
    ...(normalized.match(/@[a-z0-9_.-]+\/[a-z0-9_.-]+/g) ?? []),
    ...(normalized.match(/(?:[a-z0-9_.-]+\/)+[a-z0-9_.-]+/g) ?? []),
    ...(normalized.match(/\b[a-z0-9_-]+\.[a-z0-9]{1,12}\b/g) ?? []),
    ...(normalized.match(/#[0-9]+\b/g) ?? []),
    ...(normalized.match(/\b[a-z]+-[a-z0-9-]*[0-9][a-z0-9-]*\b/g) ?? []),
  ];
  const unique = [...new Set(identifiers)];
  return unique.filter((identifier) => !unique.includes(`@${identifier}`));
}

export function retrievalLexicalSimilarity(left: string, right: string): number {
  const leftFeatures = new Set([
    ...extractLexicalTerms(left).map((term) => `term:${term}`),
    ...extractCjkBigrams(left).map((term) => `han:${term}`),
  ]);
  const rightFeatures = new Set([
    ...extractLexicalTerms(right).map((term) => `term:${term}`),
    ...extractCjkBigrams(right).map((term) => `han:${term}`),
  ]);
  if (leftFeatures.size === 0 || rightFeatures.size === 0) return 0;
  let shared = 0;
  for (const feature of leftFeatures) {
    if (rightFeatures.has(feature)) shared += 1;
  }
  return (2 * shared) / (leftFeatures.size + rightFeatures.size);
}
