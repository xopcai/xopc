import { useCallback, useMemo, useRef, useState } from 'react';
import { mutate } from 'swr';

import { useGatewayConfigSwr } from '@/features/gateway/gateway-config-swr';
import {
  buildImageProvidersConfigPatch,
  emptyImageProviderCredRow,
  imageProviderCredRowsFromConfigRoot,
  patchImageProvidersConfig,
  type ImageProviderCredRow,
} from '@/features/settings/image-providers-config-api';
import { IMAGE_PROVIDERS_SWR_KEY } from '@/features/settings/image-providers-swr-key';
import { apiUrl } from '@/lib/url';
import { useGatewayStore } from '@/stores/gateway-store';

export type ImageProviderUiRegionOption = {
  value: string;
  label: string;
  imageBaseUrl: string;
};

export type ImageProviderUiBaseUrlPreset = {
  value: string;
  label: string;
};

export type ImageProviderUiMetadata = {
  regions?: ImageProviderUiRegionOption[];
  baseUrlPresets?: ImageProviderUiBaseUrlPreset[];
  baseUrlPresetKind?: 'fal' | 'minimax' | 'google' | 'openai';
};

export type ImageGenProviderCredentialSummary = {
  id: string;
  label?: string;
  defaultModel?: string;
  models: string[];
  configured?: boolean;
  ui?: ImageProviderUiMetadata;
};

export function useImageProviderCredentials(summaries: ImageGenProviderCredentialSummary[]) {
  const hasToken = useGatewayStore((s) => Boolean(s.token));
  const gwSwr = useGatewayConfigSwr(hasToken);
  const gwCfg = gwSwr.data;

  const ids = useMemo(() => summaries.map((s) => s.id), [summaries]);

  const dirtyRef = useRef(false);
  const [localDraft, setLocalDraft] = useState<Record<string, ImageProviderCredRow> | null>(null);
  const [credSaving, setCredSaving] = useState(false);
  const [credError, setCredError] = useState<string | null>(null);
  const [credSavedFlash, setCredSavedFlash] = useState(false);
  const [credNoopFlash, setCredNoopFlash] = useState(false);

  const credRowsFromServer = useMemo(
    () => imageProviderCredRowsFromConfigRoot(gwCfg?.payload?.config, ids),
    [gwCfg?.payload?.config, ids],
  );

  const credDraft = localDraft ?? credRowsFromServer;
  const credBaseline = credRowsFromServer;

  const credDirty = useMemo(
    () => JSON.stringify(credDraft) !== JSON.stringify(credBaseline),
    [credDraft, credBaseline],
  );

  const updateCredRow = useCallback((id: string, patch: Partial<ImageProviderCredRow>) => {
    dirtyRef.current = true;
    setLocalDraft((prev) => {
      const base = prev ?? credRowsFromServer;
      const row = base[id] ?? emptyImageProviderCredRow();
      return { ...base, [id]: { ...row, ...patch } };
    });
  }, [credRowsFromServer]);

  const onDiscardCredentials = useCallback(() => {
    dirtyRef.current = false;
    setLocalDraft(null);
    setCredError(null);
    setCredSavedFlash(false);
    setCredNoopFlash(false);
  }, []);

  const saveCredentials = useCallback(
    async (errorFallback: string) => {
      const patch = buildImageProvidersConfigPatch(ids, credDraft, credBaseline);
      if (Object.keys(patch).length === 0) {
        setCredNoopFlash(true);
        window.setTimeout(() => setCredNoopFlash(false), 2200);
        return;
      }
      setCredSaving(true);
      setCredError(null);
      setCredSavedFlash(false);
      try {
        await patchImageProvidersConfig(patch);
        const updated = await gwSwr.mutate?.();
        void mutate(apiUrl(IMAGE_PROVIDERS_SWR_KEY));
        void updated;
        dirtyRef.current = false;
        setLocalDraft(null);
        setCredSavedFlash(true);
        window.setTimeout(() => setCredSavedFlash(false), 2000);
      } catch (e) {
        setCredError(e instanceof Error ? e.message : errorFallback);
      } finally {
        setCredSaving(false);
      }
    },
    [ids, credDraft, credBaseline, gwSwr],
  );

  return {
    gwSwr,
    credDraft,
    credBaseline,
    credDirty,
    credSaving,
    credError,
    credSavedFlash,
    credNoopFlash,
    updateCredRow,
    onDiscardCredentials,
    saveCredentials,
  };
}
