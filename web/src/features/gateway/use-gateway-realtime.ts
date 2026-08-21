import { useEffect } from 'react';

import { startGatewayRealtime } from '@/features/gateway/gateway-realtime';
import { useGatewayStore } from '@/stores/gateway-store';

export function useGatewayRealtime(): void {
  const token = useGatewayStore((state) => state.token);
  useEffect(() => {
    return startGatewayRealtime(token);
  }, [token]);
}
