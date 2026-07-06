import type { TunnelQrResponse } from '../../api/tunnel';
import { normalizeGatewayBaseUrl } from './gateway-connection-view';

export function shouldUpdateBaseUrlFromPublicUrl(
  currentBaseUrl: string,
  publicUrl: string | null,
): boolean {
  if (!publicUrl?.trim()) return false;
  const cur = normalizeGatewayBaseUrl(currentBaseUrl);
  const pub = normalizeGatewayBaseUrl(publicUrl);
  if (!cur) return true;
  if (cur === pub) return true;
  try {
    return new URL(cur).hostname === new URL(pub).hostname;
  } catch {
    return false;
  }
}

export type ApplyTunnelQrPatch = {
  lanUrl: string | null;
  baseUrl?: string;
};

export function buildTunnelQrPatch(
  qr: TunnelQrResponse,
  currentBaseUrl: string,
): ApplyTunnelQrPatch {
  const patch: ApplyTunnelQrPatch = {
    lanUrl: qr.lanUrl ? normalizeGatewayBaseUrl(qr.lanUrl) : null,
  };
  if (qr.publicUrl && shouldUpdateBaseUrlFromPublicUrl(currentBaseUrl, qr.publicUrl)) {
    patch.baseUrl = normalizeGatewayBaseUrl(qr.publicUrl);
  }
  return patch;
}
