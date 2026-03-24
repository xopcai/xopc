import { useGatewayStore } from '@/stores/gateway-store';

export async function apiFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const token = useGatewayStore.getState().token;
  const headers = new Headers(init?.headers);
  if (!headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }
  if (token) {
    headers.set('Authorization', `Bearer ${token}`);
  }

  const res = await fetch(input, { ...init, headers });

  if (res.status === 401) {
    useGatewayStore.getState().onUnauthorized();
  }

  return res;
}

export async function fetchJson<T>(input: RequestInfo | URL, init?: RequestInit): Promise<T> {
  const res = await apiFetch(input, init);
  if (!res.ok) {
    const errorBody = (await res.json().catch(() => ({}))) as { error?: { message?: string } };
    throw new Error(errorBody.error?.message || `HTTP ${res.status}: ${res.statusText}`);
  }
  return res.json() as Promise<T>;
}
