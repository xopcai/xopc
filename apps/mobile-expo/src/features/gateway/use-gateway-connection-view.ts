import { useMemo } from 'react';

import type { MessageBundle } from '../../i18n/messages';
import { useGatewayStore } from '../../stores/gateway-store';
import {
  connectionKindLabel,
  deriveGatewayConnectionView,
  type GatewayConnectionView,
} from './gateway-connection-view';

export { connectionKindLabel };

export function useGatewayConnectionView(): GatewayConnectionView {
  const baseUrl = useGatewayStore((s) => s.baseUrl);
  const lanUrl = useGatewayStore((s) => s.lanUrl);
  const activeBaseUrl = useGatewayStore((s) => s.activeBaseUrl);

  return useMemo(
    () => deriveGatewayConnectionView({ baseUrl, lanUrl, activeBaseUrl }),
    [activeBaseUrl, baseUrl, lanUrl],
  );
}

export function useGatewayConnectionKindLabel(
  view: GatewayConnectionView,
  g: MessageBundle['gateway'],
): string {
  return useMemo(() => connectionKindLabel(view.connectionKind, g), [g, view.connectionKind]);
}
