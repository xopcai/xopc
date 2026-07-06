import type { MessageBundle } from '../../i18n/messages';
import type { GatewayProfile } from '../../stores/gateway-types';

import {
  connectionKindLabel,
  formatGatewayHost,
  type GatewayConnectionView,
} from './gateway-connection-view';

export function buildGatewayPickerRowSubtitle(
  profile: GatewayProfile,
  isActive: boolean,
  connectionView: GatewayConnectionView,
  gatewayOnline: boolean,
  g: MessageBundle['gateway'],
  chat: MessageBundle['chat'],
): string {
  const host = formatGatewayHost(profile.baseUrl);
  if (!isActive) return host;

  if (connectionView.connectionKind === 'unconfigured') {
    const status = gatewayOnline ? chat.gatewayStatusOnline : chat.gatewayStatusOffline;
    return `${host} · ${status}`;
  }

  const kind = connectionKindLabel(connectionView.connectionKind, g);
  const activeHost = connectionView.activeHost || host;
  const status = gatewayOnline ? chat.gatewayStatusOnline : chat.gatewayStatusOffline;
  return `${activeHost} · ${kind} · ${status}`;
}
