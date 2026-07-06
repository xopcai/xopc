import { useEffect, useRef, useState } from 'react';

import { useGatewayConfigured } from '../../query/sessions';
import { syncGatewayAfterConnectivityChange } from './gateway-connection-sync';
import { getGatewayHealthMonitor } from './gateway-health-monitor';

export function useGatewayHealth(): { gatewayOnline: boolean } {
  const configured = useGatewayConfigured();
  const [gatewayOnline, setGatewayOnline] = useState(true);
  const wasOfflineRef = useRef(false);

  useEffect(() => {
    if (!configured) {
      setGatewayOnline(true);
      wasOfflineRef.current = false;
      return;
    }
    const monitor = getGatewayHealthMonitor();
    return monitor.subscribe((online) => {
      if (!online) {
        wasOfflineRef.current = true;
        setGatewayOnline(false);
        return;
      }
      setGatewayOnline(true);
      if (wasOfflineRef.current) {
        wasOfflineRef.current = false;
        syncGatewayAfterConnectivityChange({ invalidateQueries: true, reconnectSse: true });
      }
    });
  }, [configured]);

  return { gatewayOnline };
}
