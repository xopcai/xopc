/**
 * Provider HTTP client for voice / media-understanding capabilities.
 *
 * Wraps `globalThis.fetch` with:
 *  - SSRF guard (assertSafeUrl) on every request
 *  - AbortSignal + timeout merging
 *  - Standardized error throwing via assertOkOrThrowProviderError
 *
 * DECISION (per docs/voice-rearchitecture.md §6):
 *  - All voice/STT provider HTTP calls MUST go through this module. Direct fetch()
 *    usage in provider files is a lint violation (enforced by reviewers, not
 *    automated yet).
 *  - We intentionally do NOT support HTTP/2 push, custom dispatchers, or
 *    connection pinning. xopc relies on Node 22 native fetch which uses undici
 *    under the hood; that's good enough for the request volumes we serve.
 */

import { setTimeout as setTimeoutPromise } from 'node:timers/promises';

import { assertOkOrThrowProviderError } from './provider-http-errors.js';
import { assertSafeUrl, type SsrfGuardOptions } from './ssrf-guard.js';

export interface ProviderHttpRequestConfig extends SsrfGuardOptions {
  /** Hard timeout in milliseconds. Required: callers must always specify. */
  timeoutMs: number;
  /** Extra abort signal (e.g. from caller cancellation). Merged with timeout signal. */
  signal?: AbortSignal;
  /**
   * Label used in thrown ProviderHttpError messages. Should look like
   * "OpenAI TTS" or "Alibaba paraformer-v2 transcription".
   */
  label: string;
}

export interface FetchWithGuardOptions extends ProviderHttpRequestConfig {
  /** Pre-built RequestInit; URL is the first positional argument. */
  init?: RequestInit;
}

/**
 * fetch + SSRF guard + timeout. Returns the raw Response (caller decides whether
 * to assertOk / parse / stream). Throws SsrfBlockedError on guard failure.
 */
export async function fetchWithTimeoutGuarded(
  url: string | URL,
  options: FetchWithGuardOptions,
): Promise<Response> {
  await assertSafeUrl(url, options);

  const controller = new AbortController();
  const timeoutHandle = setTimeout(() => controller.abort(), options.timeoutMs);

  // Merge caller signal with the timeout signal — abort whichever fires first.
  const callerSignal = options.signal;
  if (callerSignal) {
    if (callerSignal.aborted) {
      controller.abort(callerSignal.reason);
    } else {
      callerSignal.addEventListener('abort', () => controller.abort(callerSignal.reason), {
        once: true,
      });
    }
  }

  try {
    return await fetch(url, { ...options.init, signal: controller.signal });
  } finally {
    clearTimeout(timeoutHandle);
  }
}

export interface PostJsonRequestOptions extends ProviderHttpRequestConfig {
  body: unknown;
  headers?: Record<string, string> | Headers;
}

export async function postJsonRequest(
  url: string | URL,
  options: PostJsonRequestOptions,
): Promise<Response> {
  const headers = new Headers(options.headers);
  if (!headers.has('content-type')) {
    headers.set('content-type', 'application/json');
  }
  if (!headers.has('accept')) {
    headers.set('accept', 'application/json');
  }
  const response = await fetchWithTimeoutGuarded(url, {
    ...options,
    init: {
      method: 'POST',
      headers,
      body: JSON.stringify(options.body),
    },
  });
  await assertOkOrThrowProviderError(response, options.label);
  return response;
}

export interface PostMultipartRequestOptions extends ProviderHttpRequestConfig {
  body: FormData;
  headers?: Record<string, string> | Headers;
}

export async function postMultipartRequest(
  url: string | URL,
  options: PostMultipartRequestOptions,
): Promise<Response> {
  const headers = new Headers(options.headers);
  // Do NOT set content-type explicitly; fetch will compute the multipart boundary.
  const response = await fetchWithTimeoutGuarded(url, {
    ...options,
    init: {
      method: 'POST',
      headers,
      body: options.body,
    },
  });
  await assertOkOrThrowProviderError(response, options.label);
  return response;
}

export interface GetJsonRequestOptions extends ProviderHttpRequestConfig {
  headers?: Record<string, string> | Headers;
}

export async function getJsonRequest(
  url: string | URL,
  options: GetJsonRequestOptions,
): Promise<Response> {
  const headers = new Headers(options.headers);
  if (!headers.has('accept')) {
    headers.set('accept', 'application/json');
  }
  const response = await fetchWithTimeoutGuarded(url, {
    ...options,
    init: { method: 'GET', headers },
  });
  await assertOkOrThrowProviderError(response, options.label);
  return response;
}

/**
 * Normalize a base URL: trim trailing slash, force http(s) scheme.
 */
export function normalizeBaseUrl(baseUrl: string): string {
  const trimmed = baseUrl.trim().replace(/\/+$/, '');
  // Throws if not a valid URL — let it bubble.
  const parsed = new URL(trimmed);
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error(`Provider base URL must be http(s): "${baseUrl}"`);
  }
  return trimmed;
}

export interface ProviderOperationDeadline {
  /** Absolute monotonic deadline (Date.now() based). */
  deadlineMs: number;
  /** Throws if past the deadline. */
  assertNotExpired(): void;
  /** Returns remaining ms (clamped to 0). */
  remainingMs(): number;
}

export function createProviderOperationDeadline(timeoutMs: number): ProviderOperationDeadline {
  const deadlineMs = Date.now() + timeoutMs;
  return {
    deadlineMs,
    assertNotExpired() {
      if (Date.now() > deadlineMs) {
        throw new Error(`Provider operation exceeded ${timeoutMs}ms timeout`);
      }
    },
    remainingMs() {
      return Math.max(0, deadlineMs - Date.now());
    },
  };
}

/**
 * Sleep helper used by polling loops (DashScope async transcription).
 * Honors AbortSignal so callers can cancel cleanly.
 */
export async function waitProviderOperationPollInterval(
  intervalMs: number,
  signal?: AbortSignal,
): Promise<void> {
  if (intervalMs <= 0) {
    return;
  }
  await setTimeoutPromise(intervalMs, undefined, { signal });
}
