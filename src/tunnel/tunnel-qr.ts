import { enumerateLanGatewayCandidates } from '../gateway/host.js';
import type { TunnelQrPayload } from './tunnel-types.js';

function trimBase(raw: string): string {
  return raw.trim().replace(/\/+$/, '');
}

/** First non-internal IPv4 suitable for LAN QR (when gateway listens on 0.0.0.0). */
export function resolveLanGatewayUrl(gatewayHost: string, gatewayPort: number): string | null {
  const host = gatewayHost.trim().toLowerCase();
  if (host === '127.0.0.1' || host === 'localhost' || host === '::1') {
    return null;
  }

  let ip: string | undefined;
  if (host === '0.0.0.0' || host === '::' || host === '') {
    ip = enumerateLanGatewayCandidates(gatewayPort)[0]?.address;
  } else if (!host.includes(':')) {
    ip = host;
  }

  if (!ip) return null;
  return trimBase(`http://${ip}:${gatewayPort}`);
}

export function buildMobileConnectQrPayload(input: {
  publicUrl: string;
  lanUrl: string | null;
  pairingSecret: string;
  expiresAt?: string;
}): TunnelQrPayload {
  const params = new URLSearchParams();
  params.set('baseUrl', input.publicUrl);
  if (input.lanUrl) params.set('lanUrl', input.lanUrl);
  if (input.pairingSecret) params.set('ps', input.pairingSecret);
  const qrPayload = `xopc://gateway/mobile-connect?${params.toString()}`;
  return {
    qrPayload,
    publicUrl: input.publicUrl,
    lanUrl: input.lanUrl,
    expiresAt: input.expiresAt,
  };
}
