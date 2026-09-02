import { useMemo } from 'react';

import { useMessages } from '../../i18n/messages';
import { useGatewayStore } from '../../stores/gateway-store';
import { resolveActiveGatewayDisplay, type ActiveGatewayDisplay } from './active-gateway-display';

export type { ActiveGatewayDisplay };
export { resolveActiveGatewayDisplay } from './active-gateway-display';

export function useActiveGatewayDisplay(): ActiveGatewayDisplay {
  const profile = useGatewayStore((state) => state.getActiveProfile());
  const notConfigured = useMessages().sessions.gatewayNotConfigured;
  return useMemo(() => resolveActiveGatewayDisplay(profile, notConfigured), [notConfigured, profile]);
}
