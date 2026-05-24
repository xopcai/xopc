import { useCallback, useState } from 'react';
import { useSWRConfig } from 'swr';

import { revalidateGatewayConfig } from '@/features/gateway/gateway-config-swr';
import {
  restartGatewayAfterConfigChange,
  waitForGatewayApiReady,
  waitForPairingReadyAfterRestart,
} from '@/features/tunnel/gateway-restart';
import { enableLanMobilePairing, type MobilePairContextResponse } from '@/features/tunnel/tunnel-api';

export function useEnableLanPairing(
  gatewayToken: string,
  onSuccess?: (context: MobilePairContextResponse) => void,
) {
  const { mutate: globalMutate } = useSWRConfig();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);

  const refreshPairingState = useCallback(async () => {
    await Promise.all([
      globalMutate('tunnel-pair-context'),
      globalMutate('tunnel-pair'),
      globalMutate('tunnel-status'),
      revalidateGatewayConfig(),
    ]);
  }, [globalMutate]);

  const runEnableLanPairing = useCallback(async () => {
    if (!gatewayToken || busy) return;
    setBusy(true);
    setError(null);
    try {
      const result = await enableLanMobilePairing();
      if (!result.ok) {
        throw new Error('Failed to enable LAN pairing');
      }

      if (result.requiresRestart) {
        const restart = await restartGatewayAfterConfigChange();
        if (!restart.ok) {
          throw new Error(restart.message ?? 'Gateway restart failed');
        }
        const apiReady = await waitForGatewayApiReady(gatewayToken);
        if (!apiReady) {
          throw new Error('Gateway did not come back online in time');
        }
      }

      const context = result.requiresRestart
        ? await waitForPairingReadyAfterRestart()
        : result.context;
      if (!context?.pairingReady) {
        throw new Error('LAN pairing is still not ready after restart');
      }

      await refreshPairingState();
      onSuccess?.(context);
      setConfirmOpen(false);
      return context;
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Enable LAN pairing failed');
      return null;
    } finally {
      setBusy(false);
    }
  }, [busy, gatewayToken, onSuccess, refreshPairingState]);

  return {
    busy,
    error,
    confirmOpen,
    setConfirmOpen,
    runEnableLanPairing,
    clearError: () => setError(null),
  };
}
