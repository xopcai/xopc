import { useEffect } from 'react';

import { useGatewayStore } from '@/stores/gateway-store';
import { MobileEndpointToolHost } from './host';

export function useMobileEndpointTools(): void {
  const activeGatewayId = useGatewayStore((state) => state.activeGatewayId);
  const activeBaseUrl = useGatewayStore((state) => state.activeBaseUrl);
  const token = useGatewayStore((state) => state.token);

  useEffect(() => {
    if (!activeGatewayId || !activeBaseUrl || !token) return;
    const host = new MobileEndpointToolHost();
    void host.start();
    return () => host.stop();
  }, [activeBaseUrl, activeGatewayId, token]);
}
