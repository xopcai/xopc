export type SearchFailureKind = 'permission_denied' | 'rate_limited' | 'timeout' | 'cancelled' | 'unsupported_batch' | 'provider_error';
export interface SearchFailureInfo {
  kind: SearchFailureKind;
  scope: 'request' | 'batch' | 'provider';
  message: string;
  status?: number;
  retryAfterMs?: number;
}

/** Only a host adapter may explicitly identify a refusal as batch-only. */
export class SearchError extends Error implements SearchFailureInfo {
  readonly kind: SearchFailureKind;
  readonly scope: 'request' | 'batch' | 'provider';
  readonly status?: number;
  readonly retryAfterMs?: number;
  constructor(info: SearchFailureInfo) {
    super(info.message); this.name = 'SearchError';
    this.kind = info.kind; this.scope = info.scope;
    this.status = info.status; this.retryAfterMs = info.retryAfterMs;
  }
}
export function classifySearchError(error: unknown, signal?: AbortSignal): SearchError {
  if (signal?.aborted) {
    const reason = signal.reason as { name?: string; code?: string };
    const timedOut = reason?.name === 'TimeoutError' || reason?.code === 'deadline_exceeded';
    return new SearchError({ kind: timedOut ? 'timeout' : 'cancelled', scope: 'request',
      message: timedOut ? 'Search caller deadline exceeded' : 'Search cancelled by its caller' });
  }
  if (error instanceof SearchError) return error;
  const value = error as { name?: unknown; status?: unknown; statusCode?: unknown; code?: unknown } | undefined;
  const message = error instanceof Error ? error.message : String(error);
  const httpStatus = /^HTTP (\d{3})\b/.exec(message)?.[1];
  const status = typeof value?.status === 'number' ? value.status : typeof value?.statusCode === 'number' ? value.statusCode
    : httpStatus ? Number(httpStatus) : undefined;
  const denied = ['EACCES', 'EPERM', 'PERMISSION_DENIED', 'permission_denied', 'ACCESS_DENIED'].includes(String(value?.code))
    || /\b(permission denied|access denied|forbidden|unauthorized|not authorized)\b/i.test(message);
  const kind = status === 401 || status === 403 || denied ? 'permission_denied' : status === 429 ? 'rate_limited'
    : status === 408 || status === 504 || value?.name === 'TimeoutError' || value?.code === 'ETIMEDOUT' ? 'timeout'
      : value?.name === 'AbortError' ? 'cancelled' : 'provider_error';
  return new SearchError({ kind, scope: kind === 'permission_denied' ? 'provider' : 'request', status, message: message.slice(0, 500) });
}
export function searchFailureInfo(error: SearchError): SearchFailureInfo {
  return { kind: error.kind, scope: error.scope, message: error.message.slice(0, 500), status: error.status, retryAfterMs: error.retryAfterMs };
}
export function searchHttpError(response: Response, message = `Search request failed (${response.status})`): SearchError {
  const retryAfter = response.headers.get('retry-after');
  const seconds = retryAfter === null ? NaN : Number(retryAfter);
  const retryAfterMs = retryAfter === null ? undefined : Number.isFinite(seconds)
    ? Math.max(0, seconds * 1000) : Math.max(0, Date.parse(retryAfter) - Date.now());
  return new SearchError({ kind: response.status === 401 || response.status === 403 ? 'permission_denied'
    : response.status === 429 ? 'rate_limited' : response.status === 408 || response.status === 504 ? 'timeout' : 'provider_error',
    scope: response.status === 401 || response.status === 403 ? 'provider' : 'request', message: message.slice(0, 500), status: response.status,
    retryAfterMs: retryAfterMs !== undefined && Number.isFinite(retryAfterMs) ? retryAfterMs : undefined });
}
