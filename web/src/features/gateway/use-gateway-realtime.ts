import { useEffect } from 'react';

import { resumeGatewayRealtime, startGatewayRealtime } from '@/features/gateway/gateway-realtime';
import { useGatewayStore } from '@/stores/gateway-store';

export function useGatewayRealtime(): void {
  const token = useGatewayStore((state) => state.conversationId);
  useEffect(() => {
    return startGatewayRealtime();
  }, [token]);
  useEffect(() => {
    const resumeWhenVisible = () => {
      if (document.visibilityState === 'visible') resumeGatewayRealtime();
    };
    window.addEventListener('online', resumeGatewayRealtime);
    document.addEventListener('visibilitychange', resumeWhenVisible);
    return () => {
      window.removeEventListener('online', resumeGatewayRealtime);
      document.removeEventListener('visibilitychange', resumeWhenVisible);
    };
  }, []);
}
