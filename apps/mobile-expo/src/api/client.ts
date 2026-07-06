/**
 * Single, structured fetch wrapper for every gateway request. Three jobs:
 *   1. Build URL + auth header from the active gateway profile.
 *   2. Apply a wallclock timeout so a dead route never hangs the UI.
 *   3. Translate raw fetch failures into `GatewayConnectivityError` so the
 *      UI can show actionable copy ("computer offline" vs "no internet"
 *      vs "token expired") instead of a generic spinner-then-fail.
 *
 * Idempotent calls (GET / HEAD) automatically dual-fire LAN+tunnel when we
 * don't yet have a network-scoped cached winner — bootstrap GET behaviour
 * without callers having to opt in.
 */
import { recordConnectionEvent } from '../features/gateway/connection-log';
import { getNetworkSnapshot } from '../features/gateway/network-info';
import { useGatewayStore } from '../stores/gateway-store';

import { dualFireFetch, hasCachedRouteWinner } from './dual-fire-fetch';
import { GatewayConnectivityError, type GatewayErrorKind } from './gateway-error';
import { notifyUnauthorizedIfNeeded } from './notify-unauthorized';

const DEFAULT_FETCH_TIMEOUT_MS = 8_000;

export function formatApiHttpError(status: number, statusText: string, message?: string): string {
  const m = message?.trim();
  if (m) return `${status} ${statusText}: ${m}`;
  return `${status} ${statusText}`;
}

function isAbortError(err: unknown): boolean {
  if (err instanceof Error) {
    if (err.name === 'AbortError') return true;
    if (err.message.toLowerCase().includes('abort')) return true;
  }
  return false;
}

function classifyFetchError(err: unknown): GatewayErrorKind {
  if (getNetworkSnapshot().kind === 'offline') return 'offline-network';
  if (isAbortError(err)) return 'no-route';
  return 'no-route';
}

export type ApiFetchOptions = RequestInit & {
  timeoutMs?: number;
  /** Force single-route even when route confidence is low. Used inside
   * dual-fire path to avoid recursion. */
  noDualFire?: boolean;
};

function isIdempotent(method: string | undefined): boolean {
  const m = (method ?? 'GET').toUpperCase();
  return m === 'GET' || m === 'HEAD';
}

function bothRoutesConfigured(): boolean {
  const { baseUrl, lanUrl } = useGatewayStore.getState();
  return Boolean(baseUrl.trim() && lanUrl?.trim());
}

export async function apiFetch(path: string, init?: ApiFetchOptions): Promise<Response> {
  const { token, baseUrl, lanUrl } = useGatewayStore.getState();
  if (!baseUrl.trim() && !lanUrl?.trim()) {
    throw new GatewayConnectivityError('misconfigured', 'Gateway base URL is not configured');
  }

  // Confidence-aware bootstrap: idempotent calls fan out across both routes
  // when we haven't pinned a winner for the current network. The user gets
  // the first 2xx; the other request is aborted.
  if (
    !init?.noDualFire &&
    isIdempotent(init?.method) &&
    bothRoutesConfigured() &&
    !hasCachedRouteWinner()
  ) {
    return dualFireFetch(path, init ?? { method: 'GET' });
  }

  const headers = new Headers(init?.headers);
  if (!headers.has('Content-Type') && init?.body != null && typeof init.body === 'string') {
    headers.set('Content-Type', 'application/json');
  }
  if (token) headers.set('Authorization', `Bearer ${token}`);

  const url = useGatewayStore.getState().apiUrl(path);
  const controller = new AbortController();
  const timeoutMs = init?.timeoutMs ?? DEFAULT_FETCH_TIMEOUT_MS;
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const callerSignal = init?.signal;
  const onCallerAbort = () => controller.abort();
  if (callerSignal) {
    if (callerSignal.aborted) controller.abort();
    else callerSignal.addEventListener('abort', onCallerAbort);
  }

  let res: Response;
  const startedAt = Date.now();
  try {
    res = await fetch(url, { ...init, headers, signal: controller.signal });
  } catch (err) {
    const kind = classifyFetchError(err);
    recordConnectionEvent({
      kind: 'apiFetch',
      ok: false,
      url,
      reason: kind,
      message: err instanceof Error ? err.message : String(err),
      network: getNetworkSnapshot().key,
    });
    throw new GatewayConnectivityError(
      kind,
      kind === 'offline-network' ? 'No internet connection' : 'Could not reach gateway',
      { cause: err },
    );
  } finally {
    clearTimeout(timer);
    if (callerSignal) callerSignal.removeEventListener('abort', onCallerAbort);
  }

  notifyUnauthorizedIfNeeded(res.status);

  recordConnectionEvent({
    kind: 'apiFetch',
    ok: res.ok,
    url,
    latencyMs: Date.now() - startedAt,
    network: getNetworkSnapshot().key,
    reason: res.ok ? undefined : `http_${res.status}`,
  });

  return res;
}

export { notifyUnauthorizedIfNeeded };

export function buildAgentSseHeaders(): Record<string, string> {
  const { token } = useGatewayStore.getState();
  const headers: Record<string, string> = {
    Accept: 'text/event-stream',
    'Content-Type': 'application/json',
  };
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }
  return headers;
}
