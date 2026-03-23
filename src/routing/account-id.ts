/**
 * Account id normalization
 *
 * Used to distinguish channel account configs in multi-account routing.
 */

export const DEFAULT_ACCOUNT_ID = 'default';

const VALID_ID_RE = /^[a-z0-9][a-z0-9_-]{0,63}$/i;
const INVALID_CHARS_RE = /[^a-z0-9_-]+/g;
const LEADING_DASH_RE = /^-+/;
const TRAILING_DASH_RE = /-+$/;
const ACCOUNT_ID_CACHE_MAX = 512;

const normalizeAccountIdCache = new Map<string, string>();
const normalizeOptionalAccountIdCache = new Map<string, string | undefined>();

/**
 * Normalize an account id string.
 *
 * Rules:
 * - Only `a-z`, `0-9`, `_`, `-`
 * - Must not start with `-` or `_`
 * - Max length 64
 * - Empty input -> `default`
 */
export function normalizeAccountId(value: string | undefined | null): string {
  const trimmed = (value ?? '').trim();
  if (!trimmed) {
    return DEFAULT_ACCOUNT_ID;
  }
  
  const cached = normalizeAccountIdCache.get(trimmed);
  if (cached) {
    return cached;
  }
  
  const normalized = canonicalizeAccountId(trimmed) || DEFAULT_ACCOUNT_ID;
  setNormalizeCache(normalizeAccountIdCache, trimmed, normalized);
  return normalized;
}

/**
 * Like `normalizeAccountId`, but empty input yields `undefined` (not `default`).
 */
export function normalizeOptionalAccountId(value: string | undefined | null): string | undefined {
  const trimmed = (value ?? '').trim();
  if (!trimmed) {
    return undefined;
  }
  
  if (normalizeOptionalAccountIdCache.has(trimmed)) {
    return normalizeOptionalAccountIdCache.get(trimmed);
  }
  
  const normalized = canonicalizeAccountId(trimmed) || undefined;
  setNormalizeCache(normalizeOptionalAccountIdCache, trimmed, normalized);
  return normalized;
}

/**
 * Whether the value already matches the strict account id pattern.
 */
export function isValidAccountId(value: string | undefined | null): boolean {
  const trimmed = (value ?? '').trim();
  return Boolean(trimmed) && VALID_ID_RE.test(trimmed);
}

/**
 * Alias for `normalizeAccountId` (same canonicalization as session segments).
 */
export function sanitizeAccountId(value: string | undefined | null): string {
  return normalizeAccountId(value);
}

function canonicalizeAccountId(value: string): string | undefined {
  if (VALID_ID_RE.test(value)) {
    return value.toLowerCase();
  }
  
  const cleaned = value
    .toLowerCase()
    .replace(INVALID_CHARS_RE, '-')
    .replace(LEADING_DASH_RE, '')
    .replace(TRAILING_DASH_RE, '')
    .slice(0, 64);
  
  return cleaned || undefined;
}

function setNormalizeCache<T>(cache: Map<string, T>, key: string, value: T): void {
  cache.set(key, value);
  if (cache.size <= ACCOUNT_ID_CACHE_MAX) {
    return;
  }
  const oldest = cache.keys().next();
  if (!oldest.done) {
    cache.delete(oldest.value);
  }
}
