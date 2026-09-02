import { decodeBase64UrlJson } from './device-crypto';
import { normalizeSecureGatewayUrl, type GatewayRoute } from '../../stores/gateway-types';

export type ParsedGatewayQr = {
  version: 2;
  pairingToken: string;
  gatewayId: string;
  gatewayName: string;
  gatewayPublicKey: string;
  routes: GatewayRoute[];
  expiresAt: number;
};

export function parseGatewayQrPayload(raw: string): ParsedGatewayQr | null {
  try {
    const url = new URL(raw.trim());
    if (url.protocol !== 'https:' || url.hostname !== 'link.xopc.ai' || url.pathname !== '/connect') return null;
    const encoded = url.hash.startsWith('#p=') ? url.hash.slice(3) : '';
    if (!encoded) return null;
    const value = decodeBase64UrlJson<Record<string, unknown>>(encoded);
    if (
      value.version !== 2 || typeof value.pairingToken !== 'string' || !value.pairingToken.startsWith('xopc_pair_') ||
      typeof value.gatewayId !== 'string' || !value.gatewayId || typeof value.gatewayName !== 'string' ||
      typeof value.gatewayPublicKey !== 'string' || !value.gatewayPublicKey ||
      !Array.isArray(value.routes) || value.routes.length === 0 ||
      typeof value.expiresAt !== 'number' || value.expiresAt <= Date.now()
    ) return null;
    const routes = value.routes.map((candidate) => {
      if (typeof candidate !== 'object' || candidate === null) throw new Error('Invalid route');
      const route = candidate as Record<string, unknown>;
      if (
        typeof route.id !== 'string' || typeof route.url !== 'string' ||
        !['xopc-secure-link', 'tailscale', 'custom-https'].includes(String(route.kind))
      ) throw new Error('Invalid route');
      return { id: route.id, kind: route.kind, url: normalizeSecureGatewayUrl(route.url) } as GatewayRoute;
    });
    return {
      version: 2,
      pairingToken: value.pairingToken,
      gatewayId: value.gatewayId,
      gatewayName: value.gatewayName,
      gatewayPublicKey: value.gatewayPublicKey,
      routes,
      expiresAt: value.expiresAt,
    };
  } catch {
    return null;
  }
}

export function hasPairableGatewayQr(parsed: ParsedGatewayQr | null): parsed is ParsedGatewayQr {
  return parsed !== null;
}
