import { Loader2, Shield } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { Button } from '@/components/ui/button';
import { useGatewayConfigSwr } from '@/features/gateway/gateway-config-swr';
import { SettingsFormSection, SettingsFormSectionHeader } from '@/features/settings/settings-form-section';
import {
  normalizeTunnelE2eFromConfig,
  patchTunnelE2e,
  validateTunnelE2e,
  type TunnelE2eState,
} from '@/features/tunnel/tunnel-e2e-api';
import { settingsInputFocusClass } from '@/lib/form-field-width';
import { cn } from '@/lib/cn';
import { messages, type TunnelSettingsMessages } from '@/i18n/messages';
import { useLocaleStore } from '@/stores/locale-store';

function inputClassName(): string {
  return cn(
    'w-full rounded-lg border border-edge bg-surface-panel px-3 py-2 text-sm text-fg',
    settingsInputFocusClass,
    'dark:border-edge',
  );
}

type Props = {
  hasToken: boolean;
  gatewayPort: number;
  tunnelConnected: boolean;
  nested?: boolean;
};

export function TunnelE2eSection({ hasToken, gatewayPort, tunnelConnected, nested = false }: Props) {
  const language = useLocaleStore((s) => s.language);
  const t = messages(language).tunnelSettings;
  const { data, isLoading } = useGatewayConfigSwr(hasToken);

  const parsed = useMemo(
    () =>
      data?.payload?.config !== undefined
        ? structuredClone(normalizeTunnelE2eFromConfig(data.payload.config, gatewayPort))
        : null,
    [data, gatewayPort],
  );

  const [form, setForm] = useState<TunnelE2eState | null>(null);
  const [baseline, setBaseline] = useState<TunnelE2eState | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saveOk, setSaveOk] = useState(false);
  const dirtyRef = useRef(false);

  useEffect(() => {
    if (!hasToken || parsed === null) return;
    if (!dirtyRef.current) {
      setForm(parsed);
      setBaseline(structuredClone(parsed));
      setSaveOk(false);
    }
  }, [hasToken, parsed]);

  const dirty = useMemo(() => {
    if (!form || !baseline) return false;
    return JSON.stringify(form) !== JSON.stringify(baseline);
  }, [form, baseline]);

  const update = useCallback((patch: Partial<TunnelE2eState>) => {
    dirtyRef.current = true;
    setForm((f) => (f ? { ...f, ...patch } : null));
  }, []);

  const save = useCallback(async () => {
    if (!form || saving) return;
    const validationError = validateTunnelE2e(form);
    if (validationError) {
      setError(validationError);
      return;
    }
    setSaving(true);
    setError(null);
    setSaveOk(false);
    try {
      await patchTunnelE2e(form);
      dirtyRef.current = false;
      const next = structuredClone(form);
      setBaseline(next);
      setSaveOk(true);
      window.setTimeout(() => setSaveOk(false), 2500);
    } catch (e) {
      setError(e instanceof Error ? e.message : t.e2eSaveError);
    } finally {
      setSaving(false);
    }
  }, [form, saving, t.e2eSaveError]);

  const discard = useCallback(() => {
    if (!baseline) return;
    dirtyRef.current = false;
    setForm(structuredClone(baseline));
    setError(null);
    setSaveOk(false);
  }, [baseline]);

  if (!hasToken || !form) {
    if (isLoading) {
      return (
        <SettingsFormSection>
          <p className="flex items-center gap-2 text-sm text-fg-muted">
            <Loader2 className="size-4 animate-spin" />
            {t.e2eLoading}
          </p>
        </SettingsFormSection>
      );
    }
    return null;
  }

  const body = (
    <>
      {tunnelConnected ? (
        <p className="mb-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-950 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-100">
          {t.e2eConnectedWarning}
        </p>
      ) : null}

      {dirty ? <p className="mb-3 text-xs text-amber-800 dark:text-amber-200">{t.e2eUnsaved}</p> : null}
      {error ? <p className="mb-3 text-sm text-red-600 dark:text-red-400">{error}</p> : null}
      <p className="mb-4 text-xs text-fg-subtle">{t.e2eRestartHint}</p>

      <TunnelE2eFields t={t} form={form} gatewayPort={gatewayPort} onChange={update} />
    </>
  );

  if (nested) {
    return (
      <div className="space-y-3">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <h3 className="text-sm font-semibold text-fg">{t.e2eTitle}</h3>
            <p className="mt-0.5 text-xs text-fg-muted">{t.e2eSubtitle}</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {saveOk ? <span className="text-xs text-fg-muted">{t.e2eSaved}</span> : null}
            <Button type="button" variant="secondary" disabled={!dirty || saving} onClick={discard}>
              {t.e2eDiscard}
            </Button>
            <Button type="button" variant="primary" disabled={!dirty || saving} onClick={() => void save()}>
              {saving ? t.e2eSaving : t.e2eSave}
            </Button>
          </div>
        </div>
        {body}
      </div>
    );
  }

  return (
    <SettingsFormSection>
      <SettingsFormSectionHeader
        icon={Shield}
        title={t.e2eTitle}
        subtitle={t.e2eSubtitle}
        trailing={
          <div className="flex flex-wrap items-center gap-2">
            {saveOk ? <span className="text-sm text-fg-muted">{t.e2eSaved}</span> : null}
            <Button type="button" variant="secondary" disabled={!dirty || saving} onClick={discard}>
              {t.e2eDiscard}
            </Button>
            <Button type="button" variant="primary" disabled={!dirty || saving} onClick={() => void save()}>
              {saving ? t.e2eSaving : t.e2eSave}
            </Button>
          </div>
        }
      />
      {body}
    </SettingsFormSection>
  );
}

function TunnelE2eFields({
  t,
  form,
  gatewayPort,
  onChange,
}: {
  t: TunnelSettingsMessages;
  form: TunnelE2eState;
  gatewayPort: number;
  onChange: (patch: Partial<TunnelE2eState>) => void;
}) {
  const suggestedPort = gatewayPort + 1;

  return (
    <div className="space-y-4">
      <label className="flex cursor-pointer items-start gap-2 text-sm text-fg">
        <input
          type="checkbox"
          className="ui-checkbox mt-0.5"
          checked={form.enabled}
          onChange={(e) => onChange({ enabled: e.target.checked })}
        />
        <span>
          <span className="font-medium">{t.e2eEnabled}</span>
          <span className="mt-0.5 block text-xs text-fg-subtle">{t.e2eEnabledHint}</span>
        </span>
      </label>

      <div>
        <label className="mb-1 block text-sm font-medium text-fg" htmlFor="tunnel-e2e-tls-port">
          {t.e2eTlsPort}
        </label>
        <input
          id="tunnel-e2e-tls-port"
          type="number"
          min={1024}
          max={65535}
          disabled={!form.enabled}
          className={cn(inputClassName(), 'max-w-xs font-mono text-xs')}
          value={form.tlsPort}
          onChange={(e) => {
            const n = Number(e.target.value);
            if (Number.isFinite(n)) onChange({ tlsPort: Math.max(1024, Math.min(65535, Math.floor(n))) });
          }}
        />
        <p className="mt-1 text-xs text-fg-subtle">
          {t.e2eTlsPortHint.replace('{{port}}', String(suggestedPort))}
        </p>
      </div>

      <label className="flex cursor-pointer items-start gap-2 text-sm text-fg">
        <input
          type="checkbox"
          className="ui-checkbox mt-0.5"
          checked={form.staging}
          disabled={!form.enabled}
          onChange={(e) => onChange({ staging: e.target.checked })}
        />
        <span>
          <span className="font-medium">{t.e2eStaging}</span>
          <span className="mt-0.5 block text-xs text-fg-subtle">{t.e2eStagingHint}</span>
        </span>
      </label>
    </div>
  );
}
