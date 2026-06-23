import { useCallback, useMemo, useReducer, useRef, useState } from 'react';

import { useGatewayConfigSwr } from '@/features/gateway/gateway-config-swr';
import {
  parseAgentDefaultsFromConfig,
  parseParamsJsonForSave,
  patchAgentDefaults,
  type AgentDefaultsState,
} from '@/features/settings/config-api';
import { validateTypedModelsForSave } from '@/features/settings/agents/typed-models-lib';
import type { MessageBundle } from '@/i18n/messages';
import { createFormDraftReducer, syncFormDraftFromParsed } from '@/lib/settings-form-draft';
import { showToast } from '@/lib/toast';
import { useGatewayStore } from '@/stores/gateway-store';

export type UseAgentDefaultsFormResult = {
  hasToken: boolean;
  loading: boolean;
  fetchError: string | null;
  form: AgentDefaultsState | null;
  update: (patch: Partial<AgentDefaultsState>) => void;
  dirty: boolean;
  saving: boolean;
  saveOk: boolean;
  error: string | null;
  setError: (e: string | null) => void;
  save: () => Promise<boolean>;
  discard: () => void;
  mutate: ReturnType<typeof useGatewayConfigSwr>['mutate'];
};

const agentDefaultsFormReducer = createFormDraftReducer<AgentDefaultsState>();

export function useAgentDefaultsForm(a: MessageBundle['agentSettings']): UseAgentDefaultsFormResult {
  const token = useGatewayStore((st) => st.token);
  const hasToken = Boolean(token);

  const [formDraft, dispatchForm] = useReducer(agentDefaultsFormReducer, { form: null, baseline: null });
  const form = formDraft.form;
  const baseline = formDraft.baseline;
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saveOk, setSaveOk] = useState(false);
  const dirtyRef = useRef(false);
  const trackedParsedRef = useRef<AgentDefaultsState | null>(null);

  const { data, error: swrError, isLoading, mutate } = useGatewayConfigSwr(hasToken);

  const parsed = useMemo(
    () =>
      data?.payload?.config !== undefined ? parseAgentDefaultsFromConfig(data.payload.config) : null,
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

  const update = useCallback((patch: Partial<AgentDefaultsState>) => {
    dirtyRef.current = true;
    dispatchForm({ type: 'patch', patch });
  }, []);

  const save = useCallback(async (): Promise<boolean> => {
    if (!form || saving) return false;
    setSaving(true);
    setError(null);
    setSaveOk(false);
    try {
      try {
        void parseParamsJsonForSave(form.paramsJson);
      } catch (e) {
        setError(
          e instanceof SyntaxError
            ? a.advanced.paramsInvalidJson
            : e instanceof Error
              ? e.message
              : a.advanced.paramsInvalidJson,
        );
        return false;
      }
      const typedErr = validateTypedModelsForSave(form.typedModels, {
        invalidId: a.typedModelsInvalidId,
        duplicateId: a.typedModelsDuplicateId,
        invalidModel: a.typedModelsInvalidModel,
      });
      if (typedErr) {
        setError(typedErr);
        return false;
      }
      await patchAgentDefaults(form);
      dirtyRef.current = false;
      dispatchForm({ type: 'saved', value: form });
      setSaveOk(true);
      showToast({ type: 'success', title: a.saved });
      void mutate();
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : a.saveError);
      return false;
    } finally {
      setSaving(false);
    }
  }, [a.saveError, form, mutate, saving]);

  const discard = useCallback(() => {
    dirtyRef.current = false;
    dispatchForm({ type: 'discard' });
    setSaveOk(false);
    setError(null);
  }, []);

  return {
    hasToken,
    loading,
    fetchError,
    form,
    update,
    dirty,
    saving,
    saveOk,
    error,
    setError,
    save,
    discard,
    mutate,
  };
}
