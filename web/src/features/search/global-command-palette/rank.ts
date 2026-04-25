import type { GlobalHit } from './types';

function normalize(s: string): string {
  return s.trim().toLowerCase();
}

/**
 * Lower is better, `null` is no match.
 * This is intentionally lightweight (no heavy fuzzy lib); we rely on backend fuzzy for workspace files.
 */
export function textMatchRank(haystack: string, query: string): number | null {
  const h = normalize(haystack);
  const q = normalize(query);
  if (!q) return 0;
  if (!h) return null;
  if (h === q) return 0;
  if (h.startsWith(q)) return 1;
  const idx = h.indexOf(q);
  if (idx >= 0) return 2 + Math.min(idx, 50) / 100; // earlier occurrences slightly better
  return null;
}

export function hitRank(hit: Omit<GlobalHit, 'rank'>, query: string): number | null {
  const q = query.trim();
  if (!q) return 0;

  const fields: Array<{ text: string; weight: number }> = [
    { text: hit.title, weight: 1 },
    { text: hit.subtitle ?? '', weight: 1.75 },
  ];
  for (const k of hit.keywords ?? []) {
    fields.push({ text: k, weight: 1.25 });
  }

  let best: number | null = null;
  for (const f of fields) {
    const r = textMatchRank(f.text, q);
    if (r === null) continue;
    const weighted = r * f.weight;
    best = best === null ? weighted : Math.min(best, weighted);
  }

  if (best === null) return null;

  // Kind bias: when users type in Ctrl+K, they often want navigation/files/sessions first.
  const kindBias =
    hit.kind === 'route'
      ? -0.15
      : hit.kind === 'file'
        ? -0.1
        : hit.kind === 'session'
          ? -0.05
          : 0;

  return Math.max(0, best + kindBias);
}

export function sortHits(hits: GlobalHit[]): GlobalHit[] {
  return [...hits].sort((a, b) => {
    if (a.rank !== b.rank) return a.rank - b.rank;
    if (a.groupLabel !== b.groupLabel) return a.groupLabel.localeCompare(b.groupLabel);
    return a.title.localeCompare(b.title);
  });
}

