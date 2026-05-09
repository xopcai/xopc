/**
 * FailoverError — uniform terminal error after all candidate provider/model
 * attempts have failed.
 *
 * Used by capability runtimes (image / audio / video) so that:
 *   - the agent surface gets a single error message
 *   - the tool layer can serialize structured `attempts` for the LLM and UI
 *   - downstream code can reason about a "reason" enum instead of parsing
 *     vendor-specific status codes.
 *
 * Step 1: pure model. Step 2 wires it into the new image-generation runtime.
 */

import { ProviderHttpError, isTimeoutAbortError } from '../media-shared/http/index.js';

/**
 * Coarse failure category. UI / LLM should branch on this rather than
 * `error.message`.
 */
export type FailoverReason =
  | 'timeout'
  | 'aborted'
  | 'auth'
  | 'rate_limit'
  | 'bad_request'
  | 'not_found'
  | 'server_error'
  | 'network'
  | 'capability_unsupported'
  | 'config'
  | 'unknown';

/** One attempt against a single provider/model. */
export interface FallbackAttempt {
  /** Provider id, e.g. "openai". */
  provider: string;
  /** Model id, e.g. "gpt-image-1". */
  model: string;
  /** Short, human-readable failure summary. */
  error: string;
  /** Coarse category. */
  reason: FailoverReason;
  /** HTTP status when applicable. */
  status?: number;
  /** Vendor-specific code when assertOk could parse one. */
  code?: string;
  /** Wall-clock duration of this attempt in ms. */
  durationMs?: number;
}

export interface FailoverErrorInit {
  /** Capability that failed, e.g. "image-generation", "tts". */
  capability: string;
  /** Ordered attempts that ran. */
  attempts: FallbackAttempt[];
  /** Optional final aggregate message; default summarises attempts. */
  message?: string;
  /** Last underlying error for `cause` chain. */
  cause?: unknown;
}

export class FailoverError extends Error {
  readonly capability: string;
  readonly attempts: ReadonlyArray<FallbackAttempt>;
  /** Convenience: reason from the last attempt, or 'unknown' if empty. */
  readonly reason: FailoverReason;
  /** Convenience: status from the last attempt. */
  readonly status?: number;
  /** Convenience: code from the last attempt. */
  readonly code?: string;
  /** Convenience: provider from the last attempt. */
  readonly provider?: string;
  /** Convenience: model from the last attempt. */
  readonly model?: string;

  constructor(init: FailoverErrorInit) {
    const last = init.attempts[init.attempts.length - 1];
    const message = init.message ?? defaultMessage(init.capability, init.attempts);
    super(message);
    this.name = 'FailoverError';
    this.capability = init.capability;
    this.attempts = Object.freeze([...init.attempts]);
    this.reason = last?.reason ?? 'unknown';
    this.status = last?.status;
    this.code = last?.code;
    this.provider = last?.provider;
    this.model = last?.model;
    if (init.cause !== undefined) {
      // Standard Error.cause (Node 16+).
      (this as { cause?: unknown }).cause = init.cause;
    }
  }
}

/** Cross-realm-safe predicate (instanceof breaks across vm boundaries). */
export function isFailoverError(e: unknown): e is FailoverError {
  if (e instanceof FailoverError) return true;
  if (!e || typeof e !== 'object') return false;
  const obj = e as { name?: unknown; capability?: unknown; attempts?: unknown };
  return obj.name === 'FailoverError' && typeof obj.capability === 'string' && Array.isArray(obj.attempts);
}

/**
 * Pretty multi-line description for logs / CLI output. Each line is
 * `<i>. <provider>/<model> [<reason>] (status=<n>): <error>`.
 */
export function describeFailoverError(e: FailoverError): string {
  const head = `[${e.capability}] ${e.attempts.length} attempt(s) failed`;
  const lines = e.attempts.map((a, i) => {
    const parts = [`${i + 1}. ${a.provider}/${a.model}`, `[${a.reason}]`];
    if (a.status !== undefined) parts.push(`status=${a.status}`);
    if (a.code) parts.push(`code=${a.code}`);
    parts.push(`- ${a.error}`);
    return parts.join(' ');
  });
  return [head, ...lines].join('\n');
}

/**
 * Map an HTTP status to a {@link FailoverReason}.
 */
export function reasonFromHttpStatus(status: number | undefined): FailoverReason {
  if (typeof status !== 'number' || !Number.isFinite(status)) return 'unknown';
  if (status === 401 || status === 403) return 'auth';
  if (status === 404) return 'not_found';
  if (status === 408) return 'timeout';
  if (status === 429) return 'rate_limit';
  if (status >= 400 && status < 500) return 'bad_request';
  if (status >= 500 && status < 600) return 'server_error';
  return 'unknown';
}

/**
 * Best-effort classifier from an arbitrary thrown value into a
 * {@link FallbackAttempt}-friendly shape.
 */
export function classifyAttemptError(e: unknown): {
  reason: FailoverReason;
  status?: number;
  code?: string;
  message: string;
} {
  if (e instanceof ProviderHttpError) {
    return {
      reason: reasonFromHttpStatus(e.status),
      status: e.status,
      code: e.code,
      message: e.message,
    };
  }
  if (isTimeoutAbortError(e)) {
    return { reason: 'timeout', message: e.message };
  }
  if (isAbortError(e)) {
    return { reason: 'aborted', message: 'Request aborted by caller' };
  }
  if (isFetchTransportError(e)) {
    const em = e instanceof Error ? e.message : String(e);
    return { reason: 'network', message: em };
  }
  const em = e instanceof Error ? e.message : String(e);
  return { reason: 'unknown', message: em };
}

function defaultMessage(capability: string, attempts: FallbackAttempt[]): string {
  if (attempts.length === 0) {
    return `Capability "${capability}" failed: no candidates were attempted.`;
  }
  const last = attempts[attempts.length - 1];
  const summary = `${last.provider}/${last.model} failed with ${last.reason}`;
  return `Capability "${capability}" failed after ${attempts.length} attempt(s); last: ${summary}: ${last.error}`;
}

function isAbortError(e: unknown): boolean {
  if (!e || typeof e !== 'object') return false;
  const o = e as { name?: unknown };
  return o.name === 'AbortError';
}

function isFetchTransportError(e: unknown): boolean {
  if (!(e instanceof Error)) return false;
  const msg = e.message.toLowerCase();
  return (
    msg.includes('fetch failed') ||
    msg.includes('network') ||
    msg.includes('econnrefused') ||
    msg.includes('econnreset') ||
    msg.includes('enotfound')
  );
}
