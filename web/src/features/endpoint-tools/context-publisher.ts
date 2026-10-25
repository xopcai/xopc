import { EndpointContextPublisher } from '@xopcai/endpoint-tools-client';

import { apiFetch } from '@/lib/fetch';
import { apiUrl } from '@/lib/url';
let activePublisher: EndpointContextPublisher | undefined;
export async function refreshLocalEndpointContext() { await activePublisher?.refresh(); }

export function createEndpointContextPublisher() {
  const publisher = new EndpointContextPublisher({
    request: async (path, body, signal) => {
      const response = await apiFetch(apiUrl(path), { method: body === undefined ? 'GET' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        signal: AbortSignal.any([signal ?? new AbortController().signal, AbortSignal.timeout(10_000)]) });
      if (!response.ok) return { ok: false };
      return response.json();
    },
    capture: () => ({ 'environment.timezone': Intl.DateTimeFormat().resolvedOptions().timeZone,
      'environment.locale': navigator.language }),
    isForeground: () => document.visibilityState === 'visible' && document.hasFocus(),
    createId: () => crypto.randomUUID(),
  });
  activePublisher = publisher;
  return publisher;
}
