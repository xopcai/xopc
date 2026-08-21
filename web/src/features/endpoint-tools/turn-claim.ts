import type { EndpointTurnClaim } from '@xopcai/endpoint-tools-protocol';

const WAIT_TIMEOUT_MS = 10_000;

let activeClaim: EndpointTurnClaim | undefined;
const waiters = new Set<(claim: EndpointTurnClaim) => void>();

export function publishEndpointTurnClaim(endpointId: string, token: string): void {
  activeClaim = { type: 'endpoint', endpointId, token };
  for (const resolve of waiters) resolve(activeClaim);
  waiters.clear();
}

export function clearEndpointTurnClaim(token?: string): void {
  if (!activeClaim || (token && activeClaim.token !== token)) return;
  activeClaim = undefined;
}

export function waitForEndpointTurnClaim(signal?: AbortSignal): Promise<EndpointTurnClaim> {
  if (activeClaim) return Promise.resolve(activeClaim);
  if (signal?.aborted) return Promise.reject(signal.reason);

  return new Promise((resolve, reject) => {
    const onClaim = (claim: EndpointTurnClaim) => {
      cleanup();
      resolve(claim);
    };
    const onAbort = () => {
      cleanup();
      reject(signal?.reason ?? new DOMException('Aborted', 'AbortError'));
    };
    const timeout = globalThis.setTimeout(() => {
      cleanup();
      reject(new Error('Endpoint connection is not ready'));
    }, WAIT_TIMEOUT_MS);
    const cleanup = () => {
      globalThis.clearTimeout(timeout);
      waiters.delete(onClaim);
      signal?.removeEventListener('abort', onAbort);
    };
    waiters.add(onClaim);
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}
