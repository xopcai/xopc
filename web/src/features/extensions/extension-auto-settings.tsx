import { useCallback, useEffect, useMemo, useState } from 'react';
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

  const [localValues, setLocalValues] = useState<Record<string, unknown>>({});
  const [isDirty, setIsDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saveSuccess, setSaveSuccess] = useState(false);

  useEffect(() => {
    if (isDirty) return;
    setLocalValues(savedValues);
  }, [isDirty, savedValues]);

  const onChange = useCallback((next: Record<string, unknown>) => {
    setLocalValues(next);
    setIsDirty(true);
    setSaveError(null);
  }, []);

  const handleDiscard = useCallback(() => {
    setLocalValues(savedValues);
    setIsDirty(false);
    setSaveError(null);
  }, [savedValues]);

  const handleResetDefaults = useCallback(() => {
    if (!schema || schema.type !== 'object') return;
    setLocalValues({ ...extractObjectDefaults(schema) });
    setIsDirty(true);
    setSaveError(null);
  }, [schema]);

  const handleSave = useCallback(async () => {
    if (!extensionId) return;
    setSaving(true);
    setSaveError(null);
    try {
      const res = await apiFetch(
        apiUrl(`/api/extensions/${encodeURIComponent(extensionId)}/config`),
        { method: 'PATCH', body: JSON.stringify(localValues) },
      );
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: { message?: string } };
        throw new Error(body.error?.message ?? res.statusText);
      }
      await mutateConfig(localValues, false);
      setIsDirty(false);
      setSaveSuccess(true);
      window.setTimeout(() => setSaveSuccess(false), 3000);
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }, [extensionId, localValues, mutateConfig]);

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
          {saveSuccess ? (
            <span className="text-xs text-emerald-600 dark:text-emerald-400">{a.saved}</span>
          ) : null}
          {saveError ? <span className="text-xs text-red-600 dark:text-red-400">{saveError}</span> : null}
          <Button
            type="button"
            variant="ghost"
            className="h-8 text-xs"
            disabled={!isDirty}
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
            disabled={!isDirty || saving}
            onClick={() => void handleSave()}
          >
            {saving ? a.saving : a.save}
          </Button>
        </div>
      </div>
      <SchemaForm schema={schema} values={localValues} onChange={onChange} disabled={saving} />
    </div>
  );
}
