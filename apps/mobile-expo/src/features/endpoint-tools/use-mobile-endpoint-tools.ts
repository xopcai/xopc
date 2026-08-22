import { useEffect } from 'react';

import { useGatewayStore } from '@/stores/gateway-store';

export function useMobileEndpointTools(ready: boolean): void {
  const activeGatewayId = useGatewayStore((state) => state.activeGatewayId);
  const activeBaseUrl = useGatewayStore((state) => state.activeBaseUrl);
  const token = useGatewayStore((state) => state.token);

  useEffect(() => {
    if (!ready || !activeGatewayId || !activeBaseUrl || !token) return;
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
  }, [activeBaseUrl, activeGatewayId, ready, token]);
}
