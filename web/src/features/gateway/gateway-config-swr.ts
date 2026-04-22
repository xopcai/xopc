import { useEffect } from 'react';
import useSWR, { mutate } from 'swr';

import { fetchJson } from '@/lib/fetch';
import { apiUrl } from '@/lib/url';

export type GatewayConfigApiResponse = {
  ok?: boolean;
  payload?: { config?: unknown };
};

export function gatewayConfigSwrKey(): string {
  return apiUrl('/api/config');
}

let _gatewayConfigInflight: Promise<GatewayConfigApiResponse> | null = null;

/**
 * GET /api/config. Concurrent in-flight calls share one HTTP request (e.g. onboarding + SWR
 * on settings, or chat bootstrap + `fetchChatAgents` fallback) so a full refresh does not
 * duplicate the same payload fetch.
 */
export async function fetchGatewayConfigSwrResponse(): Promise<GatewayConfigApiResponse> {
  if (_gatewayConfigInflight) return _gatewayConfigInflight;
  _gatewayConfigInflight = fetchJson<GatewayConfigApiResponse>(gatewayConfigSwrKey()).finally(
    () => {
      _gatewayConfigInflight = null;
    },
  );
  return _gatewayConfigInflight;
}

/**
 * Shared GET /api/config for gateway console. Multiple settings panels use the same SWR key so
 * navigation and Strict Mode do not duplicate network calls.
 */
export function useGatewayConfigSwr(shouldFetch: boolean) {
  const key = shouldFetch ? gatewayConfigSwrKey() : null;
  const swr = useSWR(key, fetchGatewayConfigSwrResponse, { revalidateOnFocus: false });

  useEffect(() => {
    if (!shouldFetch) return;
    const k = gatewayConfigSwrKey();
    const onReload = () => {
      void mutate(k);
    };
    window.addEventListener('config-reload', onReload);
    return () => window.removeEventListener('config-reload', onReload);
  }, [shouldFetch]);

  return swr;
}

export function revalidateGatewayConfig(): Promise<GatewayConfigApiResponse | undefined> {
  return mutate(gatewayConfigSwrKey());
}
