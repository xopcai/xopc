import type { GatewayTrustedProxyConfig } from '../config/schema.js';
import { isLoopbackIpAddress, isTrustedProxyAddress } from './client-ip.js';

function normalizeHeaderName(name: string): string {
  return name.trim().toLowerCase();
}

export type TrustedProxyAuthResult =
  | { ok: true; user: string }
  | { ok: false; reason: string };

/**
 * Validate that a request came from a trusted reverse proxy and extract user identity.
 */
export function authorizeTrustedProxy(params: {
  remoteAddress?: string;
  getHeader: (name: string) => string | undefined;
  trustedProxies?: string[];
  trustedProxyConfig: GatewayTrustedProxyConfig;
}): TrustedProxyAuthResult {
  const { remoteAddress, getHeader, trustedProxies, trustedProxyConfig } = params;

  if (!remoteAddress || !isTrustedProxyAddress(remoteAddress, trustedProxies)) {
    return { ok: false, reason: 'trusted_proxy_untrusted_source' };
  }
  if (isLoopbackIpAddress(remoteAddress) && trustedProxyConfig.allowLoopback !== true) {
    return { ok: false, reason: 'trusted_proxy_loopback_source' };
  }

  const requiredHeaders = trustedProxyConfig.requiredHeaders ?? [];
  for (const header of requiredHeaders) {
    const value = getHeader(normalizeHeaderName(header));
    if (!value || value.trim() === '') {
      return { ok: false, reason: `trusted_proxy_missing_header_${header}` };
    }
  }

  const userHeaderValue = getHeader(normalizeHeaderName(trustedProxyConfig.userHeader));
  if (!userHeaderValue || userHeaderValue.trim() === '') {
    return { ok: false, reason: 'trusted_proxy_user_missing' };
  }

  const user = userHeaderValue.trim();
  const allowUsers = trustedProxyConfig.allowUsers ?? [];
  if (allowUsers.length > 0 && !allowUsers.includes(user)) {
    return { ok: false, reason: 'trusted_proxy_user_not_allowed' };
  }

  return { ok: true, user };
}
