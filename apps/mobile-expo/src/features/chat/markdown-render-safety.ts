/**
 * Heuristics for when to avoid the native GFM markdown renderer.
 * `react-native-enriched-markdown` can hard-crash on some native table shapes
 * and its WASM parser can fail during Expo web bundling, so use the JS fallback
 * for those cases.
 */

function isGfmTableSeparatorLine(line: string): boolean {
  const trimmed = line.trim();
  if (!trimmed.includes('|') || !trimmed.includes('-')) return false;
  return /^[\s|:-]+$/.test(trimmed);
}

function isGfmTableRowLine(line: string): boolean {
  const trimmed = line.trim();
  if (!trimmed.includes('|')) return false;
  return trimmed.split('|').filter((cell) => cell.trim().length > 0).length >= 2;
}

/** True when content likely contains a GFM pipe table. */
export function markdownContainsPipeTable(content: string): boolean {
  const lines = content.split('\n');
  for (let i = 0; i < lines.length - 1; i++) {
    const row = lines[i] ?? '';
    const sep = lines[i + 1] ?? '';
    if (!isGfmTableRowLine(row) || !isGfmTableSeparatorLine(sep)) continue;
    return true;
  }
  return false;
}

/** Prefer JS markdown fallback instead of native EnrichedMarkdownText. */
export function markdownNeedsPlainFallback(content: string): boolean {
  if (!content?.trim()) return false;
  return markdownContainsPipeTable(content);
}

export function shouldUseMarkdownFallback({
  content,
  hasEnriched,
  platform,
}: {
  content: string;
  hasEnriched: boolean;
  platform: string;
}): boolean {
  if (!hasEnriched) return true;
  if (platform === 'web') return true;
  return markdownNeedsPlainFallback(content);
}
