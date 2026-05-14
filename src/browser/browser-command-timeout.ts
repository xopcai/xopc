import type { Config } from '../config/schema.js';

const DEFAULT_MS = 30_000;
const MIN_SEC = 5;
const MAX_SEC = 900;

/** Playwright action timeout from `agents.defaults.browser.commandTimeout` (seconds). */
export function resolveBrowserCommandTimeoutMs(cfg: Config | undefined): number {
  const sec = cfg?.agents?.defaults?.browser?.commandTimeout;
  if (typeof sec === 'number' && Number.isFinite(sec)) {
    const n = Math.floor(sec);
    if (n >= MIN_SEC && n <= MAX_SEC) {
      return n * 1000;
    }
  }
  return DEFAULT_MS;
}
