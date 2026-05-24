import { networkInterfaces } from 'node:os';

import type { TunnelQrPayload } from './tunnel-types.js';

function trimBase(raw: string): string {
  return raw.trim().replace(/\/+$/, '');
}

export type LanGatewayCandidate = {
  url: string;
  address: string;
  interfaceName: string;
};

/** Non-internal IPv4 addresses on this machine (independent of gateway bind mode). */
export function enumerateLanGatewayCandidates(port: number): LanGatewayCandidate[] {
  const nets = networkInterfaces();
  const seen = new Set<string>();
  const out: LanGatewayCandidate[] = [];

  for (const [interfaceName, addrs] of Object.entries(nets)) {
    for (const addr of addrs ?? []) {
      if (addr.family !== 'IPv4' || addr.internal) continue;
      if (seen.has(addr.address)) continue;
      seen.add(addr.address);
      out.push({
        address: addr.address,
        interfaceName,
        url: trimBase(`http://${addr.address}:${port}`),
      });
    }
  }

  return out;
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
