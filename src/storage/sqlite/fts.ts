/** Quote a user query for FTS5 phrase/prefix-safe matching. */
export function escapeFts5Query(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) {
    return '';
  }
  return `"${trimmed.replace(/"/g, '""')}"`;
}

const FTS_SEARCH_STOP_WORDS = new Set([
  'a', 'an', 'and', 'are', 'can', 'did', 'do', 'does', 'for', 'how', 'i', 'in', 'is',
  'it', 'me', 'my', 'of', 'on', 'or', 'the', 'to', 'was', 'what', 'when', 'where',
  'which', 'who', 'why', 'with', 'you', 'your',
]);

/** Build a syntax-safe, recall-oriented query for natural-language memory search. */
export function buildFts5SearchQuery(raw: string): string {
  const terms = raw
    .normalize('NFKC')
    .match(/[\p{L}\p{N}_]+/gu)
    ?.map((term) => term.toLocaleLowerCase())
    .filter((term) => term.length > 1 && !FTS_SEARCH_STOP_WORDS.has(term));
  if (!terms?.length) return escapeFts5Query(raw);
  return [...new Set(terms)]
    .slice(0, 12)
    .map((term) => escapeFts5Query(term))
    .join(' OR ');
}

/** Normalize FTS5 BM25 ranks, where a more-negative rank is a better match. */
export function fts5RankToScore(rank: number, bestRank: number, worstRank: number): number {
  if (![rank, bestRank, worstRank].every(Number.isFinite)) return 0;
  if (bestRank === worstRank) return 0.75;
  const normalized = (worstRank - rank) / (worstRank - bestRank);
  return 0.5 + 0.5 * Math.max(0, Math.min(1, normalized));
}

function lexicalFeatures(raw: string): Set<string> {
  const normalized = raw.normalize('NFKC').toLocaleLowerCase();
  const features = new Set<string>();
  for (const term of normalized.match(/[\p{L}\p{N}_]+/gu) ?? []) {
    if (term.length > 1 && !FTS_SEARCH_STOP_WORDS.has(term)) features.add(`word:${term}`);
  }
  for (const sequence of normalized.match(/\p{Script=Han}+/gu) ?? []) {
    const chars = [...sequence];
    for (let index = 0; index < chars.length - 1; index += 1) {
      features.add(`han:${chars[index]}${chars[index + 1]}`);
    }
  }
  return features;
}

/** Bounded lexical fallback for reformulations unsupported by unicode61 tokenization. */
export function memoryLexicalSimilarity(query: string, content: string): number {
  const queryFeatures = lexicalFeatures(query);
  const contentFeatures = lexicalFeatures(content);
  if (queryFeatures.size === 0 || contentFeatures.size === 0) return 0;
  let shared = 0;
  for (const feature of queryFeatures) {
    if (contentFeatures.has(feature)) shared += 1;
  }
  return (2 * shared) / (queryFeatures.size + contentFeatures.size);
}

const VECTOR_SIZE = 128;

function featureVector(raw: string): Float64Array {
  const vector = new Float64Array(VECTOR_SIZE);
  const normalized = raw.normalize('NFKC').toLocaleLowerCase();
  const features = [
    ...(normalized.match(/[\p{L}\p{N}_]+/gu) ?? []).map((term) => `w:${term}`),
    ...[...normalized].map((char, index, chars) => chars.slice(index, index + 3).join(''))
      .filter((value) => value.trim().length >= 2)
      .map((value) => `c:${value}`),
  ];
  for (const feature of features) {
    let hash = 2166136261;
    for (const char of feature) hash = Math.imul(hash ^ char.codePointAt(0)!, 16777619);
    const index = (hash >>> 0) % VECTOR_SIZE;
    vector[index] += (hash & 1) === 0 ? 1 : -1;
  }
  return vector;
}

/** Local deterministic embedding used to complement FTS without network or model coupling. */
export function memoryVectorSimilarity(query: string, content: string): number {
  const left = featureVector(query);
  const right = featureVector(content);
  let dot = 0;
  let leftNorm = 0;
  let rightNorm = 0;
  for (let index = 0; index < VECTOR_SIZE; index += 1) {
    dot += left[index]! * right[index]!;
    leftNorm += left[index]! ** 2;
    rightNorm += right[index]! ** 2;
  }
  if (leftNorm === 0 || rightNorm === 0) return 0;
  return Math.max(0, dot / Math.sqrt(leftNorm * rightNorm));
}
