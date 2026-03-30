/** Shared fetch defaults for HTML search fallbacks (reduce naive bot blocking). */
export const HTML_SEARCH_USER_AGENT =
  'Mozilla/5.0 (compatible; xopcbot/1.0; +https://github.com/xopcai/xopcbot)';

export const DEFAULT_HTML_SEARCH_TIMEOUT_MS = 25_000;

export function mergeAbortWithTimeout(signal: AbortSignal | undefined, ms: number): AbortSignal {
  const t = AbortSignal.timeout(ms);
  if (!signal) return t;
  return AbortSignal.any([signal, t]);
}
