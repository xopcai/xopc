import { loadTunnelState } from '../tunnel/tunnel-state.js';
import { enumerateLanGatewayCandidates } from '../gateway/host.js';

import type { ResolvedShareUrl, ShareReachability } from './share-types.js';

export interface ShareUrlContext {
  gatewayHost: string;
  gatewayPort: number;
  /**
   * User-configured reverse-proxy origin (`gateway.publicUrl`), already
   * normalized to `${protocol}//${host}` (no trailing slash).
   *
   * When present, the gateway is publicly reachable at this URL even if the
   * built-in FRP tunnel is not running — file shares can be served at
   * `<publicUrl>/s/<token>` and site shares at the subpath fallback
   * `<publicUrl>/site/<token>/`.
   */
  reverseProxyPublicUrl?: string | null;
}

export function resolveShareUrl(token: string, ctx: ShareUrlContext): ResolvedShareUrl {
  const tunnelState = loadTunnelState();
  const { gatewayHost, gatewayPort, reverseProxyPublicUrl } = ctx;

  const path = `/s/${token}`;

  if (tunnelState?.publicUrl) {
    const base = tunnelState.publicUrl.replace(/\/+$/, '');
    return {
      shareUrl: `${base}${path}`,
      lanUrl: buildLanUrl(gatewayHost, gatewayPort, path),
      reachability: 'public',
      reachabilityHint: null,
    };
  }

  const reverseProxy = reverseProxyPublicUrl?.trim();
  if (reverseProxy) {
    const base = reverseProxy.replace(/\/+$/, '');
    return {
      shareUrl: `${base}${path}`,
      lanUrl: buildLanUrl(gatewayHost, gatewayPort, path),
      reachability: 'public',
      reachabilityHint: null,
    };
  }

  if (!isLoopbackHost(gatewayHost)) {
    return {
      shareUrl: `http://${gatewayHost}:${gatewayPort}${path}`,
      lanUrl: null,
      reachability: 'lan',
      reachabilityHint: '当前局域网内可访问，开启远程隧道后对外网可达',
    };
  }

  return {
    shareUrl: `http://localhost:${gatewayPort}${path}`,
    lanUrl: null,
    reachability: 'local-only',
    reachabilityHint: '当前仅本机可访问，开启远程隧道后对外可达',
  };
}

function buildLanUrl(host: string, port: number, path: string): string | null {
  const lanBase = isLoopbackHost(host)
    ? null
    : enumerateLanGatewayCandidates(port).find((candidate) => candidate.address === host)?.url
      ?? `http://${host.includes(':') ? `[${host}]` : host}:${port}`;
  if (!lanBase) return null;
  return `${lanBase.replace(/\/+$/, '')}${path}`;
}

function isLoopbackHost(host: string): boolean {
  return host === '127.0.0.1' || host === 'localhost' || host === '::1';
}

export function resolveReachabilityForList(ctx: ShareUrlContext): ShareReachability {
  if (loadTunnelState()?.publicUrl) return 'public';
  if (ctx.reverseProxyPublicUrl?.trim()) return 'public';
  if (!isLoopbackHost(ctx.gatewayHost)) return 'lan';
  return 'local-only';
}

// ── Site shares ────────────────────────────────────────────────────────────

export interface SiteShareUrlContext extends ShareUrlContext {
  /** Token used as the `/site/:token/` subpath label. */
  token: string;
  /** Subdomain label used at `https://<label>.<publicHostSuffix>/` when an FRP tunnel is active. */
  subdomainLabel: string;
  /** From `siteShare.publicHostSuffix`. */
  publicHostSuffix: string;
}

export interface ResolvedSiteShareUrl {
  /** URL the recipient lands on. */
  shareUrl: string;
  /** URL for the auto-rendered site thumbnail. */
  thumbnailUrl: string;
  reachability: ShareReachability;
  reachabilityHint: string | null;
}

/**
 * Resolve the URL pair for a site share. Priority mirrors `resolveShareUrl`:
 *  1. FRP tunnel → wildcard subdomain on `<publicHostSuffix>`.
 *  2. Reverse-proxy `publicUrl` → `<publicUrl>/site/<token>/` subpath.
 *  3. Direct gateway bind → `http://<host>:<port>/site/<token>/`.
 */
export function resolveSiteShareUrl(ctx: SiteShareUrlContext): ResolvedSiteShareUrl {
  const tunnelState = loadTunnelState();
  if (tunnelState?.publicUrl) {
    const root = `https://${ctx.subdomainLabel}.${ctx.publicHostSuffix}`;
    return {
      shareUrl: `${root}/`,
      thumbnailUrl: `${root}/site/${ctx.token}/thumbnail`,
      reachability: 'public',
      reachabilityHint: null,
    };
  }

  const reverseProxy = ctx.reverseProxyPublicUrl?.trim();
  if (reverseProxy) {
    const base = reverseProxy.replace(/\/+$/, '');
    return {
      shareUrl: `${base}/site/${ctx.token}/`,
      thumbnailUrl: `${base}/site/${ctx.token}/thumbnail`,
      reachability: 'public',
      reachabilityHint: null,
    };
  }

  const base = `http://${ctx.gatewayHost}:${ctx.gatewayPort}`;
  const loopback = isLoopbackHost(ctx.gatewayHost);
  return {
    shareUrl: `${base}/site/${ctx.token}/`,
    thumbnailUrl: `${base}/site/${ctx.token}/thumbnail`,
    reachability: loopback ? 'local-only' : 'lan',
    reachabilityHint: loopback
      ? '当前仅本机可访问，开启远程隧道后对外可达'
      : '当前局域网内可访问，开启远程隧道后对外网可达',
  };
}
