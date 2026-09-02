import { useCallback, useMemo, useReducer, useRef } from 'react';

import { useGatewayConfigSwr } from '@/features/gateway/gateway-config-swr';
import {
  parseBrowserSettings,
  patchBrowserSettings,
  type BrowserSettingsState,
} from '@/features/settings/config-api';
import type { MessageBundle } from '@/i18n/messages';
import { createFormDraftReducer, syncFormDraftFromParsed } from '@/lib/settings-form-draft';
import { useGatewayStore } from '@/stores/gateway-store';
import { useAutosave, type AutosaveStatus } from '@/lib/use-autosave';

export type UseAgentDefaultsFormResult = {
  hasToken: boolean;
  loading: boolean;
  fetchError: string | null;
  form: BrowserSettingsState | null;
  update: (patch: Partial<BrowserSettingsState>) => void;
  autosaveStatus: AutosaveStatus;
  error: string | null;
  onBlurCapture: () => void;
  mutate: ReturnType<typeof useGatewayConfigSwr>['mutate'];
};

const browserSettingsFormReducer = createFormDraftReducer<BrowserSettingsState>();

export function useAgentDefaultsForm(
  a: MessageBundle['agentSettings'],
): UseAgentDefaultsFormResult {
  const token = useGatewayStore((st) => st.token);
  const hasToken = Boolean(token);

  const [formDraft, dispatchForm] = useReducer(browserSettingsFormReducer, { form: null, baseline: null });
  const form = formDraft.form;
  const baseline = formDraft.baseline;
  const dirtyRef = useRef(false);
  const formRef = useRef(form);
  formRef.current = form;
  const trackedParsedRef = useRef<BrowserSettingsState | null>(null);

  const { data, error: swrError, isLoading, mutate } = useGatewayConfigSwr(hasToken);

  const parsed = useMemo(
    () =>
      data?.payload?.config !== undefined ? parseBrowserSettings(data.payload.config) : null,
    [data],
  );

  syncFormDraftFromParsed({
    enabled: hasToken,
    parsed,
    dirty: dirtyRef.current,
    trackedParsedRef,
    dispatch: dispatchForm,
    onResetDirty: () => {
      dirtyRef.current = false;
    },
  });

  const loading = Boolean(hasToken && isLoading && data === undefined && !swrError);
  const fetchError =
    swrError instanceof Error ? swrError.message : swrError ? String(swrError) : null;

  const dirty = useMemo(() => {
    if (!form || !baseline) return false;
    return JSON.stringify(form) !== JSON.stringify(baseline);
  }, [form, baseline]);

  const update = useCallback((patch: Partial<BrowserSettingsState>) => {
    dirtyRef.current = true;
    dispatchForm({ type: 'patch', patch });
  }, []);

  const save = useCallback(async (snapshot: BrowserSettingsState) => {
    try {
      await patchBrowserSettings(snapshot);
      dispatchForm({ type: 'saved', value: snapshot });
      dirtyRef.current = Boolean(
        formRef.current && JSON.stringify(formRef.current) !== JSON.stringify(snapshot),
      );
    } catch (e) {
      throw new Error(e instanceof Error ? e.message : a.saveError);
    }
  }, [a.saveError]);

  const autosave = useAutosave({ value: form, dirty, onSave: save });

  return {
    hasToken,
    loading,
    fetchError,
    form,
    update,
    autosaveStatus: autosave.status,
    error: autosave.error,
    onBlurCapture: autosave.onBlurCapture,
    mutate,
  };
}
