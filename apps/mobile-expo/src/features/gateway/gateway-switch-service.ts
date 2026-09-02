import { apiFetch } from '../../api/client';
import { GatewayConnectivityError } from '../../api/gateway-error';
import { useGatewayStore } from '../../stores/gateway-store';
import { syncGatewayAfterConnectivityChange } from './gateway-connection-sync';

export type GatewaySwitchResult =
  | { status: 'switched' | 'already-active'; profileId: string }
  | { status: 'failed'; profileId: string; error: GatewayConnectivityError }
  | { status: 'superseded'; profileId: string };

let latestAttempt = 0;

export async function switchGatewayProfile(profileId: string): Promise<GatewaySwitchResult> {
  const before = useGatewayStore.getState().activeGatewayId;
  if (before === profileId) return { status: 'already-active', profileId };
  if (!useGatewayStore.getState().profiles.some((profile) => profile.gatewayId === profileId)) {
    return { status: 'failed', profileId, error: new GatewayConnectivityError('misconfigured', 'Gateway profile does not exist') };
  }
  const attempt = ++latestAttempt;
  useGatewayStore.getState().activateProfile(profileId);
  try {
    const response = await apiFetch('/api/status');
    if (attempt !== latestAttempt) return { status: 'superseded', profileId };
    if (!response.ok) throw new Error(`Gateway returned ${response.status}`);
    syncGatewayAfterConnectivityChange({ immediate: true, resetQueries: true });
    return { status: 'switched', profileId };
  } catch (cause) {
    if (attempt !== latestAttempt) return { status: 'superseded', profileId };
    if (before) useGatewayStore.getState().activateProfile(before);
    return {
      status: 'failed',
      profileId,
      error: cause instanceof GatewayConnectivityError
        ? cause
        : new GatewayConnectivityError('unknown', 'Gateway verification failed', { cause }),
    };
  }
}

export function cancelGatewaySwitch(): void {
  latestAttempt++;
}

/** @internal */
export function resetGatewaySwitchServiceForTests(): void {
  latestAttempt = 0;
}
