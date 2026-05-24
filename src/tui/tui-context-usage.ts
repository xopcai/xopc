/** Compute context window usage percent (0–100), rounded. */
export function computeContextUsagePercent(
  estimatedTokens: number | null | undefined,
  contextWindow: number | null | undefined,
): number | null {
  if (estimatedTokens == null || contextWindow == null || contextWindow <= 0) {
    return null;
  }
  return Math.min(100, Math.round((estimatedTokens / contextWindow) * 100));
}

export function formatContextUsageLabel(percent: number | null): string | null {
  if (percent == null) return null;
  return `${percent}% ctx`;
}
