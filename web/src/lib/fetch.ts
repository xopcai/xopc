import { formatApiHttpError } from '@/lib/http-error-message';
import { useGatewayStore } from '@/stores/gateway-store';

/**
 * Latches on the first 401 to keep concurrent SWR / panel requests from
 * stampeding the gateway with the same stale token. Without it, a single
 * expired token expands into ~10 parallel 401s — each was previously counted
 * as a brute-force attempt and could lock the user out before the token
 * dialog even opened.
 *
 * Released by the `token-saved` window event dispatched from
 * `useGatewayStore.setGatewayToken`. In-flight requests that miss the latch
 * still get 401, but the gateway-side 1-second burst coalesce collapses
 * them into a single attempt.
 */
let authBarrier: Promise<void> | null = null;
let releaseBarrier: (() => void) | null = null;

function engageAuthBarrier(): void {
  if (authBarrier) return;
  authBarrier = new Promise<void>((resolve) => {
    releaseBarrier = resolve;
  });
}

function releaseAuthBarrier(): void {
  if (!authBarrier) return;
  releaseBarrier?.();
  authBarrier = null;
  releaseBarrier = null;
}

if (typeof window !== 'undefined') {
  window.addEventListener('token-saved', releaseAuthBarrier);
}

/** Test-only — drops barrier state between cases. */
export function __resetAuthBarrierForTests(): void {
  releaseAuthBarrier();
}

export async function apiFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  if (authBarrier) {
    await authBarrier;
  }

  const token = useGatewayStore.getState().token;
  const headers = new Headers(init?.headers);
  const body = init?.body;
  const isFormData =
    typeof FormData !== 'undefined' && body instanceof FormData;
  if (!headers.has('Content-Type') && !isFormData) {
    headers.set('Content-Type', 'application/json');
  }
  if (token) {
    headers.set('Authorization', `Bearer ${token}`);
  }

  const res = await fetch(input, { ...init, headers });

  if (res.status === 401) {
    engageAuthBarrier();
    useGatewayStore.getState().onUnauthorized();
  }

  return res;
}

export async function fetchJson<T>(input: RequestInfo | URL, init?: RequestInit): Promise<T> {
  const res = await apiFetch(input, init);
  if (!res.ok) {
    const errorBody = (await res.json().catch(() => ({}))) as {
      error?: string | { message?: string };
    };
    const serverMessage =
      typeof errorBody.error === 'string' ? errorBody.error : errorBody.error?.message;
    const msg = formatApiHttpError(res.status, res.statusText, serverMessage);
    throw new Error(msg);
  }
  return res.json() as Promise<T>;
}
