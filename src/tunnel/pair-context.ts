import type { Config } from '../config/schema.js';
import type { GatewayBindMode } from '../config/schema.js';
import {
  isNetworkAccessibleBindHost,
  resolveGatewayBindMode,
  resolveGatewayEffectiveHost,
} from '../config/gateway-bind.js';
import { normalizePublicUrlOrNull } from '../config/public-url.js';
import { enumerateLanGatewayCandidates } from '../gateway/host.js';
import { buildMobileConnectUrlOrder } from './pair-url.js';

export type MobilePairCandidateKind = 'lan' | 'tunnel' | 'reverse-proxy';

export type MobilePairBlockReason = 'GATEWAY_LOOPBACK_ONLY' | 'NO_REACHABLE_URL';

export type MobilePairCandidate = {
  kind: MobilePairCandidateKind;
  url: string;
  label?: string;
  reachable: boolean;
  note?: string;
};

export type MobilePairContext = {
  port: number;
  bindMode: GatewayBindMode;
  listenHost: string;
  pairingReady: boolean;
  blockReason?: MobilePairBlockReason;
  candidates: MobilePairCandidate[];
  recommended: {
    mode: MobilePairCandidateKind | null;
    url: string | null;
  };
  /** Ordered URLs for mobile clients (LAN first when available, then tunnel). */
  connectUrls: string[];
};

export function buildMobilePairContext(params: {
  config: Config;
  tunnelPublicUrl?: string | null;
  tunnelConnected?: boolean;
  /**
   * Optional override for `gateway.publicUrl`. Falls back to the configured
   * value when omitted; useful for transient candidates (e.g. UI auto-detect
   * from `window.location.origin` before the user persists the value).
   */
  reverseProxyPublicUrl?: string | null;
}): MobilePairContext {
  const port = params.config.gateway?.port ?? 18790;
  const bindMode = resolveGatewayBindMode(params.config);
  const listenHost = resolveGatewayEffectiveHost(params.config);
  const lanListenReady = isNetworkAccessibleBindHost(listenHost);

  const lanEnumerated = enumerateLanGatewayCandidates(port);
  const candidates: MobilePairCandidate[] = lanEnumerated.map((entry) => ({
    kind: 'lan',
    url: entry.url,
    label: entry.interfaceName,
    reachable: lanListenReady,
    ...(lanListenReady ? {} : { note: 'requires_lan_bind' }),
  }));

  const tunnelUrl = params.tunnelPublicUrl?.trim() || null;
  const tunnelConnected = params.tunnelConnected === true && Boolean(tunnelUrl);
  if (tunnelConnected && tunnelUrl) {
    candidates.unshift({
      kind: 'tunnel',
      url: tunnelUrl,
      reachable: true,
    });
  }

  const configuredReverseProxy = normalizePublicUrlOrNull(params.config.gateway?.publicUrl);
  const reverseProxyUrl =
    params.reverseProxyPublicUrl !== undefined
      ? normalizePublicUrlOrNull(params.reverseProxyPublicUrl)
      : configuredReverseProxy;
  if (reverseProxyUrl) {
    candidates.unshift({
      kind: 'reverse-proxy',
      url: reverseProxyUrl,
      reachable: true,
    });
  }

  let recommended: MobilePairContext['recommended'] = { mode: null, url: null };
  if (reverseProxyUrl) {
    recommended = { mode: 'reverse-proxy', url: reverseProxyUrl };
  } else if (tunnelConnected && tunnelUrl) {
    recommended = { mode: 'tunnel', url: tunnelUrl };
  } else if (lanListenReady && lanEnumerated[0]) {
    recommended = { mode: 'lan', url: lanEnumerated[0].url };
  } else if (lanEnumerated[0]) {
    recommended = { mode: 'lan', url: lanEnumerated[0].url };
  }

  const pairingReady = Boolean(
    reverseProxyUrl || tunnelConnected || (lanListenReady && lanEnumerated.length > 0),
  );

  let blockReason: MobilePairBlockReason | undefined;
  if (!pairingReady) {
    blockReason =
      !lanListenReady && !tunnelConnected ? 'GATEWAY_LOOPBACK_ONLY' : 'NO_REACHABLE_URL';
  }

  const lanUrlForConnect =
    lanListenReady && lanEnumerated[0] ? lanEnumerated[0].url : null;
  // When reverse-proxy or tunnel is active, LAN is the secondary candidate.
  // When only LAN is available, lanUrl IS the baseUrl (don't duplicate it).
  const hasUpstream = Boolean(reverseProxyUrl) || tunnelConnected;
  const baseUrlForConnect = reverseProxyUrl
    ? reverseProxyUrl
    : tunnelConnected && tunnelUrl
      ? tunnelUrl
      : lanListenReady && recommended.url
        ? recommended.url
        : null;
  const connectUrls = buildMobileConnectUrlOrder({
    reverseProxyUrl,
    baseUrl: baseUrlForConnect,
    lanUrl: hasUpstream ? lanUrlForConnect : null,
    tunnelUrl: tunnelConnected ? tunnelUrl : null,
  });

  return {
    port,
    bindMode,
    listenHost,
    pairingReady,
    ...(blockReason ? { blockReason } : {}),
    candidates,
    recommended,
    connectUrls,
  };
}
