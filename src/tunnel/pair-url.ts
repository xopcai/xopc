import net from 'node:net';

import { isNetworkAccessibleBindHost, resolveGatewayEffectiveHost } from '../config/gateway-bind.js';
import type { Config } from '../config/schema.js';
import { enumerateLanGatewayCandidates } from './tunnel-qr.js';

export type MobilePairUrlValidationCode = 'INVALID_URL' | 'LOOPBACK_NOT_REACHABLE';

export type MobilePairUrlValidationResult =
  | { ok: true; url: string; loopback: false }
  | { ok: false; code: MobilePairUrlValidationCode; message: string };

/** Normalize a gateway root URL (no trailing slash, no path). */
export function normalizeGatewayBaseUrl(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  try {
    const u = new URL(trimmed);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') {
      return null;
    }
    if (u.username || u.password) return null;
    if (u.pathname && u.pathname !== '/') return null;
    if (u.search || u.hash) return null;
    const portSuffix = u.port ? `:${u.port}` : '';
    return `${u.protocol}//${u.hostname}${portSuffix}`;
  } catch {
    return null;
  }
}

/** True when a phone on the network cannot reach this gateway root URL. */
export function isLoopbackGatewayBaseUrl(raw: string): boolean {
  const normalized = normalizeGatewayBaseUrl(raw);
  if (!normalized) return false;
  try {
    const u = new URL(normalized);
    const host = u.hostname.trim().toLowerCase();
    if (host === 'localhost' || host === '127.0.0.1' || host === '::1' || host === '[::1]') {
      return true;
    }
    const ipVersion = net.isIP(host);
    if (ipVersion === 4) {
      const parts = host.split('.').map((p) => Number(p));
      if (parts.length === 4 && parts.every((n) => Number.isInteger(n)) && parts[0] === 127) {
        return true;
      }
    }
    return false;
  } catch {
    return false;
  }
}

export function validateMobilePairBaseUrl(raw: string): MobilePairUrlValidationResult {
  const url = normalizeGatewayBaseUrl(raw);
  if (!url) {
    return {
      ok: false,
      code: 'INVALID_URL',
      message: 'Enter an absolute gateway URL starting with http:// or https:// (no path).',
    };
  }
  if (isLoopbackGatewayBaseUrl(url)) {
    return {
      ok: false,
      code: 'LOOPBACK_NOT_REACHABLE',
      message:
        '127.0.0.1 and localhost only work on the gateway machine. Use a LAN IP or tunnel URL instead.',
    };
  }
  return { ok: true, url, loopback: false };
}

export type ParsedMobileConnectDeepLink = {
  baseUrl: string;
  lanUrl: string | null;
  pairingSecret: string;
};

/** Parse `xopc://gateway/mobile-connect?...` payloads from QR codes. */
export function parseMobileConnectDeepLink(raw: string): ParsedMobileConnectDeepLink | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  try {
    const u = new URL(trimmed);
    if (u.protocol !== 'xopc:' || u.hostname !== 'gateway' || u.pathname !== '/mobile-connect') {
      return null;
    }
    const baseUrl = u.searchParams.get('baseUrl')?.trim() ?? '';
    const psRaw = u.searchParams.get('ps')?.trim() ?? '';
    let pairingSecret = psRaw;
    if (psRaw) {
      try {
        pairingSecret = decodeURIComponent(psRaw);
      } catch {
        pairingSecret = psRaw;
      }
    }
    if (!baseUrl || !pairingSecret) return null;
    const lanRaw = u.searchParams.get('lanUrl')?.trim() ?? '';
    const lanUrl = lanRaw ? normalizeGatewayBaseUrl(lanRaw) : null;
    const normalizedBase = normalizeGatewayBaseUrl(baseUrl);
    if (!normalizedBase) return null;
    return {
      baseUrl: normalizedBase,
      lanUrl,
      pairingSecret,
    };
  } catch {
    return null;
  }
}

/** Ordered URLs for mobile clients: prefer LAN on the same network, then tunnel/base. */
export function buildMobileConnectUrlOrder(params: {
  baseUrl: string | null | undefined;
  lanUrl: string | null | undefined;
}): string[] {
  const ordered: string[] = [];
  const seen = new Set<string>();

  const push = (raw: string | null | undefined) => {
    const url = raw ? normalizeGatewayBaseUrl(raw) : null;
    if (!url || isLoopbackGatewayBaseUrl(url) || seen.has(url)) return;
    seen.add(url);
    ordered.push(url);
  };

  push(params.lanUrl);
  push(params.baseUrl);
  return ordered;
}

/** First LAN URL when the gateway listens on a network-accessible bind host. */
export function resolveMobilePairLanUrl(config: Config): string | null {
  const listenHost = resolveGatewayEffectiveHost(config);
  if (!isNetworkAccessibleBindHost(listenHost)) return null;
  const port = config.gateway?.port ?? 18790;
  return enumerateLanGatewayCandidates(port)[0]?.url ?? null;
}
