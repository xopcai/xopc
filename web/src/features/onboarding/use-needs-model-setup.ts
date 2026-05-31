import { useCallback, useEffect, useMemo, useState } from 'react';
import useSWR from 'swr';

import { CONFIGURED_MODELS_SWR_KEY, fetchConfiguredModelsCached } from '@/features/chat/api/registry-api';
import { useGatewayConfigSwr } from '@/features/gateway/gateway-config-swr';
import { computeNeedsModelSetup } from '@/features/onboarding/model-setup-derivation';

import { LOCAL_STORAGE_MODEL_SETUP_DISMISSED } from '@/features/onboarding/onboarding-constants';

export function useNeedsModelSetup(enabled: boolean) {
  const [guideDismissed, setGuideDismissed] = useState(
    () =>
      typeof localStorage !== 'undefined' &&
      localStorage.getItem(LOCAL_STORAGE_MODEL_SETUP_DISMISSED) === '1',
  );

  const {
    data: configData,
    error: configError,
    isLoading: configLoading,
    mutate: mutateConfig,
  } = useGatewayConfigSwr(enabled);

  const {
    data: modelsData,
    isLoading: modelsLoading,
    error: modelsError,
    mutate: mutateModels,
  } = useSWR(enabled ? CONFIGURED_MODELS_SWR_KEY : null, fetchConfiguredModelsCached, {
    revalidateOnFocus: false,
  });

  const ready = !enabled || (!configLoading && !modelsLoading);

  const needsSetup = useMemo(
    () =>
      computeNeedsModelSetup({
        enabled,
        ready,
        configError,
        modelsError,
        config: configData?.payload?.config,
        modelsData,
      }),
    [enabled, ready, configError, configData, modelsData, modelsError],
  );

  const refresh = useCallback(async () => {
    await Promise.all([mutateConfig(), mutateModels()]);
  }, [mutateConfig, mutateModels]);

  /** Config reload is handled by {@link useGatewayConfigSwr}; revalidate models when registry/config changes. */
  useEffect(() => {
    if (!enabled) return;
    const onReload = () => {
      void mutateModels();
    };
    window.addEventListener('config-reload', onReload);
    return () => window.removeEventListener('config-reload', onReload);
  }, [enabled, mutateModels]);

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
