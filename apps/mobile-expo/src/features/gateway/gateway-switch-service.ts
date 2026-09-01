import { GatewayConnectivityError } from '../../api/gateway-error';
import { useGatewayStore } from '../../stores/gateway-store';
import { normalizeGatewayBaseUrl, type GatewayProfile } from '../../stores/gateway-types';

import { syncGatewayAfterConnectivityChange } from './gateway-connection-sync';
import { writeLastGoodRoute } from './last-good-route';
import { getNetworkSnapshot } from './network-info';
import { preflightGatewayCredentials } from './preflight-credentials';
import { acceptVerifiedGatewayRoute } from './probe-coordinator';

export type GatewaySwitchResult =
  | { status: 'switched' | 'already-active'; profileId: string }
  | { status: 'failed'; profileId: string; error: GatewayConnectivityError }
  | { status: 'superseded'; profileId: string };

let latestSwitchAttempt = 0;

export type VerifiedGatewayRoute = {
  winner: 'lan' | 'tunnel';
  url: string;
  latencyMs?: number;
};

export function commitVerifiedGatewayProfile(
  profile: GatewayProfile,
  route: VerifiedGatewayRoute,
): void {
  const activeBaseUrl = normalizeGatewayBaseUrl(route.url);
  writeLastGoodRoute(profile.id, getNetworkSnapshot().key, {
    url: activeBaseUrl,
    kind: route.winner,
    latencyMs: route.latencyMs,
  });
  useGatewayStore.getState().activateProfile(profile.id);
  useGatewayStore.setState({ activeBaseUrl });
  acceptVerifiedGatewayRoute({
    profileId: profile.id,
    baseUrl: profile.baseUrl,
    lanUrl: profile.lanUrl,
    token: profile.token,
    winner: route.winner,
    url: activeBaseUrl,
    latencyMs: route.latencyMs,
  });
  syncGatewayAfterConnectivityChange({ immediate: true, resetQueries: true });
}

/**
 * Verify a profile without disturbing the current gateway, then commit once.
 * A newer selection always supersedes an older in-flight attempt.
 */
export async function switchGatewayProfile(profileId: string): Promise<GatewaySwitchResult> {
  const initial = useGatewayStore.getState();
  if (initial.activeGatewayId === profileId) {
    return { status: 'already-active', profileId };
  }

  const attempt = ++latestSwitchAttempt;
  const profile = initial.profiles.find((item) => item.id === profileId);
  if (!profile) {
    return {
      status: 'failed',
      profileId,
      error: new GatewayConnectivityError('misconfigured', 'Gateway profile does not exist'),
    };
  }

  let preflight: Awaited<ReturnType<typeof preflightGatewayCredentials>>;
  try {
    preflight = await preflightGatewayCredentials({
      baseUrl: profile.baseUrl,
      lanUrl: profile.lanUrl,
      token: profile.token,
    });
  } catch (cause) {
    preflight = {
      ok: false,
      error: new GatewayConnectivityError('unknown', 'Gateway verification failed', { cause }),
    };
  }

  const current = useGatewayStore.getState();
  const currentProfile = current.profiles.find((item) => item.id === profileId);
  if (
    attempt !== latestSwitchAttempt ||
    current.activeGatewayId !== initial.activeGatewayId ||
    currentProfile?.updatedAt !== profile.updatedAt
  ) {
    return { status: 'superseded', profileId };
  }
  if (!preflight.ok) return { status: 'failed', profileId, error: preflight.error };

  commitVerifiedGatewayProfile(profile, preflight);
  return { status: 'switched', profileId };
}

/** @internal */
export function resetGatewaySwitchServiceForTests(): void {
  latestSwitchAttempt = 0;
}

export function cancelGatewaySwitch(): void {
  latestSwitchAttempt++;
}
