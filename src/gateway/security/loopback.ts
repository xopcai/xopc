/**
 * Loopback / browser-origin classification helpers used by rate-limit policy
 * and other security middleware. Pure functions, no I/O.
 */

import { isLoopbackHost } from '../host.js';

export function isLoopbackClientIp(clientIp: string | undefined): boolean {
  if (!clientIp || clientIp === 'unknown') return false;
  const trimmed = clientIp.trim();
  if (trimmed.includes(':') && !trimmed.includes('.')) {
    return isLoopbackHost(trimmed.replace(/^\[/, '').replace(/\]$/, ''));
  }
  return isLoopbackHost(trimmed.split(':')[0]);
}

/** Browser Origin header points at the local gateway console. */
export function isLoopbackBrowserOrigin(origin: string | undefined): boolean {
  const trimmed = origin?.trim();
  if (!trimmed || trimmed === 'null') return false;
  try {
    return isLoopbackHost(new URL(trimmed).hostname);
  } catch {
    return false;
  }
}

/** Same-machine browser hitting the local gateway (Electron / local dev). */
export function isLoopbackEmbeddedBrowserClient(
  origin: string | undefined,
  clientIp: string,
): boolean {
  if (!isLoopbackBrowserOrigin(origin)) return false;
  if (clientIp === 'unknown') return true;
  return isLoopbackClientIp(clientIp);
}

/** Read X-Forwarded-For / X-Real-IP / CF-Connecting-IP. */
export function getClientIpFromHeaders(headers: {
  get(name: string): string | undefined;
}): string {
  const xff = headers.get('x-forwarded-for');
  if (xff) {
    const first = xff.split(',')[0]?.trim();
    if (first) return first;
  }
  const real = headers.get('x-real-ip')?.trim();
  if (real) return real;
  const cf = headers.get('cf-connecting-ip')?.trim();
  if (cf) return cf;
  return 'unknown';
}
