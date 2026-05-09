import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { useGatewayConfigSwr } from '@/features/gateway/gateway-config-swr';
import {
  parseAgentDefaultsFromConfig,
  parseParamsJsonForSave,
  patchAgentDefaults,
  type AgentDefaultsState,
} from '@/features/settings/config-api';
import type { MessageBundle } from '@/i18n/messages';
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
  mutate: ReturnType<typeof useGatewayConfigSwr>['mutate'];
};

export function useAgentDefaultsForm(a: MessageBundle['agentSettings']): UseAgentDefaultsFormResult {
  const token = useGatewayStore((st) => st.token);
  const hasToken = Boolean(token);

  const [form, setForm] = useState<AgentDefaultsState | null>(null);
  const [baseline, setBaseline] = useState<AgentDefaultsState | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saveOk, setSaveOk] = useState(false);
  const dirtyRef = useRef(false);

  const { data, error: swrError, isLoading, mutate } = useGatewayConfigSwr(hasToken);

  const parsed = useMemo(
    () =>
      data?.payload?.config !== undefined ? parseAgentDefaultsFromConfig(data.payload.config) : null,
    [data],
  );

  useEffect(() => {
    if (!hasToken) {
      setForm(null);
      setBaseline(null);
      dirtyRef.current = false;
      return;
    }
    if (parsed === null) return;
    if (!dirtyRef.current) {
      setForm(parsed);
      setBaseline(parsed);
    }
  }, [hasToken, parsed]);

  const loading = Boolean(hasToken && isLoading && data === undefined && !swrError);
  const fetchError =
    swrError instanceof Error ? swrError.message : swrError ? String(swrError) : null;

  const dirty = useMemo(() => {
    if (!form || !baseline) return false;
    return JSON.stringify(form) !== JSON.stringify(baseline);
  }, [form, baseline]);

  const update = useCallback((patch: Partial<AgentDefaultsState>) => {
    dirtyRef.current = true;
    setForm((f) => (f ? { ...f, ...patch } : null));
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
      await patchAgentDefaults(form);
      dirtyRef.current = false;
      setSaveOk(true);
      window.setTimeout(() => setSaveOk(false), 2500);
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : a.saveError);
      return false;
    } finally {
      setSaving(false);
    }
  }, [form, saving, a.saveError, a.advanced]);

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
    mutate,
  };
}
