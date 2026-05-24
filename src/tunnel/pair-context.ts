import type { Config } from '../config/schema.js';
import type { GatewayBindMode } from '../config/schema.js';
import {
  isNetworkAccessibleBindHost,
  resolveGatewayBindMode,
  resolveGatewayEffectiveHost,
} from '../config/gateway-bind.js';
import { enumerateLanGatewayCandidates } from './tunnel-qr.js';
import { buildMobileConnectUrlOrder } from './pair-url.js';

export type MobilePairCandidateKind = 'lan' | 'tunnel';

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

  const publicUrl = params.tunnelPublicUrl?.trim() || null;
  const tunnelConnected = params.tunnelConnected === true && Boolean(publicUrl);
  if (tunnelConnected && publicUrl) {
    candidates.unshift({
      kind: 'tunnel',
      url: publicUrl,
      reachable: true,
    });
  }

  let recommended: MobilePairContext['recommended'] = { mode: null, url: null };
  if (tunnelConnected && publicUrl) {
    recommended = { mode: 'tunnel', url: publicUrl };
  } else if (lanListenReady && lanEnumerated[0]) {
    recommended = { mode: 'lan', url: lanEnumerated[0].url };
  } else if (lanEnumerated[0]) {
    recommended = { mode: 'lan', url: lanEnumerated[0].url };
  }

  const pairingReady = Boolean(
    tunnelConnected || (lanListenReady && lanEnumerated.length > 0),
  );

  let blockReason: MobilePairBlockReason | undefined;
  if (!pairingReady) {
    blockReason =
      !lanListenReady && !tunnelConnected ? 'GATEWAY_LOOPBACK_ONLY' : 'NO_REACHABLE_URL';
  }

  const lanUrlForConnect =
    lanListenReady && lanEnumerated[0] ? lanEnumerated[0].url : null;
  const baseUrlForConnect = tunnelConnected && publicUrl
    ? publicUrl
    : lanListenReady && recommended.url
      ? recommended.url
      : null;
  const connectUrls = buildMobileConnectUrlOrder({
    baseUrl: baseUrlForConnect,
    lanUrl: tunnelConnected ? lanUrlForConnect : null,
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
