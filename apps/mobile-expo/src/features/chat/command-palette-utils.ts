/**
 * Pure utility functions for the command palette — no React / RN dependencies.
 * Extracted for easy unit testing.
 */
import type { PaletteItem, SlashRange } from './command-palette.types';

/**
 * Detect if the cursor is inside a `/…` token suitable for the command palette.
 * Returns null if no active slash range found.
 */
export function detectSlashRange(text: string, cursor: number): SlashRange | null {
  const len = text.length;
  let c = Math.min(Math.max(cursor, 0), len);

  // Edge case: single `/` with caret briefly at 0
  if (c < 1 && text === '/') {
    c = 1;
  }
  if (c < 1) return null;

  const before = text.slice(0, c);
  const match = before.match(/\/[^\s]*$/);
  if (!match || match.index === undefined) return null;

  const token = match[0];

  // Already-applied `/skill:name` tokens should not re-open the palette
  if (token.startsWith('/skill:')) return null;

  return {
    start: match.index,
    end: c,
    query: token.slice(1), // strip the leading `/`
  };
}

/**
 * Rank a palette item against the query. Lower = better match. null = no match.
 */
export function paletteItemMatchRank(item: PaletteItem, q: string): number | null {
  const needle = q.trim().toLowerCase();
  if (!needle) return 0; // empty query matches everything

  const name = item.name.toLowerCase();
  if (name === needle) return 0;

  for (const a of item.aliases ?? []) {
    if (a.toLowerCase() === needle) return 1;
  }
  if (name.startsWith(needle)) return 2;

  for (const a of item.aliases ?? []) {
    if (a.toLowerCase().startsWith(needle)) return 3;
  }
  if (name.includes(needle)) return 4;

  for (const a of item.aliases ?? []) {
    if (a.toLowerCase().includes(needle)) return 5;
  }

  const desc = (item.description ?? '').toLowerCase();
  if (desc.includes(needle)) return 100;

  return null; // no match
}
