/**
 * Account ID 规范化工具
 * 
 * Account ID 用于标识不同的账户配置，支持多账户路由。
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
 * 规范化 Account ID
 * 
 * 规则：
 * - 只允许 a-z0-9_- 字符
 * - 不能以 - 或 _ 开头
 * - 最大长度 64 字符
 * - 空值返回 'default'
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
 * 规范化可选 Account ID
 * 
 * 空值返回 undefined 而不是 'default'
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
 * 验证 Account ID 是否有效
 */
export function isValidAccountId(value: string | undefined | null): boolean {
  const trimmed = (value ?? '').trim();
  return Boolean(trimmed) && VALID_ID_RE.test(trimmed);
}

/**
 * 清理 Account ID（同 sanitizeSegment）
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
