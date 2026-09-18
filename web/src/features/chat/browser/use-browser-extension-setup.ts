import { useCallback, useEffect, useState } from 'react';
import useSWR from 'swr';

import {
  fetchBrowserStatus,
  installBrowserExtension,
  openBrowserExtension,
  type BrowserExtensionStatus,
} from '@/features/settings/browser/browser-control-api';
import { useGatewayStore } from '@/stores/gateway-store';

const DISCONNECTED_REFRESH_INTERVAL_MS = 3_000;
const CONNECTED_REFRESH_INTERVAL_MS = 30_000;

export type BrowserExtensionSetupState = 'loading' | 'not_installed' | 'installed_not_connected' | 'connected';

function resolveSetupState(
  status: BrowserExtensionStatus | undefined,
): BrowserExtensionSetupState {
  if (!status) return 'loading';
  if (status.setupState) return status.setupState;
  if (status.connected) return 'connected';
  if (!status.artifacts) return 'loading';
  return status.artifacts.installed === true ? 'installed_not_connected' : 'not_installed';
}

export function useBrowserExtensionSetup(enabled: boolean) {
  const baseUrl = useGatewayStore((state) => state.baseUrl);
  const conversationId = useGatewayStore((state) => state.conversationId);
  const status = useSWR(
    enabled ? ['chat-browser-extension-status', baseUrl, conversationId ?? 'anonymous'] : null,
    fetchBrowserStatus,
    {
      revalidateOnFocus: true,
      refreshInterval: (latest) => latest?.payload.driverKind === 'extension'
        && latest.payload.state === 'ready'
        ? CONNECTED_REFRESH_INTERVAL_MS
        : DISCONNECTED_REFRESH_INTERVAL_MS,
    },
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const payload = status.data?.payload;
  const extensionStatus = payload?.driverKind === 'extension'
    ? payload.driverStatus as BrowserExtensionStatus | undefined
    : undefined;
  const setupState = resolveSetupState(extensionStatus);
  const installed = setupState === 'installed_not_connected' || setupState === 'connected';

  useEffect(() => {
    if (!enabled) return undefined;
    const revalidate = () => void status.mutate();
    window.addEventListener('gateway-realtime-connected', revalidate);
    window.addEventListener('realtime-gap', revalidate);
    window.addEventListener('gateway-authenticated', revalidate);
    return () => {
      window.removeEventListener('gateway-realtime-connected', revalidate);
      window.removeEventListener('realtime-gap', revalidate);
      window.removeEventListener('gateway-authenticated', revalidate);
    };
  }, [enabled, status.mutate]);

  const prepareAndOpen = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      if (!installed) await installBrowserExtension(false);
      await openBrowserExtension('both');
      await status.mutate();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  }, [installed, status.mutate]);

  return {
    status: payload,
    setupState,
    installed,
    busy,
    error,
    prepareAndOpen,
  };
}
