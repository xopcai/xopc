import { useCallback, useMemo, useReducer, useRef } from 'react';
import useSWR from 'swr';

import { Button } from '@/components/ui/button';
import { AutosaveStatus } from '@/components/ui/autosave-status';
import { extractObjectDefaults } from '@/components/ui/schema-form-utils';
import { SchemaForm, type JsonSchema } from '@/components/ui/schema-form';
import { apiFetch, fetchJson } from '@/lib/fetch';
import { apiUrl } from '@/lib/url';
import { useGatewayStore } from '@/stores/gateway-store';
import { useAutosave } from '@/lib/use-autosave';

type ExtensionDetailResponse = {
  manifest: { configSchema?: JsonSchema };
};

type ExtensionSettingsDraft = {
  localValues: Record<string, unknown>;
  isDirty: boolean;
};

type ExtensionSettingsAction =
  | { type: 'sync'; value: Record<string, unknown> }
  | { type: 'change'; value: Record<string, unknown> }
  | { type: 'reset-defaults'; value: Record<string, unknown> }
  | { type: 'saved'; value: Record<string, unknown> };

function extensionSettingsReducer(
  state: ExtensionSettingsDraft,
  action: ExtensionSettingsAction,
): ExtensionSettingsDraft {
  switch (action.type) {
    case 'sync':
      return { localValues: action.value, isDirty: false };
    case 'change':
      return { localValues: action.value, isDirty: true };
    case 'reset-defaults':
      return { localValues: action.value, isDirty: true };
    case 'saved':
      return JSON.stringify(state.localValues) === JSON.stringify(action.value)
        ? { localValues: state.localValues, isDirty: false }
        : state;
  }
}

export function ExtensionAutoSettings({ extensionId }: { extensionId: string }) {
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
  });

  const dirtyRef = useRef(false);
  const valuesRef = useRef(draft.localValues);
  valuesRef.current = draft.localValues;
  const trackedSavedRef = useRef(savedValues);
  if (!dirtyRef.current && trackedSavedRef.current !== savedValues) {
    trackedSavedRef.current = savedValues;
    dispatch({ type: 'sync', value: savedValues });
  }

  const onChange = useCallback((next: Record<string, unknown>) => {
    dirtyRef.current = true;
    dispatch({ type: 'change', value: next });
  }, []);

  const handleResetDefaults = useCallback(() => {
    if (!schema || schema.type !== 'object') return;
    dirtyRef.current = true;
    dispatch({ type: 'reset-defaults', value: { ...extractObjectDefaults(schema) } });
  }, [schema]);

  const handleSave = useCallback(async (snapshot: Record<string, unknown>) => {
    if (!extensionId) return;
    const res = await apiFetch(
      apiUrl(`/api/extensions/${encodeURIComponent(extensionId)}/config`),
      { method: 'PATCH', body: JSON.stringify(snapshot) },
    );
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { error?: { message?: string } };
      throw new Error(body.error?.message ?? res.statusText);
    }
    await mutateConfig(snapshot, false);
    dispatch({ type: 'saved', value: snapshot });
    dirtyRef.current = JSON.stringify(valuesRef.current) !== JSON.stringify(snapshot);
  }, [extensionId, mutateConfig]);

  const autosave = useAutosave({ value: draft.localValues, dirty: draft.isDirty, onSave: handleSave });

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
    <div className="mb-6 flex flex-col gap-3 rounded-xl bg-surface-base p-4" onBlurCapture={autosave.onBlurCapture}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-semibold text-fg">Configuration</h2>
        <div className="flex flex-wrap items-center gap-2">
          <AutosaveStatus status={autosave.status} error={autosave.error} />
          <Button
            type="button"
            variant="ghost"
            className="h-8 text-xs"
            onClick={handleResetDefaults}
          >
            Reset to defaults
          </Button>
        </div>
      </div>
      <SchemaForm schema={schema} values={draft.localValues} onChange={onChange} />
    </div>
  );
}
