import { File, UploadType } from 'expo-file-system';

import { recordConnectionEvent } from '../features/gateway/connection-log';
import { getDeviceAccessToken, refreshDeviceAccessToken } from '../features/gateway/device-auth-session';
import { getNetworkSnapshot } from '../features/gateway/network-info';
import { useGatewayStore } from '../stores/gateway-store';
import { GatewayConnectivityError, type GatewayErrorKind } from './gateway-error';

const DEFAULT_FETCH_TIMEOUT_MS = 8_000;

export function formatApiHttpError(status: number, statusText: string, message?: string): string {
  const detail = message?.trim();
  return detail ? `${status} ${statusText}: ${detail}` : `${status} ${statusText}`;
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && (error.name === 'AbortError' || error.message.toLowerCase().includes('abort'));
}

function classifyFetchError(error: unknown): GatewayErrorKind {
  if (getNetworkSnapshot().kind === 'offline') return 'offline-network';
  return isAbortError(error) ? 'no-route' : 'no-route';
}

export type ApiFetchOptions = RequestInit & {
  timeoutMs?: number;
  recoverRouteOnNetworkError?: boolean;
};

export type ApiFileUploadOptions = {
  uri: string;
  fieldName: string;
  mimeType: string;
  parameters?: Record<string, string>;
  headers?: HeadersInit;
  timeoutMs?: number;
  signal?: AbortSignal;
  recoverRouteOnNetworkError?: boolean;
};

function routeCandidates(allowFallback: boolean): Array<{ id: string; url: string }> {
  const profile = useGatewayStore.getState().getActiveProfile();
  if (!profile) throw new GatewayConnectivityError('misconfigured', 'No paired gateway is active');
  const active = profile.routes.find((route) => route.id === profile.activeRouteId);
  if (!active) throw new GatewayConnectivityError('misconfigured', 'Active gateway route is unavailable');
  return allowFallback ? [active, ...profile.routes.filter((route) => route.id !== active.id)] : [active];
}

async function fetchRoute(
  url: string,
  init: RequestInit,
  timeoutMs: number,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const callerSignal = init.signal;
  const onAbort = () => controller.abort();
  if (callerSignal) {
    if (callerSignal.aborted) controller.abort();
    else callerSignal.addEventListener('abort', onAbort);
  }
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
    callerSignal?.removeEventListener('abort', onAbort);
  }
}

export async function apiFetch(path: string, init: ApiFetchOptions = {}): Promise<Response> {
  const { timeoutMs = DEFAULT_FETCH_TIMEOUT_MS, recoverRouteOnNetworkError, ...requestInit } = init;
  const method = (requestInit.method ?? 'GET').toUpperCase();
  const canFailOver = recoverRouteOnNetworkError === true || method === 'GET' || method === 'HEAD';
  let token = await getDeviceAccessToken();
  let refreshedAfterUnauthorized = false;
  let lastError: unknown;

  for (const route of routeCandidates(canFailOver)) {
    const headers = new Headers(requestInit.headers);
    if (!headers.has('Content-Type') && typeof requestInit.body === 'string') headers.set('Content-Type', 'application/json');
    headers.set('Authorization', `Bearer ${token}`);
    const url = `${route.url}${path.startsWith('/') ? path : `/${path}`}`;
    const startedAt = Date.now();
    try {
      let response = await fetchRoute(url, { ...requestInit, headers }, timeoutMs);
      if (response.status === 401 && !refreshedAfterUnauthorized) {
        token = await refreshDeviceAccessToken();
        refreshedAfterUnauthorized = true;
        headers.set('Authorization', `Bearer ${token}`);
        response = await fetchRoute(url, { ...requestInit, headers }, timeoutMs);
      }
      recordConnectionEvent({
        kind: 'apiFetch', ok: response.ok, url, latencyMs: Date.now() - startedAt,
        network: getNetworkSnapshot().key, reason: response.ok ? undefined : `http_${response.status}`,
      });
      if (response.ok && route.id !== useGatewayStore.getState().getActiveProfile()?.activeRouteId) {
        const gatewayId = useGatewayStore.getState().activeGatewayId;
        if (gatewayId) useGatewayStore.getState().selectRoute(gatewayId, route.id);
      }
      if (response.status === 401) useGatewayStore.getState().onUnauthorized();
      return response;
    } catch (error) {
      if (requestInit.signal?.aborted) throw error;
      lastError = error;
      recordConnectionEvent({
        kind: 'apiFetch', ok: false, url, reason: classifyFetchError(error),
        message: error instanceof Error ? error.message : String(error), network: getNetworkSnapshot().key,
      });
    }
  }

  const kind = classifyFetchError(lastError);
  throw new GatewayConnectivityError(
    kind,
    kind === 'offline-network' ? 'No internet connection' : 'Could not reach gateway',
    { cause: lastError },
  );
}

export async function apiUploadFile(path: string, options: ApiFileUploadOptions): Promise<Response> {
  let file: File;
  try {
    file = new File(options.uri);
  } catch (error) {
    throw new Error('Recording file URI is invalid', { cause: error });
  }
  if (!file.exists) throw new Error('Recording file is no longer available');
  if ((file.size ?? 0) <= 0) throw new Error('Recording file is empty');

  const token = await getDeviceAccessToken();
  let lastError: unknown;
  for (const route of routeCandidates(options.recoverRouteOnNetworkError === true)) {
    const headers: Record<string, string> = { Authorization: `Bearer ${token}` };
    new Headers(options.headers).forEach((value, key) => { headers[key] = value; });
    const url = `${route.url}${path.startsWith('/') ? path : `/${path}`}`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? DEFAULT_FETCH_TIMEOUT_MS);
    const onAbort = () => controller.abort();
    if (options.signal) {
      if (options.signal.aborted) controller.abort();
      else options.signal.addEventListener('abort', onAbort);
    }
    try {
      const result = await file.upload(url, {
        httpMethod: 'POST', uploadType: UploadType.MULTIPART, fieldName: options.fieldName,
        mimeType: options.mimeType, parameters: options.parameters, headers, signal: controller.signal,
      });
      const response = new Response(result.body, { status: result.status, headers: result.headers });
      if (response.status === 401) useGatewayStore.getState().onUnauthorized();
      if (response.ok && route.id !== useGatewayStore.getState().getActiveProfile()?.activeRouteId) {
        const gatewayId = useGatewayStore.getState().activeGatewayId;
        if (gatewayId) useGatewayStore.getState().selectRoute(gatewayId, route.id);
      }
      return response;
    } catch (error) {
      if (options.signal?.aborted) throw error;
      lastError = error;
    } finally {
      clearTimeout(timer);
      options.signal?.removeEventListener('abort', onAbort);
    }
  }
  const kind = classifyFetchError(lastError);
  throw new GatewayConnectivityError(kind, kind === 'offline-network' ? 'No internet connection' : 'Could not reach gateway', { cause: lastError });
}

export function notifyUnauthorizedIfNeeded(status: number): void {
  if (status === 401) useGatewayStore.getState().onUnauthorized();
}
