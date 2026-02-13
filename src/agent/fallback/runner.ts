import { classifyFailoverReason, type FailoverReason } from './reason.js';
import { FailoverError, isFailoverError, describeFailoverError } from './error.js';
import { resolveFallbackCandidates, type ModelCandidate, type FallbackAttempt } from './candidates.js';
import type { Config } from '../../config/schema.js';

export interface FallbackResult<T> {
  result: T;
  provider: string;
  model: string;
  attempts: FallbackAttempt[];
}

export async function runWithModelFallback<T>(params: {
  cfg: Config | undefined;
  provider: string;
  model: string;
  fallbacksOverride?: string[];
  run: (provider: string, model: string) => Promise<T>;
  onError?: (attempt: { provider: string; model: string; error: unknown; attempt: number; total: number }) => void;
}): Promise<FallbackResult<T>> {
  const candidates = resolveFallbackCandidates(params);
  const attempts: FallbackAttempt[] = [];
  let lastError: unknown;

  for (let i = 0; i < candidates.length; i++) {
    const candidate = candidates[i];
    try {
      const result = await params.run(candidate.provider, candidate.model);
      return { result, provider: candidate.provider, model: candidate.model, attempts };
    } catch (err) {
      if (isAbortError(err)) throw err;
      lastError = err;

      const reason = classifyFailoverReason(err);
      if (reason === 'unknown') throw err;

      const described = describeFailoverError(err);
      attempts.push({ provider: candidate.provider, model: candidate.model, error: described.message, ...described });
      await params.onError?.({ provider: candidate.provider, model: candidate.model, error: err, attempt: i + 1, total: candidates.length });
    }
  }

  if (attempts.length <= 1 && lastError) throw lastError;

  const summary = attempts.map(a => `${a.provider}/${a.model}: ${a.error}${a.reason ? ` (${a.reason})` : ''}`).join(' | ');
  throw new FailoverError(`All models failed (${attempts.length}): ${summary}`, 'unknown', undefined, undefined, undefined, undefined, lastError);
}

function isAbortError(err: unknown): boolean {
  return err instanceof DOMException && err.name === 'AbortError';
}
