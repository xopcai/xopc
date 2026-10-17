import type { SearchMetadata } from './types.js';

export interface SearchInfo extends SearchMetadata {
  provider: string;
  cached?: boolean;
  capturedAt?: number;
}

/** Keep compact provenance through transcript truncation, excluding query and result payloads. */
export function sanitizeSearchInfo(value: unknown): SearchInfo | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const row = value as Record<string, unknown>;
  const id = (v: unknown): v is string => typeof v === 'string' && /^[a-z0-9][a-z0-9_-]{0,63}$/.test(v);
  if (!id(row.provider)) return undefined;
  const attempts = Array.isArray(row.attempts) ? row.attempts.slice(0, 24).flatMap((item: unknown) => {
    if (!item || typeof item !== 'object') return [];
    const step = item as Record<string, unknown>;
    if (!id(step.provider) || !['success', 'empty', 'error', 'skipped'].includes(String(step.outcome))) return [];
    return [{ provider: step.provider, outcome: step.outcome as 'success' | 'empty' | 'error' | 'skipped',
      ...(id(step.upstream) ? { upstream: step.upstream } : {}),
      ...(typeof step.reason === 'string' && /^[a-z_]{1,64}$/.test(step.reason) ? { reason: step.reason } : {}) }];
  }) : undefined;
  return {
    provider: row.provider,
    ...(id(row.upstream) ? { upstream: row.upstream } : {}),
    ...(typeof row.cached === 'boolean' ? { cached: row.cached } : {}),
    ...(typeof row.capturedAt === 'number' && Number.isSafeInteger(row.capturedAt) && row.capturedAt > 0 ? { capturedAt: row.capturedAt } : {}),
    ...(typeof row.attemptCount === 'number' && Number.isSafeInteger(row.attemptCount) && row.attemptCount > 0 && row.attemptCount <= 10000 ? { attemptCount: row.attemptCount } : {}),
    ...(attempts?.length ? { attempts } : {}),
  };
}
