import { apiFetch } from '../../api/client';
import { waitForMobileEndpointTurnClaim } from '../endpoint-tools/turn-claim';

export async function submitSessionInput(sessionKey: string, input: Record<string, unknown>): Promise<unknown> {
  const origin = await waitForMobileEndpointTurnClaim();
  const res = await apiFetch(`/api/sessions/${encodeURIComponent(sessionKey)}/inputs`, {
    method: 'POST',
    body: JSON.stringify({
      ...input,
      origin,
    }),
  });
  const json = await res.json().catch(() => null) as {
    payload?: { state?: unknown };
    error?: string | { message?: string };
  } | null;
  if (!res.ok) {
    const message = typeof json?.error === 'string' ? json.error : json?.error?.message;
    throw new Error(message ?? 'Message was not accepted');
  }
  if (!json?.payload?.state) throw new Error('Gateway returned an invalid input state');
  return json.payload.state;
}

export async function getSessionInputState(sessionKey: string): Promise<unknown> {
  const res = await apiFetch(`/api/sessions/${encodeURIComponent(sessionKey)}/input-state`);
  const json = await res.json().catch(() => null) as {
    payload?: unknown;
    error?: string | { message?: string };
  } | null;
  if (!res.ok) {
    const message = typeof json?.error === 'string' ? json.error : json?.error?.message;
    throw new Error(message ?? 'Input state could not be loaded');
  }
  return json?.payload;
}
