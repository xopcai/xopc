import { useMemo } from 'react';

import { useMessages } from '../../i18n/messages';
import { useGatewayStore } from '../../stores/gateway-store';

import {
  resolveActiveGatewayDisplay,
  type ActiveGatewayDisplay,
} from './active-gateway-display';
import { useGatewayConnectionView } from './use-gateway-connection-view';

export type { ActiveGatewayDisplay };
export {
  buildChatHeaderGatewaySubtitle,
  resolveActiveGatewayDisplay,
} from './active-gateway-display';

export function useActiveGatewayDisplay(): ActiveGatewayDisplay {
  const profile = useGatewayStore((s) => s.getActiveProfile());
  const baseUrl = useGatewayStore((s) => s.baseUrl);
  const connectionView = useGatewayConnectionView();
  const m = useMessages();

  return useMemo(
    () =>
      resolveActiveGatewayDisplay(
        profile,
        baseUrl,
        connectionView,
        m.gateway,
        m.sessions.gatewayNotConfigured,
      ),
    [profile, baseUrl, connectionView, m.gateway, m.sessions.gatewayNotConfigured],
  );
}
