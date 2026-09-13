import { fetch } from 'expo/fetch';
import { useGatewayStore } from '../stores/gateway-store';
import { apiFetch } from './client';

export function gatewayAssetPath(uri: string): string | null {
  let url: URL;
  try { url = new URL(uri); } catch { return null; }
  const profile = useGatewayStore.getState().getActiveProfile();
  if (url.username || url.password || !profile?.routes.some((route) => route.url === url.origin)) return null;
  return url.pathname + url.search;
}

/** Credentials are only sent through the verified Gateway transport. */
export function fetchGatewayAsset(uri: string, signal?: AbortSignal): Promise<Response> {
  const path = gatewayAssetPath(uri);
  if (!path) throw new Error('GATEWAY_ASSET_ORIGIN_MISMATCH');
  return apiFetch(path, { signal, timeoutMs: 30_000 });
}

export function fetchPublicAsset(uri: string, init: RequestInit = {}): Promise<Response> {
  return fetch(uri, { ...init, headers: undefined, credentials: 'omit', redirect: 'error' });
}
