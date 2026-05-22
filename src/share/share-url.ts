import { loadTunnelState } from '../tunnel/tunnel-state.js';

import type { ResolvedShareUrl, ShareReachability } from './share-types.js';

export interface ShareUrlContext {
  gatewayHost: string;
  gatewayPort: number;
}

export function resolveShareUrl(token: string, ctx: ShareUrlContext): ResolvedShareUrl {
  const tunnelState = loadTunnelState();
  const { gatewayHost, gatewayPort } = ctx;

  const path = `/s/${token}`;

  if (tunnelState?.publicUrl) {
    const base = tunnelState.publicUrl.replace(/\/+$/, '');
    const lanUrl = buildLanUrl(gatewayHost, gatewayPort, path);
    return {
      shareUrl: `${base}${path}`,
      lanUrl,
      reachability: 'public',
      reachabilityHint: null,
    };
  }

  if (gatewayHost !== '127.0.0.1' && gatewayHost !== 'localhost' && gatewayHost !== '::1') {
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
  if (host === '0.0.0.0' || host === '::') {
    return `http://127.0.0.1:${port}${path}`;
  }
  if (host === '127.0.0.1' || host === 'localhost' || host === '::1') {
    return null;
  }
  return `http://${host}:${port}${path}`;
}

export function resolveReachabilityForList(ctx: ShareUrlContext): ShareReachability {
  const tunnelState = loadTunnelState();
  if (tunnelState?.publicUrl) return 'public';
  if (ctx.gatewayHost !== '127.0.0.1' && ctx.gatewayHost !== 'localhost' && ctx.gatewayHost !== '::1') {
    return 'lan';
  }
  return 'local-only';
}
