/**
 * Provider HTTP — JSON POST helper.
 *
 * Wraps `fetch` with: deadline + private-network guard + uniform error mapper +
 * structured logging. Returns the raw {@link Response} so callers can stream
 * or read JSON / binary as needed.
 */

import { createLogger } from '../../utils/logger.js';
import { assertOk } from './assert-ok.js';
import { resolveDeadline } from './deadline.js';
import { assertNotPrivateNetwork, type PrivateNetworkPolicy } from './private-network.js';

const log = createLogger('ProviderHttp');

export interface PostJsonRequestOptions {
  /** Provider id, used for log correlation only. */
  providerId: string;
  /** Absolute URL. */
  url: string;
  /** JSON-serializable body. */
  body: unknown;
  /** Extra headers; merged with `Content-Type: application/json` and `Accept: application/json`. */
  headers?: Record<string, string>;
  /** Per-call timeout (ms). */
  timeoutMs?: number;
  /** Provider-default timeout (ms). */
  providerDefaultTimeoutMs?: number;
  /** Upstream cancellation. */
  signal?: AbortSignal;
  /** SSRF policy override. */
  networkPolicy?: PrivateNetworkPolicy;
  /** Override `fetch` (test only). */
  fetchImpl?: typeof fetch;
}

export async function postJsonRequest(options: PostJsonRequestOptions): Promise<Response> {
  assertNotPrivateNetwork(options.url, options.networkPolicy);

  const deadline = resolveDeadline({
    timeoutMs: options.timeoutMs,
    providerDefaultMs: options.providerDefaultTimeoutMs,
    signal: options.signal,
  });

  const headers: Record<string, string> = {
    accept: 'application/json',
    'content-type': 'application/json',
    ...lowerCaseHeaderKeys(options.headers),
  };

  const startedAt = Date.now();
  const fetchImpl = options.fetchImpl ?? fetch;
  let res: Response;
  try {
    res = await fetchImpl(options.url, {
      method: 'POST',
      headers,
      body: JSON.stringify(options.body ?? {}),
      signal: deadline.signal,
    });
  } catch (err) {
    deadline.cleanup();
    const em = err instanceof Error ? err.message : String(err);
    log.warn(
      {
        providerId: options.providerId,
        url: options.url,
        durationMs: Date.now() - startedAt,
        timeoutMs: deadline.timeoutMs,
        errorMessage: em,
      },
      `JSON POST transport failed: ${em}`,
    );
    throw err;
  }
  deadline.cleanup();

  log.debug(
    {
      providerId: options.providerId,
      url: options.url,
      status: res.status,
      durationMs: Date.now() - startedAt,
      timeoutMs: deadline.timeoutMs,
    },
    `JSON POST ${res.status}`,
  );

  return assertOk(res, options.url);
}

function lowerCaseHeaderKeys(input?: Record<string, string>): Record<string, string> {
  if (!input) return {};
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(input)) {
    if (typeof v === 'string') out[k.toLowerCase()] = v;
  }
  return out;
}
