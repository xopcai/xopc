import type { GatewayProfile } from '../../stores/gateway-types';
import { gatewayProfileHost } from '../../stores/gateway-types';

export type ActiveGatewayDisplay = {
  name: string;
  subtitle: string;
  configured: boolean;
  profileId: string | null;
};

export function resolveActiveGatewayDisplay(
  profile: GatewayProfile | null,
  notConfiguredLabel: string,
): ActiveGatewayDisplay {
  if (!profile) return { name: '', subtitle: notConfiguredLabel, configured: false, profileId: null };
  const host = gatewayProfileHost(profile);
  return {
    name: profile.name,
    subtitle: host ? `${profile.name} · ${host}` : profile.name,
    configured: true,
    profileId: profile.gatewayId,
  };
}
