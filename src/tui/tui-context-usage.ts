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

function formatTokens(count: number): string {
  if (count < 1000) return count.toString();
  if (count < 10000) return `${(count / 1000).toFixed(1)}k`;
  if (count < 1_000_000) return `${Math.round(count / 1000)}k`;
  if (count < 10_000_000) return `${(count / 1_000_000).toFixed(1)}M`;
  return `${Math.round(count / 1_000_000)}M`;
}

export function formatContextUsageLabel(
  percent: number | null,
  contextWindow?: number | null,
): string | null {
  if (contextWindow != null && contextWindow > 0) {
    const percentLabel = percent == null ? '?' : `${percent}%`;
    return `${percentLabel}/${formatTokens(contextWindow)} ctx`;
  }
  if (percent == null) return null;
  return `${percent}% ctx`;
}
