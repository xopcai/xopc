import { GatewayConnectivityError } from '../../api/gateway-error';
import { useGatewayStore } from '../../stores/gateway-store';
import type { GatewayProfileInput } from '../../stores/gateway-types';

import { commitVerifiedGatewayProfile } from './gateway-switch-service';
import { preflightGatewayCredentials } from './preflight-credentials';

export type SaveGatewayProfileInput = GatewayProfileInput & {
  profileId?: string;
};

export type SaveGatewayProfileResult = {
  profileId: string;
  created: boolean;
};

/** Verify credentials first, then persist and activate the profile in one commit path. */
export async function saveGatewayProfile(
  input: SaveGatewayProfileInput,
): Promise<SaveGatewayProfileResult> {
  let preflight: Awaited<ReturnType<typeof preflightGatewayCredentials>>;
  try {
    preflight = await preflightGatewayCredentials({
      baseUrl: input.baseUrl,
      lanUrl: input.lanUrl ?? null,
      token: input.token ?? '',
    });
  } catch (cause) {
    throw new GatewayConnectivityError('unknown', 'Gateway verification failed', { cause });
  }
  if (!preflight.ok) throw preflight.error;

  const store = useGatewayStore.getState();
  const requested = input.profileId
    ? store.profiles.find((profile) => profile.id === input.profileId) ?? null
    : store.findProfileByBaseUrl(input.baseUrl);

  if (input.profileId && !requested) {
    throw new GatewayConnectivityError('misconfigured', 'Gateway profile does not exist');
  }

  const patch: GatewayProfileInput = {
    name: input.name,
    baseUrl: input.baseUrl,
    lanUrl: input.lanUrl,
    token: input.token,
  };
  const profileId = requested?.id ?? store.addProfile(patch);
  if (requested) store.updateProfile(requested.id, patch);

  const profile = useGatewayStore.getState().profiles.find((item) => item.id === profileId);
  if (!profile) {
    throw new GatewayConnectivityError('misconfigured', 'Gateway profile could not be saved');
  }

  commitVerifiedGatewayProfile(profile, preflight);
  return { profileId, created: !requested };
}
