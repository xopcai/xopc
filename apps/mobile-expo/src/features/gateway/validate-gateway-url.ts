import {
  fetchMobilePairPing,
  validateMobilePairBaseUrlPublic,
} from '../../api/mobile-pair';
import { normalizeGatewayBaseUrl, shouldRejectLoopbackGatewayBaseUrl } from '../../stores/gateway-types';

export type GatewayUrlValidationCode =
  | 'INVALID_URL'
  | 'LOOPBACK_NOT_REACHABLE'
  | 'UNREACHABLE'
  | 'NOT_XOPC_GATEWAY';

export type GatewayUrlValidationResult =
  | { ok: true; url: string; connectUrls?: string[] }
  | { ok: false; code: GatewayUrlValidationCode; message: string };

const PROBE_TIMEOUT_MS = 8_000;

function invalidUrlMessage(): string {
  return 'Enter a valid http(s) gateway URL without a path.';
}

function loopbackMessage(): string {
  return '127.0.0.1 and localhost only work on the gateway computer. Use a LAN IP or tunnel URL instead.';
}

function unreachableMessage(): string {
  return 'Could not reach the gateway at this address. Check Wi‑Fi, firewall, and that the gateway is running.';
}

function notGatewayMessage(): string {
  return 'This address did not respond as an xopc gateway.';
}

/** Client-side loopback guard (fast path before network). */
export function assertNotLoopbackGatewayUrl(rawUrl: string): GatewayUrlValidationResult | null {
  const url = normalizeGatewayBaseUrl(rawUrl);
  if (!url) {
    return { ok: false, code: 'INVALID_URL', message: invalidUrlMessage() };
  }
  if (shouldRejectLoopbackGatewayBaseUrl(url)) {
    return { ok: false, code: 'LOOPBACK_NOT_REACHABLE', message: loopbackMessage() };
  }
  return null;
}

/**
 * Validate a manually entered gateway URL: reject loopback, optionally confirm reachability
 * via public pair/ping (falls back to validate-url when ping is unavailable).
 */
export async function validateGatewayUrlForManualConnect(
  rawUrl: string,
  options: { requireReachable?: boolean } = {},
): Promise<GatewayUrlValidationResult> {
  const blocked = assertNotLoopbackGatewayUrl(rawUrl);
  if (blocked) return blocked;

  const url = normalizeGatewayBaseUrl(rawUrl);
  if (!url) {
    return { ok: false, code: 'INVALID_URL', message: invalidUrlMessage() };
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS);

  try {
    const ping = await fetchMobilePairPing(url, controller.signal);
    if (!ping.ok || ping.mobilePairing !== true) {
      return { ok: false, code: 'NOT_XOPC_GATEWAY', message: notGatewayMessage() };
    }
    return { ok: true, url, connectUrls: ping.connectUrls };
  } catch {
    try {
      const validated = await validateMobilePairBaseUrlPublic(url, controller.signal);
      if (!validated.ok) {
        return {
          ok: false,
          code: validated.code === 'LOOPBACK_NOT_REACHABLE' ? 'LOOPBACK_NOT_REACHABLE' : 'INVALID_URL',
          message: validated.message,
        };
      }
      if (options.requireReachable) {
        return { ok: false, code: 'UNREACHABLE', message: unreachableMessage() };
      }
      return { ok: true, url: validated.url };
    } catch {
      if (options.requireReachable) {
        return { ok: false, code: 'UNREACHABLE', message: unreachableMessage() };
      }
      return { ok: true, url };
    }
  } finally {
    clearTimeout(timeout);
  }
}
