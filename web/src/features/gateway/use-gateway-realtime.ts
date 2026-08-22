import { useEffect } from 'react';

import { reconnectGatewayRealtime, startGatewayRealtime } from '@/features/gateway/gateway-realtime';
import { useGatewayStore } from '@/stores/gateway-store';

export function useGatewayRealtime(): void {
  const token = useGatewayStore((state) => state.token);
  useEffect(() => {
    return startGatewayRealtime(token);
  }, [token]);
  useEffect(() => {
    const reconnect = () => reconnectGatewayRealtime();
    const reconnectWhenVisible = () => {
      if (document.visibilityState === 'visible') reconnectGatewayRealtime();
    };
    window.addEventListener('online', reconnect);
    document.addEventListener('visibilitychange', reconnectWhenVisible);
    return () => {
      window.removeEventListener('online', reconnect);
      document.removeEventListener('visibilitychange', reconnectWhenVisible);
    };
  }, []);
}
