import { useEffect } from 'react';

import { useGatewayStore } from '@/stores/gateway-store';

export function useMobileEndpointTools(ready: boolean): void {
  const activeGatewayId = useGatewayStore((state) => state.activeGatewayId);
  const activeRouteUrl = useGatewayStore((state) => state.getActiveRouteUrl());
  const accessToken = useGatewayStore((state) => state.accessToken);

  useEffect(() => {
    if (!ready || !activeGatewayId || !activeRouteUrl || !accessToken) return;
    let active = true;
    let stop: (() => void) | undefined;
    void import('./host')
      .then(({ MobileEndpointToolHost }) => {
        if (!active) return;
        const host = new MobileEndpointToolHost();
        stop = () => host.stop();
        void host.start();
      })
      .catch(() => undefined);
    return () => {
      active = false;
      stop?.();
    };
  }, [accessToken, activeGatewayId, activeRouteUrl, ready]);
}
