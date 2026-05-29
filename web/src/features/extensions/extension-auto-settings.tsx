import { useCallback, useMemo, useReducer, useRef, useState } from 'react';
import useSWR from 'swr';

import { Button } from '@/components/ui/button';
import { extractObjectDefaults, SchemaForm, type JsonSchema } from '@/components/ui/schema-form';
import { apiFetch, fetchJson } from '@/lib/fetch';
import { apiUrl } from '@/lib/url';
import { messages } from '@/i18n/messages';
import { useGatewayStore } from '@/stores/gateway-store';
import { useLocaleStore } from '@/stores/locale-store';

type ExtensionDetailResponse = {
  manifest: { configSchema?: JsonSchema };
};

type ExtensionSettingsDraft = {
  localValues: Record<string, unknown>;
  isDirty: boolean;
  saving: boolean;
  saveError: string | null;
  saveSuccess: boolean;
};

type ExtensionSettingsAction =
  | { type: 'sync'; value: Record<string, unknown> }
  | { type: 'change'; value: Record<string, unknown> }
  | { type: 'discard'; value: Record<string, unknown> }
  | { type: 'reset-defaults'; value: Record<string, unknown> }
  | { type: 'save-start' }
  | { type: 'save-success'; value: Record<string, unknown> }
  | { type: 'save-error'; message: string };

function extensionSettingsReducer(
  state: ExtensionSettingsDraft,
  action: ExtensionSettingsAction,
): ExtensionSettingsDraft {
  switch (action.type) {
    case 'sync':
      return { ...state, localValues: action.value, isDirty: false, saveError: null };
    case 'change':
      return { ...state, localValues: action.value, isDirty: true, saveError: null, saveSuccess: false };
    case 'discard':
      return { ...state, localValues: action.value, isDirty: false, saveError: null };
    case 'reset-defaults':
      return { ...state, localValues: action.value, isDirty: true, saveError: null, saveSuccess: false };
    case 'save-start':
      return { ...state, saving: true, saveError: null };
    case 'save-success':
      return {
        ...state,
        localValues: action.value,
        isDirty: false,
        saving: false,
        saveSuccess: true,
        saveError: null,
      };
    case 'save-error':
      return { ...state, saving: false, saveError: action.message };
  }
}

export function ExtensionAutoSettings({ extensionId }: { extensionId: string }) {
  const language = useLocaleStore((s) => s.language);
  const a = messages(language).agentSettings;
  const hasToken = useGatewayStore((s) => Boolean(s.token));
  const { data: detail, error: detailError } = useSWR(
    hasToken && extensionId ? `ext-detail-${extensionId}` : null,
    () => fetchJson<ExtensionDetailResponse>(apiUrl(`/api/extensions/${encodeURIComponent(extensionId)}`)),
  );

  const { data: remoteConfig, mutate: mutateConfig, error: configError } = useSWR(
    hasToken && extensionId ? `ext-cfg-${extensionId}` : null,
    () =>
      fetchJson<Record<string, unknown>>(
        apiUrl(`/api/extensions/${encodeURIComponent(extensionId)}/config`),
      ),
  );

  const schema = detail?.manifest?.configSchema;
  const defaults = useMemo(
    () => (schema && schema.type === 'object' ? extractObjectDefaults(schema) : {}),
    [schema],
  );

  const savedValues = useMemo(
    () => ({ ...defaults, ...(remoteConfig ?? {}) }),
    [defaults, remoteConfig],
  );

  const [draft, dispatch] = useReducer(extensionSettingsReducer, {
    localValues: {},
    isDirty: false,
    saving: false,
    saveError: null,
    saveSuccess: false,
  });
  const [saveSuccessFlash, setSaveSuccessFlash] = useState(false);

  const dirtyRef = useRef(false);
  const trackedSavedRef = useRef(savedValues);
  if (!dirtyRef.current && trackedSavedRef.current !== savedValues) {
    trackedSavedRef.current = savedValues;
    dispatch({ type: 'sync', value: savedValues });
  }

  const onChange = useCallback((next: Record<string, unknown>) => {
    dirtyRef.current = true;
    dispatch({ type: 'change', value: next });
  }, []);

  const handleDiscard = useCallback(() => {
    dirtyRef.current = false;
    dispatch({ type: 'discard', value: savedValues });
  }, [savedValues]);

  const handleResetDefaults = useCallback(() => {
    if (!schema || schema.type !== 'object') return;
    dirtyRef.current = true;
    dispatch({ type: 'reset-defaults', value: { ...extractObjectDefaults(schema) } });
  }, [schema]);

  const handleSave = useCallback(async () => {
    if (!extensionId) return;
    dispatch({ type: 'save-start' });
    try {
      const res = await apiFetch(
        apiUrl(`/api/extensions/${encodeURIComponent(extensionId)}/config`),
        { method: 'PATCH', body: JSON.stringify(draft.localValues) },
      );
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: { message?: string } };
        throw new Error(body.error?.message ?? res.statusText);
      }
      await mutateConfig(draft.localValues, false);
      dirtyRef.current = false;
      dispatch({ type: 'save-success', value: draft.localValues });
      setSaveSuccessFlash(true);
      window.setTimeout(() => setSaveSuccessFlash(false), 3000);
    } catch (e) {
      dispatch({ type: 'save-error', message: e instanceof Error ? e.message : String(e) });
    }
  }, [draft.localValues, extensionId, mutateConfig]);

  if (!hasToken) {
    return null;
  }

  if (detailError || configError) {
    const err = (detailError ?? configError) as Error;
    return (
      <p className="text-sm text-fg-muted">
        Could not load extension settings: {err instanceof Error ? err.message : String(err)}
      </p>
    );
  }

  if (!schema || schema.type !== 'object') {
    return null;
  }

  return (
    <div className="mb-6 flex flex-col gap-3 rounded-xl border border-edge bg-surface-base p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-semibold text-fg">Configuration</h2>
        <div className="flex flex-wrap items-center gap-2">
          {saveSuccessFlash ? (
            <span className="text-xs text-emerald-600 dark:text-emerald-400">{a.saved}</span>
          ) : null}
          {draft.saveError ? <span className="text-xs text-red-600 dark:text-red-400">{draft.saveError}</span> : null}
          <Button
            type="button"
            variant="ghost"
            className="h-8 text-xs"
            disabled={!draft.isDirty}
            onClick={handleDiscard}
          >
            {a.discard}
          </Button>
          <Button
            type="button"
            variant="ghost"
            className="h-8 text-xs"
            onClick={handleResetDefaults}
          >
            Reset to defaults
          </Button>
          <Button
            type="button"
            variant="primary"
            className="h-8 text-xs"
            disabled={!draft.isDirty || draft.saving}
            onClick={() => void handleSave()}
          >
            {draft.saving ? a.saving : a.save}
          </Button>
        </div>
      </div>
      <SchemaForm schema={schema} values={draft.localValues} onChange={onChange} disabled={draft.saving} />
    </div>
  );
}
