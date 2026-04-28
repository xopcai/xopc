import { useCallback, useEffect, useState } from 'react';

import { fetchConfiguredModelsCached } from '@/features/chat/registry-api';
import { fetchGatewayConfigSwrResponse } from '@/features/gateway/gateway-config-swr';
import { needsModelOrProviders } from '@/features/gateway/model-setup-state';

import { LOCAL_STORAGE_MODEL_SETUP_DISMISSED } from '@/features/onboarding/onboarding-constants';

type ConfigGet = {
  ok: true;
  payload: {
    config: {
      agents: { defaults: { model: string } };
      providers: Record<string, string>;
    };
  };
};

export function useNeedsModelSetup(enabled: boolean) {
  const [guideDismissed, setGuideDismissed] = useState(
    () =>
      typeof localStorage !== 'undefined' &&
      localStorage.getItem(LOCAL_STORAGE_MODEL_SETUP_DISMISSED) === '1',
  );
  const [needsSetup, setNeedsSetup] = useState(false);
  const [ready, setReady] = useState(false);

  const refresh = useCallback(async () => {
    if (!enabled) {
      setNeedsSetup(false);
      setReady(true);
      return;
    }
    try {
      const [j, models] = await Promise.all([
        fetchGatewayConfigSwrResponse() as Promise<ConfigGet>,
        fetchConfiguredModelsCached().catch(() => null),
      ]);
      const configNeeds = needsModelOrProviders(j.payload?.config);
      const noUsableModels = Array.isArray(models) && models.length === 0;
      setNeedsSetup(configNeeds || noUsableModels);
    } catch {
      setNeedsSetup(true);
    } finally {
      setReady(true);
    }
  }, [enabled]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    const onReload = () => void refresh();
    window.addEventListener('config-reload', onReload);
    return () => window.removeEventListener('config-reload', onReload);
  }, [refresh]);

  const dismissPermanently = useCallback(() => {
    try {
      localStorage.setItem(LOCAL_STORAGE_MODEL_SETUP_DISMISSED, '1');
    } catch {
      /* private mode */
    }
    setGuideDismissed(true);
  }, []);

  return {
    needsSetup,
    ready,
    refresh,
    guideDismissed,
    dismissPermanently,
  };
}
