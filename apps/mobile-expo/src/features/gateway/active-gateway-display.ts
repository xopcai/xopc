import type { MessageBundle } from '../../i18n/messages';
import { gatewayProfileNameFromUrl, type GatewayProfile } from '../../stores/gateway-types';

import {
  connectionKindLabel,
  type GatewayConnectionView,
} from './gateway-connection-view';

export type ActiveGatewayDisplay = {
  name: string;
  /** Header subtitle: gateway name/host plus LAN vs FRP indicator. */
  subtitle: string;
  configured: boolean;
  profileId: string | null;
};

export function buildChatHeaderGatewaySubtitle(
  profile: GatewayProfile | null,
  connectionView: GatewayConnectionView,
  configured: boolean,
  g: MessageBundle['gateway'],
  notConfiguredLabel: string,
): string {
  if (!configured) return notConfiguredLabel;

  const name =
    profile?.name?.trim() ||
    (profile?.baseUrl ? gatewayProfileNameFromUrl(profile.baseUrl) : '');

  if (connectionView.connectionKind === 'unconfigured') {
    return name || notConfiguredLabel;
  }

  const kind = connectionKindLabel(connectionView.connectionKind, g);
  if (name) return `${name} · ${kind}`;

  const host = connectionView.activeHost || connectionView.tunnelHost;
  return host ? `${host} · ${kind}` : kind;
}

export function resolveActiveGatewayDisplay(
  profile: GatewayProfile | null,
  baseUrl: string,
  connectionView: GatewayConnectionView,
  g: MessageBundle['gateway'],
  notConfiguredLabel: string,
): ActiveGatewayDisplay {
  const configured = Boolean(baseUrl.trim());
  const name =
    profile?.name?.trim() ||
    (profile?.baseUrl ? gatewayProfileNameFromUrl(profile.baseUrl) : '');
  const subtitle = buildChatHeaderGatewaySubtitle(
    profile,
    connectionView,
    configured,
    g,
    notConfiguredLabel,
  );
  return { name, subtitle, configured, profileId: profile?.id ?? null };
}
