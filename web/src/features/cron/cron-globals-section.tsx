import { Clock, Loader2 } from 'lucide-react';
import { useCallback, useMemo, useReducer, useRef } from 'react';

import { Button } from '@/components/ui/button';
import { useGatewayConfigSwr } from '@/features/gateway/gateway-config-swr';
import {
  normalizeCronGlobalsFromConfig,
  patchCronGlobals,
  type CronGlobalsState,
} from '@/features/cron/cron-globals-api';
import { SettingsAdvancedGate } from '@/features/settings/settings-advanced-gate';
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

type GlobalsUiState = {
  form: CronGlobalsState | null;
  baseline: CronGlobalsState | null;
  saving: boolean;
  error: string | null;
  saveOk: boolean;
  dirty: boolean;
};

type GlobalsAction =
  | { type: 'sync'; parsed: CronGlobalsState }
  | { type: 'patch'; patch: Partial<CronGlobalsState> }
  | { type: 'discard' }
  | { type: 'saveStart' }
  | { type: 'saveSuccess' }
  | { type: 'saveError'; error: string }
  | { type: 'clearSaveOk' };

function initialGlobalsUiState(): GlobalsUiState {
  return {
    form: null,
    baseline: null,
    saving: false,
    error: null,
    saveOk: false,
    dirty: false,
  };
}

function globalsReducer(state: GlobalsUiState, action: GlobalsAction): GlobalsUiState {
  switch (action.type) {
    case 'sync':
      return {
        ...state,
        form: structuredClone(action.parsed),
        baseline: structuredClone(action.parsed),
        saveOk: false,
        dirty: false,
      };
    case 'patch':
      return state.form
        ? { ...state, form: { ...state.form, ...action.patch }, dirty: true, saveOk: false }
        : state;
    case 'discard':
      return state.baseline
        ? { ...state, form: structuredClone(state.baseline), dirty: false }
        : state;
    case 'saveStart':
      return { ...state, saving: true, error: null };
    case 'saveSuccess':
      return state.form
        ? {
            ...state,
            saving: false,
            baseline: structuredClone(state.form),
            dirty: false,
            saveOk: true,
          }
        : { ...state, saving: false };
    case 'saveError':
      return { ...state, saving: false, error: action.error };
    case 'clearSaveOk':
      return { ...state, saveOk: false };
  }
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

  const [ui, dispatch] = useReducer(globalsReducer, undefined as never, initialGlobalsUiState);
  const trackedParsedRef = useRef(parsed);
  if (hasToken && parsed !== null && !ui.dirty && trackedParsedRef.current !== parsed) {
    trackedParsedRef.current = parsed;
    dispatch({ type: 'sync', parsed });
  }

  const dirty = useMemo(
    () => Boolean(ui.form && ui.baseline && JSON.stringify(ui.form) !== JSON.stringify(ui.baseline)),
    [ui.form, ui.baseline],
  );

  const update = useCallback((patch: Partial<CronGlobalsState>) => {
    dispatch({ type: 'patch', patch });
  }, []);

  const save = useCallback(async () => {
    if (!ui.form || ui.saving) return;
    dispatch({ type: 'saveStart' });
    try {
      await patchCronGlobals(ui.form);
      dispatch({ type: 'saveSuccess' });
      window.setTimeout(() => dispatch({ type: 'clearSaveOk' }), 2500);
    } catch (e) {
      dispatch({ type: 'saveError', error: e instanceof Error ? e.message : t.saveError });
    }
  }, [t.saveError, ui.form, ui.saving]);

  if (!hasToken || !ui.form) {
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
        {ui.saveOk ? <span className="text-sm text-fg-muted">{t.saved}</span> : null}
        <Button type="button" variant="secondary" disabled={!dirty || ui.saving} onClick={() => dispatch({ type: 'discard' })}>
          {t.discard}
        </Button>
        <Button type="button" variant="primary" disabled={!dirty || ui.saving} onClick={() => void save()}>
          {ui.saving ? t.saving : t.save}
        </Button>
      </div>
      {ui.error ? <p className="mb-3 text-sm text-red-600 dark:text-red-400">{ui.error}</p> : null}
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="flex items-center gap-2 text-sm text-fg sm:col-span-2">
          <input type="checkbox" className="ui-checkbox" checked={ui.form.enabled} onChange={(e) => update({ enabled: e.target.checked })} />
          {t.enabled}
        </label>
        <SettingsAdvancedGate>
          <Field label={t.maxConcurrent} value={ui.form.maxConcurrentJobs} min={1} max={100} disabled={!ui.form.enabled} onChange={(maxConcurrentJobs) => update({ maxConcurrentJobs })} />
          <Field label={t.timezone} text value={ui.form.defaultTimezone} disabled={!ui.form.enabled} onTextChange={(defaultTimezone) => update({ defaultTimezone })} />
          <Field label={t.retentionDays} value={ui.form.historyRetentionDays} min={1} max={365} disabled={!ui.form.enabled} onChange={(historyRetentionDays) => update({ historyRetentionDays })} />
          <label className="flex items-center gap-2 text-sm text-fg">
            <input type="checkbox" className="ui-checkbox" checked={ui.form.enableMetrics} disabled={!ui.form.enabled} onChange={(e) => update({ enableMetrics: e.target.checked })} />
            {t.metrics}
          </label>
        </SettingsAdvancedGate>
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
