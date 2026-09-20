export type SceneSourceFailure = 'source_not_ready' | 'needs_permission' | 'source_rate_limited' | 'source_timeout';

/** A source failure is separate from a model execution failure. */
export class SceneSourceNotReady extends Error {
  constructor(readonly reason: SceneSourceFailure = 'source_not_ready') { super('Scene source is stale or not synchronized yet'); }
}

export function sceneSourceFailureReason(error: unknown): SceneSourceFailure {
  if (error instanceof SceneSourceNotReady) return error.reason;
  const value = error as { status?: number; statusCode?: number; name?: string; message?: string } | null;
  const status = Number(value?.statusCode ?? value?.status);
  const message = typeof error === 'string' ? error : value?.message ?? '';
  if (status === 429 || /\b429\b|rate.?limit|too many requests/i.test(message)) return 'source_rate_limited';
  if (status === 401 || status === 403 || /\b401\b|\b403\b|permission|authorization|authorized|access|token.*expired|invalid.grant/i.test(message)) return 'needs_permission';
  if (value?.name === 'AbortError' || value?.name === 'TimeoutError' || /timed out|timeout/i.test(message)) return 'source_timeout';
  return 'source_not_ready';
}
