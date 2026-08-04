/**
 * Shared provider HTTP client (voice, STT/TTS, image-generation extensions).
 *
 * Wraps `globalThis.fetch` with SSRF guard (`assertSafeUrl`), timeout + signal
 * merge, and standardized errors via `assertOkOrThrowProviderError`.
 */

import { setTimeout as setTimeoutPromise } from 'node:timers/promises';

import { assertOkOrThrowProviderError } from './provider-http-errors.js';
import { assertSafeUrl, type SsrfGuardOptions } from './ssrf-guard.js';

function mergeHeadersRecord(
  input?: Record<string, string> | Headers,
): Record<string, string> {
  const out: Record<string, string> = {};
  if (!input) {
    return out;
  }
  if (input instanceof Headers) {
    input.forEach((value, key) => {
      out[key.toLowerCase()] = value;
    });
    return out;
  }
  for (const [k, v] of Object.entries(input)) {
    if (typeof v === 'string') {
      out[k.toLowerCase()] = v;
    }
  }
  return out;
}

export interface ProviderHttpRequestConfig extends SsrfGuardOptions {
  /** Hard timeout in milliseconds. Required: callers must always specify. */
  timeoutMs: number;
  /** Extra abort signal (e.g. from caller cancellation). Merged with timeout signal. */
  signal?: AbortSignal;
  /**
   * Label used in thrown ProviderHttpError messages. Should look like
   * "OpenAI TTS", "dashscope", or "Alibaba paraformer-v2 transcription".
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
  const headers = mergeHeadersRecord(options.headers);
  if (!headers['content-type']) {
    headers['content-type'] = 'application/json';
  }
  if (!headers.accept) {
    headers.accept = 'application/json';
  }
  const response = await fetchWithTimeoutGuarded(url, {
    ...options,
    init: {
      method: 'POST',
      headers,
      body: JSON.stringify(options.body),
      redirect: 'error',
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
  const headers = mergeHeadersRecord(options.headers);
  const response = await fetchWithTimeoutGuarded(url, {
    ...options,
    init: {
      method: 'POST',
      headers,
      body: options.body,
      redirect: 'error',
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
  const headers = mergeHeadersRecord(options.headers);
  if (!headers.accept) {
    headers.accept = 'application/json';
  }
  const response = await fetchWithTimeoutGuarded(url, {
    ...options,
    init: { method: 'GET', headers, redirect: 'error' },
  });
  await assertOkOrThrowProviderError(response, options.label);
  return response;
}

/** Read and parse a JSON response without allowing an unbounded body allocation. */
export async function readJsonResponseLimited(
  response: Response,
  maxBytes: number,
): Promise<unknown> {
  if (!Number.isSafeInteger(maxBytes) || maxBytes <= 0) {
    throw new Error('JSON response byte limit must be a positive safe integer.');
  }
  const declaredLength = Number.parseInt(response.headers.get('content-length') ?? '', 10);
  if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
    throw new Error(`Provider JSON response exceeds ${maxBytes} bytes.`);
  }

  const reader = response.body?.getReader();
  if (!reader) throw new Error('Provider returned an empty JSON response.');
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      if (!value?.byteLength) continue;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel().catch(() => {});
        throw new Error(`Provider JSON response exceeds ${maxBytes} bytes.`);
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const body = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return JSON.parse(new TextDecoder().decode(body)) as unknown;
  } catch {
    throw new Error('Provider returned invalid JSON.');
  }
}

/**
 * Normalize a base URL: trim trailing slash, force http(s) scheme.
 */
export function normalizeBaseUrl(baseUrl: string): string {
  const trimmed = baseUrl.trim().replace(/\/+$/, '');
  const parsed = new URL(trimmed);
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error(`Provider base URL must be http(s): "${baseUrl}"`);
  }
  return trimmed;
}

export interface ProviderOperationDeadline {
  deadlineMs: number;
  assertNotExpired(): void;
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

export async function waitProviderOperationPollInterval(
  intervalMs: number,
  signal?: AbortSignal,
): Promise<void> {
  if (intervalMs <= 0) {
    return;
  }
  await setTimeoutPromise(intervalMs, undefined, { signal });
}
