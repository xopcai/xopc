import type { Config } from '../config/schema.js';
import { readTailscaleWhoisIdentity } from '../infra/tailscale.js';
import { isLoopbackHost } from './host.js';

export type TailscaleAuthHeaders = {
  forwardedFor?: string;
  forwardedProto?: string;
  forwardedHost?: string;
  tailscaleUserLogin?: string;
};

export function parseTailscaleAuthHeaders(headers: Record<string, string | undefined>): TailscaleAuthHeaders {
  return {
    forwardedFor: headers['x-forwarded-for']?.split(',')[0]?.trim(),
    forwardedProto: headers['x-forwarded-proto']?.trim(),
    forwardedHost: headers['x-forwarded-host']?.trim(),
    tailscaleUserLogin: headers['tailscale-user-login']?.trim(),
  };
}

export function isTailscaleServeRequest(params: {
  remoteAddress?: string;
  headers: TailscaleAuthHeaders;
}): boolean {
  if (!params.remoteAddress || !isLoopbackHost(params.remoteAddress)) {
    return false;
  }
  const { forwardedFor, forwardedProto, forwardedHost, tailscaleUserLogin } = params.headers;
  return Boolean(forwardedFor && forwardedProto && forwardedHost && tailscaleUserLogin);
}

export function shouldAllowTailscaleIdentityAuth(cfg: Config): boolean {
  const mode = cfg.gateway?.tailscale?.mode ?? 'off';
  if (mode !== 'serve') {
    return false;
  }
  if (cfg.gateway?.auth?.allowTailscale === false) {
    return false;
  }
  if (cfg.gateway?.auth?.mode === 'password' || cfg.gateway?.auth?.mode === 'trusted-proxy') {
    return false;
  }
  return true;
}

export async function verifyTailscaleIdentity(params: {
  cfg: Config;
  remoteAddress?: string;
  headers: TailscaleAuthHeaders;
}): Promise<{ ok: true; login: string } | { ok: false }> {
  if (!shouldAllowTailscaleIdentityAuth(params.cfg)) {
    return { ok: false };
  }
  if (!isTailscaleServeRequest({ remoteAddress: params.remoteAddress, headers: params.headers })) {
    return { ok: false };
  }
  const login = params.headers.tailscaleUserLogin;
  const clientIp = params.headers.forwardedFor;
  if (!login || !clientIp) {
    return { ok: false };
  }
  const identity = await readTailscaleWhoisIdentity(clientIp);
  if (!identity || identity.login !== login) {
    return { ok: false };
  }
  return { ok: true, login: identity.login };
}

/** Static gateway console routes that may skip token when Tailscale identity is verified. */
export function isTailscaleUiBypassPath(path: string): boolean {
  if (path === '/' || path === '/index.html') {
    return true;
  }
  if (path.startsWith('/assets/')) {
    return true;
  }
  return false;
}
