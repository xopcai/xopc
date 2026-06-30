import type { Config } from '../config/schema.js';

const DEFAULT_MS = 30_000;
const MIN_SEC = 5;
const MAX_SEC = 900;

export function resolveBrowserCommandTimeoutMs(cfg: Config | undefined): number {
  const raw = cfg?.browser?.commandTimeout;
  if (typeof raw !== 'number' || !Number.isFinite(raw)) return DEFAULT_MS;
  return Math.min(MAX_SEC, Math.max(MIN_SEC, Math.floor(raw))) * 1000;
}
