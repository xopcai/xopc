import { useEffect } from 'react';

import { subscribeNetworkChange } from './network-info';
import { syncGatewayAfterConnectivityChange } from './gateway-connection-sync';
import { getSharedGatewayRealtimeClient } from './use-gateway-realtime';

export function useGatewayConnectionWatch(enabled: boolean): void {
  useEffect(() => {
    if (!enabled) return;
    let previousKey = '';
    return subscribeNetworkChange((snapshot) => {
      if (!previousKey) {
        previousKey = snapshot.key;
        return;
      }
      if (previousKey === snapshot.key) return;
      previousKey = snapshot.key;
      if (!snapshot.online) {
        getSharedGatewayRealtimeClient()?.disconnect();
        return;
      }
      syncGatewayAfterConnectivityChange({ immediate: true });
    });
  }, [enabled]);
}

/** @internal */
export function resetGatewayConnectionWatchStateForTests(): void {}
