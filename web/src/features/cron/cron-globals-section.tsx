import { Clock, Loader2 } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { Button } from '@/components/ui/button';
import { useGatewayConfigSwr } from '@/features/gateway/gateway-config-swr';
import {
  normalizeCronGlobalsFromConfig,
  patchCronGlobals,
  type CronGlobalsState,
} from '@/features/cron/cron-globals-api';
import { SettingsFormSection, SettingsFormSectionHeader } from '@/features/settings/settings-form-section';
import { settingsInputFocusClass } from '@/lib/form-field-width';
import { cn } from '@/lib/cn';
import { messages } from '@/i18n/messages';
import { useLocaleStore } from '@/stores/locale-store';

function inputClassName(): string {
  return cn(
    'w-full rounded-lg border border-edge bg-surface-panel px-3 py-2 text-sm text-fg',
    settingsInputFocusClass,
    'dark:border-edge',
  );
}

export function CronGlobalsSection({ hasToken }: { hasToken: boolean }) {
  const language = useLocaleStore((s) => s.language);
  const t = messages(language).cron.globals;
  const { data, isLoading } = useGatewayConfigSwr(hasToken);
  const parsed = useMemo(
    () =>
      data?.payload?.config !== undefined
        ? structuredClone(normalizeCronGlobalsFromConfig(data.payload.config))
        : null,
    [data],
  );

  const [form, setForm] = useState<CronGlobalsState | null>(null);
  const [baseline, setBaseline] = useState<CronGlobalsState | null>(null);
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

  const dirty = useMemo(() => form && baseline && JSON.stringify(form) !== JSON.stringify(baseline), [form, baseline]);

  const update = useCallback((patch: Partial<CronGlobalsState>) => {
    dirtyRef.current = true;
    setForm((f) => (f ? { ...f, ...patch } : null));
  }, []);

  const save = useCallback(async () => {
    if (!form || saving) return;
    setSaving(true);
    setError(null);
    try {
      await patchCronGlobals(form);
      dirtyRef.current = false;
      setBaseline(structuredClone(form));
      setSaveOk(true);
      window.setTimeout(() => setSaveOk(false), 2500);
    } catch (e) {
      setError(e instanceof Error ? e.message : t.saveError);
    } finally {
      setSaving(false);
    }
  }, [form, saving, t.saveError]);

  if (!hasToken || !form) {
    if (isLoading) {
      return (
        <SettingsFormSection>
          <p className="flex items-center gap-2 text-sm text-fg-muted">
            <Loader2 className="size-4 animate-spin" />
            {t.loading}
          </p>
        </SettingsFormSection>
      );
    }
    return null;
  }

  return (
    <SettingsFormSection>
      <SettingsFormSectionHeader icon={Clock} title={t.title} subtitle={t.hint} />
      <div className="mb-4 flex flex-wrap items-center justify-end gap-2">
        {saveOk ? <span className="text-sm text-fg-muted">{t.saved}</span> : null}
        <Button type="button" variant="secondary" disabled={!dirty || saving} onClick={() => {
          if (!baseline) return;
          dirtyRef.current = false;
          setForm(structuredClone(baseline));
        }}>
          {t.discard}
        </Button>
        <Button type="button" variant="primary" disabled={!dirty || saving} onClick={() => void save()}>
          {saving ? t.saving : t.save}
        </Button>
      </div>
      {error ? <p className="mb-3 text-sm text-red-600 dark:text-red-400">{error}</p> : null}
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="flex items-center gap-2 text-sm text-fg sm:col-span-2">
          <input type="checkbox" className="ui-checkbox" checked={form.enabled} onChange={(e) => update({ enabled: e.target.checked })} />
          {t.enabled}
        </label>
        <Field label={t.maxConcurrent} value={form.maxConcurrentJobs} min={1} max={100} disabled={!form.enabled} onChange={(maxConcurrentJobs) => update({ maxConcurrentJobs })} />
        <Field label={t.timezone} text value={form.defaultTimezone} disabled={!form.enabled} onTextChange={(defaultTimezone) => update({ defaultTimezone })} />
        <Field label={t.retentionDays} value={form.historyRetentionDays} min={1} max={365} disabled={!form.enabled} onChange={(historyRetentionDays) => update({ historyRetentionDays })} />
        <label className="flex items-center gap-2 text-sm text-fg">
          <input type="checkbox" className="ui-checkbox" checked={form.enableMetrics} disabled={!form.enabled} onChange={(e) => update({ enableMetrics: e.target.checked })} />
          {t.metrics}
        </label>
      </div>
    </SettingsFormSection>
  );
}

function Field({
  label,
  value,
  min,
  max,
  disabled,
  text,
  onChange,
  onTextChange,
}: {
  label: string;
  value: number | string;
  min?: number;
  max?: number;
  disabled?: boolean;
  text?: boolean;
  onChange?: (n: number) => void;
  onTextChange?: (s: string) => void;
}) {
  return (
    <div>
      <label className="mb-1 block text-sm font-medium text-fg">{label}</label>
      {text ? (
        <input
          className={cn(inputClassName(), 'font-mono text-xs')}
          value={String(value)}
          disabled={disabled}
          onChange={(e) => onTextChange?.(e.target.value)}
        />
      ) : (
        <input
          type="number"
          min={min}
          max={max}
          disabled={disabled}
          className={cn(inputClassName(), 'max-w-xs font-mono text-xs')}
          value={typeof value === 'number' ? value : 0}
          onChange={(e) => {
            const n = Number(e.target.value);
            if (Number.isFinite(n) && onChange && min !== undefined && max !== undefined) {
              onChange(Math.max(min, Math.min(max, Math.floor(n))));
            }
          }}
        />
      )}
    </div>
  );
}
