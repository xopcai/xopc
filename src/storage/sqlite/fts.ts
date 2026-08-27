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
    ?.map((term) => term.toLowerCase())
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
