import type { MessageBundle } from '../../i18n/messages';
import type { GatewayProfile } from '../../stores/gateway-types';

import {
  connectionKindLabel,
  formatGatewayHost,
  type GatewayConnectionView,
} from './gateway-connection-view';

export function buildGatewaySwitcherSubtitle(input: {
  profile: GatewayProfile;
  isActive: boolean;
  gatewayOnline: boolean;
  hasLastAvailableRoute: boolean;
  connectionView: GatewayConnectionView;
  messages: MessageBundle;
}): string {
  if (!input.isActive) {
    const host = formatGatewayHost(input.profile.baseUrl);
    return input.hasLastAvailableRoute
      ? `${host} · ${input.messages.gateway.switcher.lastAvailable}`
      : host;
  }

  const status = input.gatewayOnline
    ? input.messages.gateway.switcher.online
    : input.messages.gateway.switcher.offline;
  const route = connectionKindLabel(input.connectionView.connectionKind, input.messages.gateway);
  return `${status} · ${route}`;
}
