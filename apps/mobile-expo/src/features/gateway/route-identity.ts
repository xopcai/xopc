import { fetch } from 'expo/fetch';
import type { GatewayProfile } from '../../stores/gateway-types';
import { decodeBase64UrlJson, randomNonce, verifyGatewayPayload } from './device-crypto';

const verified = new Map<string, number>();
const pending = new Map<string, Promise<void>>();

/** Detect wrong destinations before sending credentials. This is not an encrypted application channel. */
export async function ensureGatewayRouteIdentity(profile: GatewayProfile, routeUrl: string, signal?: AbortSignal): Promise<void> {
  const route = new URL(routeUrl);
  if (route.protocol !== 'https:' || route.origin !== routeUrl) throw new Error('GATEWAY_IDENTITY_MISMATCH');
  const key = JSON.stringify([profile.gatewayId, profile.gatewayPublicKey, routeUrl]);
  if ((verified.get(key) ?? 0) > Date.now()) return;
  const existing = pending.get(key);
  if (existing) return existing;
  const task = (async () => {
    const nonce = randomNonce();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8_000);
    const abort = () => controller.abort();
    if (signal?.aborted) controller.abort();
    else signal?.addEventListener('abort', abort, { once: true });
    try {
      const response = await fetch(`${routeUrl}/api/gateway-identity/challenge`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, redirect: 'error', signal: controller.signal,
        body: JSON.stringify({ nonce }),
      });
      const body = await response.json() as { signedPayload?: string; signature?: string };
      if (!response.ok || !body.signedPayload || !body.signature || !verifyGatewayPayload(profile.gatewayPublicKey, body.signedPayload, body.signature)) throw new Error('GATEWAY_IDENTITY_MISMATCH');
      const payload = decodeBase64UrlJson<{ purpose: string; gatewayId: string; nonce: string; expiresAt: number }>(body.signedPayload);
      if (payload.purpose !== 'gateway-route-v1' || payload.gatewayId !== profile.gatewayId || payload.nonce !== nonce
        || !(payload.expiresAt > Date.now()) || payload.expiresAt > Date.now() + 60_000) throw new Error('GATEWAY_IDENTITY_MISMATCH');
      // Entries are short lived and bounded; restarting or foregrounding verifies again.
      for (const [id, expiresAt] of verified) if (expiresAt <= Date.now()) verified.delete(id);
      if (verified.size >= 64) verified.clear();
      verified.set(key, Math.min(payload.expiresAt, Date.now() + 30_000));
    } finally { clearTimeout(timer); signal?.removeEventListener('abort', abort); }
  })();
  pending.set(key, task);
  try { await task; } finally { pending.delete(key); }
}
export function clearGatewayRouteIdentityCache(): void { verified.clear(); }
