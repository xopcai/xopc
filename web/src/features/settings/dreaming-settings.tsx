import { Activity, Loader2, Moon, Play, RefreshCw, ScanLine, Settings2, Sparkles, Sun, Trash2, Unlock, Wrench } from 'lucide-react';
import type { ReactNode } from 'react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import useSWR from 'swr';

import { Button } from '@/components/ui/button';
import { messages, type MessageBundle } from '@/i18n/messages';
import { useGatewayStore } from '@/stores/gateway-store';
import { useLocaleStore } from '@/stores/locale-store';
import { cn } from '@/lib/cn';
import { formControlBorderFocusClass } from '@/lib/form-field-width';
import { SettingsFormSection, SettingsFormSectionHeader } from '@/features/settings/settings-form-section';
import {
  dreamingSwrKey,
  fetchDreamingEvents,
  fetchDreamingStatus,
  fetchDreamingPreview,
  postDreamingAction,
  postDreamingRunNow,
  type DreamingEvent,
  type DreamingGatewayStatus,
  type DreamingLastRunRecord,
  type DreamingPhaseId,
  type DreamingPreviewItem,
  type PhaseLastRun,
} from '@/features/settings/dreaming-api';
import {
  normalizeDreamingFromConfig,
  patchDreamingConfig,
  type DreamingConfigState,
} from '@/features/settings/dreaming-config-api';
import { useGatewayConfigSwr } from '@/features/gateway/gateway-config-swr';
import { formatCronExpressionLabel } from '@/features/scheduling/cron/format-cron-label';
import type { CronSchedulePickerLabels } from '@/features/scheduling/cron/cron-schedule-picker';
import { ScheduleField } from '@/features/scheduling/schedule-field';
import { ScheduleSummary } from '@/features/scheduling/schedule-summary';

const sectionTightClass = 'py-4 px-4 sm:px-5';
const sectionHeaderTightClass = 'mb-3';
const phasePanelClass = 'rounded-xl border border-edge-subtle bg-surface-panel/30 p-3 sm:p-4';
const numInputClass = cn(
  'mt-1 w-full rounded-lg border border-edge-subtle bg-surface-panel px-2.5 py-1.5 text-sm text-fg',
  formControlBorderFocusClass,
);

function rowLabelClass(): string {
  return 'text-xs font-medium text-fg-muted';
}

function rowValueClass(): string {
  return 'text-sm font-medium text-fg';
}

function FieldCell({
  label,
  children,
  className,
}: {
  label: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={className}>
      <span className={rowLabelClass()}>{label}</span>
      {children}
    </div>
  );
}

function StatCell({
  label,
  children,
  className,
}: {
  label: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('min-w-0', className)}>
      <dt className={rowLabelClass()}>{label}</dt>
      <dd className={cn(rowValueClass(), 'mt-0.5')}>{children}</dd>
    </div>
  );
}

function isoShort(v: string | null | undefined): string {
  if (!v) return '—';
  return v.replace('T', ' ').replace('Z', '');
}

function formatDurationMs(ms: number | undefined): string {
  if (ms === undefined || !Number.isFinite(ms) || ms < 0) return '—';
  if (ms < 1000) return `${Math.round(ms)} ms`;
  return `${(ms / 1000).toFixed(2)} s`;
}

type DreamingSettingsI18n = MessageBundle['dreamingSettings'];

function PanelHeading({ label, className }: { label: string; className?: string }) {
  return (
    <h3 className={cn('text-[0.7rem] font-semibold uppercase tracking-wider text-fg-muted', className)}>{label}</h3>
  );
}

function PhaseConfigPanel({
  icon,
  title,
  hint,
  enabled,
  onEnabledChange,
  cron,
  onCronChange,
  scheduleLabels,
  disabled,
  onLabel,
  offLabel,
  cronLabel,
  children,
}: {
  icon: ReactNode;
  title: string;
  hint: string;
  enabled: boolean;
  onEnabledChange: (enabled: boolean) => void;
  cron: string;
  onCronChange: (cron: string) => void;
  scheduleLabels: CronSchedulePickerLabels;
  disabled?: boolean;
  onLabel: string;
  offLabel: string;
  cronLabel: string;
  children: ReactNode;
}) {
  return (
    <div className={phasePanelClass}>
      <div className="mb-2.5 flex flex-wrap items-start justify-between gap-2 border-b border-edge-subtle/80 pb-2.5">
        <div className="flex min-w-0 items-start gap-2">
          <span className="mt-0.5 shrink-0">{icon}</span>
          <div className="min-w-0">
            <div className="text-sm font-semibold text-fg">{title}</div>
            <p className="mt-0.5 text-xs leading-snug text-fg-muted">{hint}</p>
          </div>
        </div>
        <label className="inline-flex shrink-0 items-center gap-2 text-xs text-fg">
          <input
            type="checkbox"
            className="ui-checkbox"
            checked={enabled}
            disabled={disabled}
            onChange={(e) => onEnabledChange(e.target.checked)}
          />
          <span>{enabled ? onLabel : offLabel}</span>
        </label>
      </div>
      <ScheduleField
        kind="cron"
        className="mb-2.5"
        label={cronLabel}
        value={cron}
        onChange={onCronChange}
        labels={scheduleLabels}
        disabled={disabled}
      />
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">{children}</div>
    </div>
  );
}

function PhaseStatusCard({
  icon,
  label,
  enabled,
  cron,
  scheduleSummary,
  details,
  t,
}: {
  icon: ReactNode;
  label: string;
  enabled: boolean;
  cron: string;
  scheduleSummary: string;
  details: string;
  t: DreamingSettingsI18n;
}) {
  return (
    <div className={cn(phasePanelClass, 'space-y-1')}>
      <div className="flex items-center gap-2">
        {icon}
        <span className="text-sm font-medium text-fg">{label}</span>
        <span className={cn('ml-auto text-xs font-medium', enabled ? 'text-emerald-600 dark:text-emerald-400' : 'text-fg-muted')}>
          {enabled ? t.on : t.off}
        </span>
      </div>
      <div className="text-sm font-medium text-fg">{scheduleSummary}</div>
      <p className="truncate font-mono text-[0.65rem] text-fg-subtle" title={cron}>
        {cron}
      </p>
      <p className="text-[0.65rem] leading-snug text-fg-muted">{details}</p>
    </div>
  );
}

function PhaseLastRunBlock({
  label,
  lastRun,
  t,
}: {
  label: string;
  lastRun: PhaseLastRun | undefined;
  t: DreamingSettingsI18n;
}) {
  return (
    <div className="border-t border-edge-subtle/80 pt-3">
      <PanelHeading label={label} className="mb-2" />
      {lastRun?.exists ? (
        <details className="group rounded-lg border border-edge-subtle">
          <summary className="cursor-pointer list-none px-2.5 py-1.5 text-xs font-medium text-fg-muted marker:hidden [&::-webkit-details-marker]:hidden">
            <span className="underline decoration-edge underline-offset-2 group-open:text-fg">{t.lastRunRaw}</span>
          </summary>
          <pre className="max-h-40 overflow-auto border-t border-edge-subtle p-2.5 text-xs text-fg-muted">
            {JSON.stringify(lastRun.raw, null, 2)}
          </pre>
        </details>
      ) : (
        <p className="text-xs text-fg-muted">{t.phaseLastRunEmpty}</p>
      )}
    </div>
  );
}

function LastRunStructuredView({ t, r }: { t: DreamingSettingsI18n; r: DreamingLastRunRecord }) {
  const s = r.deep?.skipped;
  return (
    <dl className="grid grid-cols-2 gap-x-3 gap-y-2 sm:grid-cols-3 lg:grid-cols-4">
      <StatCell label={t.lastRunStatus}>
        <span className={r.ok ? 'text-emerald-600 dark:text-emerald-400' : 'text-amber-600 dark:text-amber-400'}>
          {r.ok ? t.lastRunSuccess : t.lastRunFailure}
        </span>
      </StatCell>
      <StatCell label={t.lastRunDuration}>{formatDurationMs(r.durationMs)}</StatCell>
      <StatCell label={t.lastRunRanked}>{String(r.deep?.candidatesRanked ?? '—')}</StatCell>
      <StatCell label={t.lastRunApplied}>{String(r.deep?.applied ?? '—')}</StatCell>
      <StatCell label={t.lastRunReason} className="col-span-2 sm:col-span-3 lg:col-span-4">
        <span className="block text-pretty">{r.reason}</span>
        {r.errorMessage ? (
          <span className="mt-1 block text-xs text-amber-600 dark:text-amber-400">
            {`${t.lastRunError}: ${r.errorMessage}`}
          </span>
        ) : null}
      </StatCell>
      {s ? (
        <>
          <StatCell label={t.lastRunSkipKey}>{String(s.alreadyPromotedKey)}</StatCell>
          <StatCell label={t.lastRunSkipRehydrate}>{String(s.rehydrateFailed)}</StatCell>
          <StatCell label={t.lastRunSkipContaminated}>{String(s.contaminated)}</StatCell>
          <StatCell label={t.lastRunSkipHash}>{String(s.hashDuplicate)}</StatCell>
        </>
      ) : null}
    </dl>
  );
}
function lockStatusLabel(
  s: DreamingGatewayStatus['lock'],
  labels: Pick<DreamingSettingsI18n, 'lockValueLocked' | 'lockValueUnlocked'>,
): { text: string; className: string } {
  if (s.locked) {
    return { text: labels.lockValueLocked, className: 'text-amber-600 dark:text-amber-400' };
  }
  return { text: labels.lockValueUnlocked, className: 'text-emerald-600 dark:text-emerald-400' };
}

export function DreamingSettingsPanel() {
  const language = useLocaleStore((s) => s.language);
  const m = messages(language);
  const t = m.dreamingSettings;
  const schedulePickerLabels = m.cron.schedulePicker;
  const scheduleBadgeLabels = m.cron.scheduleBadge;
  const localeTag = language === 'zh' ? 'zh-CN' : 'en-US';

  const token = useGatewayStore((st) => st.token);
  const hasToken = Boolean(token);

  const { data: cfgData } = useGatewayConfigSwr(hasToken);

  const [actionBusy, setActionBusy] = useState<null | 'reset_store' | 'clear_lock'>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionOk, setActionOk] = useState(false);
  const [runBusy, setRunBusy] = useState(false);
  const [runOk, setRunOk] = useState(false);
  const [runError, setRunError] = useState<string | null>(null);
  const [runPhase, setRunPhase] = useState<DreamingPhaseId>('deep');
  const [cfgForm, setCfgForm] = useState<DreamingConfigState | null>(null);
  const [cfgBaseline, setCfgBaseline] = useState<DreamingConfigState | null>(null);
  const [cfgSaving, setCfgSaving] = useState(false);
  const [enableSaving, setEnableSaving] = useState(false);
  const [cfgOk, setCfgOk] = useState(false);
  const [cfgError, setCfgError] = useState<string | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [previewItems, setPreviewItems] = useState<DreamingPreviewItem[] | null>(null);
  const [eventsLoading, setEventsLoading] = useState(false);
  const [eventsError, setEventsError] = useState<string | null>(null);
  const [events, setEvents] = useState<DreamingEvent[] | null>(null);

  const { data, error, isLoading, mutate } = useSWR(hasToken ? dreamingSwrKey() : null, fetchDreamingStatus, {
    revalidateOnFocus: false,
  });

  const lockLabel = useMemo(
    () => (data ? lockStatusLabel(data.lock, t) : null),
    [data, t],
  );

  const errorMessages = useMemo(() => {
    const list: string[] = [];
    if (error) list.push(error instanceof Error ? error.message : String(error));
    if (actionError) list.push(actionError);
    if (runError) list.push(runError);
    if (previewError) list.push(previewError);
    if (eventsError) list.push(eventsError);
    if (cfgError) list.push(cfgError);
    return list;
  }, [error, actionError, runError, previewError, eventsError, cfgError]);

  const successMessages = useMemo(() => {
    const list: string[] = [];
    if (cfgOk) list.push(t.configSaved);
    if (runOk) list.push(t.runQueued);
    if (actionOk) list.push(t.actionOk);
    return list;
  }, [cfgOk, runOk, actionOk, t]);

  const doRefresh = useCallback(async () => {
    setActionOk(false);
    setActionError(null);
    setRunOk(false);
    setRunError(null);
    setCfgOk(false);
    setCfgError(null);
    setPreviewError(null);
    await mutate();
  }, [mutate]);

  const loadPreview = useCallback(async () => {
    setPreviewLoading(true);
    setPreviewError(null);
    try {
      const res = await fetchDreamingPreview(20);
      setPreviewItems(res.items ?? []);
    } catch (e) {
      setPreviewError(e instanceof Error ? e.message : String(e));
    } finally {
      setPreviewLoading(false);
    }
  }, []);

  const loadEvents = useCallback(async () => {
    setEventsLoading(true);
    setEventsError(null);
    try {
      const result = await fetchDreamingEvents(50);
      setEvents(result);
    } catch (e) {
      setEventsError(e instanceof Error ? e.message : String(e));
    } finally {
      setEventsLoading(false);
    }
  }, []);

  const doRunNow = useCallback(async (phase: DreamingPhaseId = 'deep') => {
    setRunBusy(true);
    setRunOk(false);
    setRunError(null);
    try {
      await postDreamingRunNow(phase);
      setRunOk(true);
      await mutate();
    } catch (e) {
      setRunError(e instanceof Error ? e.message : String(e));
    } finally {
      setRunBusy(false);
    }
  }, [mutate]);

  const doAction = useCallback(
    async (action: 'reset_store' | 'clear_lock') => {
      setActionBusy(action);
      setActionError(null);
      setActionOk(false);
      try {
        await postDreamingAction(action);
        setActionOk(true);
        await mutate();
      } catch (e) {
        setActionError(e instanceof Error ? e.message : String(e));
      } finally {
        setActionBusy(null);
      }
    },
    [mutate],
  );

  const disabled = !hasToken || isLoading || Boolean(actionBusy);

  const cfgFromGateway = useMemo(() => {
    const rawCfg = cfgData?.payload?.config;
    return normalizeDreamingFromConfig(rawCfg ?? {});
  }, [cfgData]);

  // Hydrate config form when config is loaded/changes.
  useEffect(() => {
    if (!hasToken) return;
    if (!cfgBaseline) {
      setCfgBaseline(cfgFromGateway);
      setCfgForm(cfgFromGateway);
      return;
    }
    // If baseline differs from latest gateway config (e.g. reload), reset.
    const nextJson = JSON.stringify(cfgFromGateway);
    const baseJson = JSON.stringify(cfgBaseline);
    if (nextJson !== baseJson) {
      setCfgBaseline(cfgFromGateway);
      setCfgForm(cfgFromGateway);
    }
  }, [cfgBaseline, cfgFromGateway, hasToken]);

  const cfgDirty = useMemo(() => {
    if (!cfgForm || !cfgBaseline) return false;
    return JSON.stringify(cfgForm) !== JSON.stringify(cfgBaseline);
  }, [cfgForm, cfgBaseline]);

  const saveConfig = useCallback(async () => {
    if (!cfgForm) return;
    setCfgSaving(true);
    setCfgOk(false);
    setCfgError(null);
    try {
      await patchDreamingConfig(cfgForm);
      setCfgBaseline(cfgForm);
      setCfgOk(true);
      await mutate();
    } catch (e) {
      setCfgError(e instanceof Error ? e.message : String(e));
    } finally {
      setCfgSaving(false);
    }
  }, [cfgForm, mutate]);

  const setDreamingEnabled = useCallback(
    async (enabled: boolean) => {
      if (!cfgForm || !hasToken) return;
      const next = { ...cfgForm, enabled };
      const prev = cfgForm;
      setCfgForm(next);
      setEnableSaving(true);
      setCfgOk(false);
      setCfgError(null);
      try {
        await patchDreamingConfig(next);
        setCfgBaseline(next);
        setCfgOk(true);
        await mutate();
      } catch (e) {
        setCfgForm(prev);
        setCfgError(e instanceof Error ? e.message : String(e));
      } finally {
        setEnableSaving(false);
      }
    },
    [cfgForm, hasToken, mutate],
  );

  const dreamingEnabled = cfgForm?.enabled ?? cfgFromGateway.enabled;

  return (
    <div className="mx-auto flex w-full max-w-app-main flex-col gap-4 px-4 py-6">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <h1 className="text-lg font-semibold text-fg">{t.title}</h1>
          <p className="mt-1 text-sm text-fg-muted">{t.subtitle}</p>
        </div>
        <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">
          {cfgForm ? (
            <label
              className={cn(
                'inline-flex cursor-pointer items-center gap-2 rounded-xl border px-3 py-1.5 text-sm transition-colors',
                dreamingEnabled
                  ? 'border-emerald-500/30 bg-emerald-500/5 text-fg'
                  : 'border-edge-subtle bg-surface-panel/50 text-fg-muted',
              )}
            >
              <span className="text-xs font-medium">{t.configEnabled}</span>
              <input
                type="checkbox"
                className="ui-checkbox"
                checked={cfgForm.enabled}
                disabled={!hasToken || cfgSaving || enableSaving}
                onChange={(e) => void setDreamingEnabled(e.target.checked)}
              />
              {enableSaving ? (
                <Loader2 className="size-3.5 animate-spin text-fg-muted" aria-hidden />
              ) : (
                <span
                  className={cn(
                    'text-xs font-semibold',
                    dreamingEnabled ? 'text-emerald-600 dark:text-emerald-400' : '',
                  )}
                >
                  {cfgForm.enabled ? t.on : t.off}
                </span>
              )}
            </label>
          ) : null}
          {dreamingEnabled ? (
            <>
              <select
                className="rounded-lg border border-edge bg-surface-panel px-2 py-1.5 text-xs text-fg"
                value={runPhase}
                onChange={(e) => setRunPhase(e.target.value as DreamingPhaseId)}
                disabled={!hasToken || runBusy}
              >
                <option value="light">Light</option>
                <option value="deep">Deep</option>
                <option value="rem">REM</option>
              </select>
              <Button
                variant="secondary"
                className="px-2.5 py-1.5 text-xs"
                disabled={!hasToken || runBusy}
                onClick={() => void doRunNow(runPhase)}
                title={t.runNowHint}
              >
                {runBusy ? (
                  <Loader2 className="mr-2 size-4 animate-spin" aria-hidden />
                ) : (
                  <Play className="mr-2 size-4" aria-hidden />
                )}
                {t.runNow}
              </Button>
            </>
          ) : null}
          <Button
            variant="secondary"
            className="px-2.5 py-1.5 text-xs"
            disabled={!hasToken}
            onClick={() => void doRefresh()}
          >
            <RefreshCw className="mr-2 size-4" aria-hidden />
            {t.refresh}
          </Button>
        </div>
      </header>

      {errorMessages.length > 0 ? (
        <div
          className="space-y-1.5 rounded-2xl border border-amber-500/20 bg-amber-500/5 px-4 py-3"
          role="alert"
        >
          {errorMessages.map((line, i) => (
            <p key={i} className="text-sm text-amber-800 dark:text-amber-200/90">
              {line}
            </p>
          ))}
        </div>
      ) : null}
      {successMessages.length > 0 ? (
        <div
          className="space-y-1.5 rounded-2xl border border-emerald-500/20 bg-emerald-500/5 px-4 py-3"
          role="status"
        >
          {successMessages.map((line, i) => (
            <p key={i} className="text-sm text-emerald-800 dark:text-emerald-200/90">
              {line}
            </p>
          ))}
        </div>
      ) : null}

      <div className="flex flex-col gap-4">
        <SettingsFormSection className={cn('min-w-0', sectionTightClass)}>
          <SettingsFormSectionHeader
            className={sectionHeaderTightClass}
            icon={Settings2}
            title={t.configTitle}
            subtitle={t.configHint}
            trailing={
              <div className="flex items-center gap-2">
                <Button
                  variant="secondary"
                  className="px-2.5 py-1.5 text-xs"
                  disabled={!hasToken || !cfgForm || cfgSaving || !cfgDirty}
                  onClick={() => void saveConfig()}
                >
                  {cfgSaving ? <Loader2 className="mr-2 size-4 animate-spin" aria-hidden /> : null}
                  {t.saveConfig}
                </Button>
                <Button
                  variant="secondary"
                  className="px-2.5 py-1.5 text-xs"
                  disabled={!hasToken || !cfgForm || cfgSaving || !cfgDirty}
                  onClick={() => {
                    setCfgOk(false);
                    setCfgError(null);
                    setCfgForm(cfgBaseline);
                  }}
                >
                  {t.resetConfig}
                </Button>
              </div>
            }
          />

        {cfgForm ? (
          <div className="space-y-3">
            <div className={phasePanelClass}>
              <div className="grid grid-cols-1 gap-2 lg:grid-cols-12">
                <div className="lg:col-span-9">
                  <ScheduleField
                    kind="cron"
                    label={t.configFrequency}
                    value={cfgForm.frequency}
                    onChange={(frequency) => setCfgForm({ ...cfgForm, frequency })}
                    labels={schedulePickerLabels}
                    disabled={!hasToken || cfgSaving}
                  />
                </div>
                <FieldCell label={t.configTimezone} className="lg:col-span-3">
                  <input
                    className={numInputClass}
                    value={cfgForm.timezone}
                    disabled={!hasToken || cfgSaving}
                    onChange={(e) => setCfgForm({ ...cfgForm, timezone: e.target.value })}
                    placeholder="Asia/Shanghai"
                  />
                </FieldCell>
              </div>
            </div>

            <PhaseConfigPanel
              icon={<Sun className="size-4 text-amber-500" />}
              title={t.configPhaseLight}
              hint={t.configPhaseLightHint}
              enabled={cfgForm.light.enabled}
              onEnabledChange={(enabled) => setCfgForm({ ...cfgForm, light: { ...cfgForm.light, enabled } })}
              cron={cfgForm.light.cron}
              onCronChange={(cron) => setCfgForm({ ...cfgForm, light: { ...cfgForm.light, cron } })}
              scheduleLabels={schedulePickerLabels}
              disabled={!hasToken || cfgSaving}
              onLabel={t.on}
              offLabel={t.off}
              cronLabel={t.configPhaseCron}
            >
              <FieldCell label={t.configLightLookbackDays}>
                <input type="number" step="1" min={1} className={numInputClass} value={cfgForm.light.lookbackDays} disabled={!hasToken || cfgSaving} onChange={(e) => setCfgForm({ ...cfgForm, light: { ...cfgForm.light, lookbackDays: Number(e.target.value) } })} />
              </FieldCell>
              <FieldCell label={t.configLightLimit}>
                <input type="number" step="1" min={0} className={numInputClass} value={cfgForm.light.limit} disabled={!hasToken || cfgSaving} onChange={(e) => setCfgForm({ ...cfgForm, light: { ...cfgForm.light, limit: Number(e.target.value) } })} />
              </FieldCell>
              <FieldCell label={t.configLightDedupe}>
                <input type="number" step="0.01" min={0} max={1} className={numInputClass} value={cfgForm.light.dedupeSimilarity} disabled={!hasToken || cfgSaving} onChange={(e) => setCfgForm({ ...cfgForm, light: { ...cfgForm.light, dedupeSimilarity: Number(e.target.value) } })} />
              </FieldCell>
            </PhaseConfigPanel>

            <PhaseConfigPanel
              icon={<Moon className="size-4 text-indigo-500" />}
              title={t.configPhaseDeep}
              hint={t.configPhaseDeepHint}
              enabled={cfgForm.deep.enabled}
              onEnabledChange={(enabled) => setCfgForm({ ...cfgForm, deep: { ...cfgForm.deep, enabled } })}
              cron={cfgForm.deep.cron}
              onCronChange={(cron) => setCfgForm({ ...cfgForm, deep: { ...cfgForm.deep, cron } })}
              scheduleLabels={schedulePickerLabels}
              disabled={!hasToken || cfgSaving}
              onLabel={t.on}
              offLabel={t.off}
              cronLabel={t.configPhaseCron}
            >
              <FieldCell label={t.configDeepMinScore}>
                <input type="number" step="0.01" min={0} max={1} className={numInputClass} value={cfgForm.deep.minScore} disabled={!hasToken || cfgSaving} onChange={(e) => setCfgForm({ ...cfgForm, deep: { ...cfgForm.deep, minScore: Number(e.target.value) } })} />
              </FieldCell>
              <FieldCell label={t.configDeepMinRecallCount}>
                <input type="number" step="1" min={1} className={numInputClass} value={cfgForm.deep.minRecallCount} disabled={!hasToken || cfgSaving} onChange={(e) => setCfgForm({ ...cfgForm, deep: { ...cfgForm.deep, minRecallCount: Number(e.target.value) } })} />
              </FieldCell>
              <FieldCell label={t.configDeepLimit}>
                <input type="number" step="1" min={0} className={numInputClass} value={cfgForm.deep.limit} disabled={!hasToken || cfgSaving} onChange={(e) => setCfgForm({ ...cfgForm, deep: { ...cfgForm.deep, limit: Number(e.target.value) } })} />
              </FieldCell>
              <FieldCell label={t.configDeepHalfLife}>
                <input type="number" step="1" min={1} className={numInputClass} value={cfgForm.deep.recencyHalfLifeDays} disabled={!hasToken || cfgSaving} onChange={(e) => setCfgForm({ ...cfgForm, deep: { ...cfgForm.deep, recencyHalfLifeDays: Number(e.target.value) } })} />
              </FieldCell>
              <FieldCell label={t.configDeepMaxAge}>
                <input type="number" step="1" min={1} className={numInputClass} value={cfgForm.deep.maxAgeDays} disabled={!hasToken || cfgSaving} onChange={(e) => setCfgForm({ ...cfgForm, deep: { ...cfgForm.deep, maxAgeDays: Number(e.target.value) } })} />
              </FieldCell>
            </PhaseConfigPanel>

            <PhaseConfigPanel
              icon={<Sparkles className="size-4 text-purple-500" />}
              title={t.configPhaseRem}
              hint={t.configPhaseRemHint}
              enabled={cfgForm.rem.enabled}
              onEnabledChange={(enabled) => setCfgForm({ ...cfgForm, rem: { ...cfgForm.rem, enabled } })}
              cron={cfgForm.rem.cron}
              onCronChange={(cron) => setCfgForm({ ...cfgForm, rem: { ...cfgForm.rem, cron } })}
              scheduleLabels={schedulePickerLabels}
              disabled={!hasToken || cfgSaving}
              onLabel={t.on}
              offLabel={t.off}
              cronLabel={t.configPhaseCron}
            >
              <FieldCell label={t.configRemLookbackDays}>
                <input type="number" step="1" min={1} className={numInputClass} value={cfgForm.rem.lookbackDays} disabled={!hasToken || cfgSaving} onChange={(e) => setCfgForm({ ...cfgForm, rem: { ...cfgForm.rem, lookbackDays: Number(e.target.value) } })} />
              </FieldCell>
              <FieldCell label={t.configRemLimit}>
                <input type="number" step="1" min={0} className={numInputClass} value={cfgForm.rem.limit} disabled={!hasToken || cfgSaving} onChange={(e) => setCfgForm({ ...cfgForm, rem: { ...cfgForm.rem, limit: Number(e.target.value) } })} />
              </FieldCell>
              <FieldCell label={t.configRemMinStrength}>
                <input type="number" step="0.01" min={0} max={1} className={numInputClass} value={cfgForm.rem.minPatternStrength} disabled={!hasToken || cfgSaving} onChange={(e) => setCfgForm({ ...cfgForm, rem: { ...cfgForm.rem, minPatternStrength: Number(e.target.value) } })} />
              </FieldCell>
            </PhaseConfigPanel>
          </div>
        ) : (
          <p className="text-sm text-fg-muted">{t.configLoading}</p>
        )}
        </SettingsFormSection>

        <SettingsFormSection className={cn('min-w-0', sectionTightClass)}>
          <SettingsFormSectionHeader
            className={sectionHeaderTightClass}
            icon={Activity}
            title={t.runtimeTitle}
            subtitle={t.runtimeHint}
            trailing={isLoading ? <Loader2 className="size-4 shrink-0 animate-spin text-fg-muted" aria-hidden /> : null}
          />

          <div className="space-y-3">
            <div className={phasePanelClass}>
              <PanelHeading label={t.subsectionSchedule} className="mb-2" />
              <dl className="grid grid-cols-2 gap-x-3 gap-y-2 sm:grid-cols-4">
                <StatCell label={t.enabled}>{data ? (data.config.enabled ? t.on : t.off) : '—'}</StatCell>
                <StatCell label={t.lock}>
                  <span className={lockLabel?.className}>{lockLabel ? lockLabel.text : '—'}</span>
                </StatCell>
                <StatCell label={t.timezone}>{data ? data.config.timezone || '—' : '—'}</StatCell>
                <StatCell label={t.schedule} className="col-span-2 sm:col-span-2">
                  {data ? (
                    <ScheduleSummary
                      kind="cron"
                      expression={data.config.frequency}
                      locale={localeTag}
                      labels={scheduleBadgeLabels}
                      timezone={data.config.timezone || undefined}
                    />
                  ) : (
                    '—'
                  )}
                  {data?.config.frequency ? (
                    <p className="mt-0.5 truncate font-mono text-[0.65rem] text-fg-subtle" title={data.config.frequency}>
                      {data.config.frequency}
                    </p>
                  ) : null}
                </StatCell>
              </dl>
            </div>

            <div className={phasePanelClass}>
              <PanelHeading label={t.subsectionStore} className="mb-2" />
              <dl className="grid grid-cols-2 gap-x-3 gap-y-2 sm:grid-cols-4">
                <StatCell label={t.storeEntries}>{data ? String(data.store.entryCount) : '—'}</StatCell>
                <StatCell label={t.storePromoted}>{data ? String(data.store.promotedCount) : '—'}</StatCell>
                <StatCell label={t.storeUpdatedAt}>{data ? isoShort(data.store.updatedAt) : '—'}</StatCell>
                <StatCell label={t.storeLastPromotedAt}>{data ? isoShort(data.store.lastPromotedAt) : '—'}</StatCell>
              </dl>
            </div>

            {data?.config?.phases ? (
              <div>
                <PanelHeading label={t.subsectionPhases} className="mb-2" />
                <div className="grid gap-2 sm:grid-cols-3">
                  <PhaseStatusCard
                    icon={<Sun className="size-4 text-amber-500" />}
                    label="Light"
                    enabled={data.config.phases.light.enabled}
                    cron={data.config.phases.light.cron}
                    scheduleSummary={formatCronExpressionLabel(
                      data.config.phases.light.cron,
                      localeTag,
                      scheduleBadgeLabels,
                      { timezone: data.config.timezone || undefined },
                    )}
                    details={`lookback=${data.config.phases.light.lookbackDays}d, limit=${data.config.phases.light.limit}, dedupe=${data.config.phases.light.dedupeSimilarity}`}
                    t={t}
                  />
                  <PhaseStatusCard
                    icon={<Moon className="size-4 text-indigo-500" />}
                    label="Deep"
                    enabled={data.config.phases.deep.enabled}
                    cron={data.config.phases.deep.cron}
                    scheduleSummary={formatCronExpressionLabel(
                      data.config.phases.deep.cron,
                      localeTag,
                      scheduleBadgeLabels,
                      { timezone: data.config.timezone || undefined },
                    )}
                    details={`minScore=${data.config.phases.deep.minScore}, recalls≥${data.config.phases.deep.minRecallCount}, limit=${data.config.phases.deep.limit}, halfLife=${data.config.phases.deep.recencyHalfLifeDays}d`}
                    t={t}
                  />
                  <PhaseStatusCard
                    icon={<Sparkles className="size-4 text-purple-500" />}
                    label="REM"
                    enabled={data.config.phases.rem.enabled}
                    cron={data.config.phases.rem.cron}
                    scheduleSummary={formatCronExpressionLabel(
                      data.config.phases.rem.cron,
                      localeTag,
                      scheduleBadgeLabels,
                      { timezone: data.config.timezone || undefined },
                    )}
                    details={`lookback=${data.config.phases.rem.lookbackDays}d, limit=${data.config.phases.rem.limit}, strength≥${data.config.phases.rem.minPatternStrength}`}
                    t={t}
                  />
                </div>
              </div>
            ) : null}

            <div className={phasePanelClass}>
              <PanelHeading label={t.subsectionLastRun} className="mb-2" />
              <p className="mb-2 text-xs text-fg-muted">{t.lastRunBlockHint}</p>
              {data?.lastRun?.exists ? (
                <div className="space-y-2">
                  {data.lastRun.parseError ? (
                    <p className="text-sm text-amber-600 dark:text-amber-400" role="alert">
                      {t.lastRunParseError}
                      {': '}
                      {data.lastRun.parseError}
                    </p>
                  ) : null}
                  {data.lastRun.record ? (
                    <div className="rounded-lg border border-edge-subtle/80 bg-surface-panel/50 p-2.5">
                      <LastRunStructuredView t={t} r={data.lastRun.record} />
                    </div>
                  ) : null}
                  {data.lastRun.raw !== undefined && data.lastRun.raw !== null ? (
                    <details className="group rounded-lg border border-edge-subtle">
                      <summary className="cursor-pointer list-none px-2.5 py-1.5 text-xs font-medium text-fg-muted marker:hidden [&::-webkit-details-marker]:hidden">
                        <span className="underline decoration-edge underline-offset-2 group-open:text-fg">{t.lastRunRaw}</span>
                      </summary>
                      <pre className="max-h-40 overflow-auto border-t border-edge-subtle p-2.5 text-xs text-fg-muted">
                        {JSON.stringify(data.lastRun.raw, null, 2)}
                      </pre>
                    </details>
                  ) : null}
                </div>
              ) : (
                <p className="text-xs text-fg-muted">{t.lastRunEmpty}</p>
              )}
            </div>

            <PhaseLastRunBlock label={t.subsectionLightLastRun} lastRun={data?.lightLastRun} t={t} />
            <PhaseLastRunBlock label={t.subsectionRemLastRun} lastRun={data?.remLastRun} t={t} />
          </div>
        </SettingsFormSection>
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
      <SettingsFormSection className={sectionTightClass}>
        <SettingsFormSectionHeader
          className={sectionHeaderTightClass}
          icon={ScanLine}
          title={t.previewTitle}
          subtitle={t.previewHint}
          trailing={
            <Button
              variant="secondary"
              className="px-2.5 py-1.5 text-xs"
              disabled={!hasToken || previewLoading}
              onClick={() => void loadPreview()}
            >
              {previewLoading ? <Loader2 className="mr-2 size-4 animate-spin" aria-hidden /> : null}
              {t.previewLoad}
            </Button>
          }
        />
        {previewItems ? (
          previewItems.length > 0 ? (
            <div className="space-y-2">
              {previewItems.map((it) => {
                const src = `${it.path}:${it.startLine}-${it.endLine}`;
                const skipped = it.skippedReason;
                return (
                  <div
                    key={`${it.key}:${it.hash}:${src}`}
                    className="rounded-lg border border-edge-subtle bg-surface-panel/60 px-2.5 py-2"
                  >
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-fg-muted">
                      <span className="font-medium text-fg">{src}</span>
                      <span>score={it.score.toFixed(3)}</span>
                      <span>recalls={it.recallCount}</span>
                      <span>avg={it.avgScore.toFixed(3)}</span>
                      <span>decay={it.recencyDecay?.toFixed(3) ?? '—'}</span>
                      {skipped ? (
                        <span className="text-amber-600 dark:text-amber-400">{skipped}</span>
                      ) : (
                        <span className="text-emerald-600 dark:text-emerald-400">{t.previewEligible}</span>
                      )}
                    </div>
                    {it.snippet ? <div className="mt-2 text-sm text-fg">{it.snippet}</div> : null}
                  </div>
                );
              })}
            </div>
          ) : (
            <p className="text-sm text-fg-muted">{t.previewEmpty}</p>
          )
        ) : (
          <p className="text-sm text-fg-muted">{t.previewNotLoaded}</p>
        )}
      </SettingsFormSection>

      <SettingsFormSection className={sectionTightClass}>
        <SettingsFormSectionHeader
          className={sectionHeaderTightClass}
          icon={Activity}
          title={t.eventsTitle}
          subtitle={t.eventsHint}
          trailing={
            <Button
              variant="secondary"
              className="px-2.5 py-1.5 text-xs"
              disabled={!hasToken || eventsLoading}
              onClick={() => void loadEvents()}
            >
              {eventsLoading ? <Loader2 className="mr-2 size-4 animate-spin" aria-hidden /> : null}
              {t.eventsLoad}
            </Button>
          }
        />
        {events ? (
          events.length > 0 ? (
            <div className="space-y-1.5">
              {events.map((ev, idx) => {
                const phaseIcon = ev.phase === 'light' ? '☀️' : ev.phase === 'rem' ? '✨' : '🌙';
                const metrics = ev.phase === 'light'
                  ? `scanned=${ev.scannedEntries ?? 0} new=${ev.newSignals ?? 0} deduped=${ev.deduped ?? 0}`
                  : ev.phase === 'rem'
                    ? `patterns=${ev.patternsDiscovered ?? 0} analyzed=${ev.entriesAnalyzed ?? 0}`
                    : `candidates=${ev.candidates ?? 0} applied=${ev.applied ?? 0}`;
                return (
                  <div
                    key={`${ev.timestamp}:${ev.phase}:${idx}`}
                    className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border border-edge-subtle bg-surface-panel/60 px-3 py-2 text-xs"
                  >
                    <span>{phaseIcon}</span>
                    <span className="font-medium text-fg">{ev.phase}</span>
                    <span className={cn('font-medium', ev.ok ? 'text-emerald-600 dark:text-emerald-400' : 'text-amber-600 dark:text-amber-400')}>
                      {ev.ok ? 'OK' : 'FAIL'}
                    </span>
                    <span className="text-fg-muted">{metrics}</span>
                    <span className="text-fg-muted">{formatDurationMs(ev.durationMs)}</span>
                    <span className="ml-auto text-fg-subtle">{isoShort(ev.timestamp)}</span>
                  </div>
                );
              })}
            </div>
          ) : (
            <p className="text-sm text-fg-muted">{t.eventsEmpty}</p>
          )
        ) : (
          <p className="text-sm text-fg-muted">{t.eventsNotLoaded}</p>
        )}
      </SettingsFormSection>
      </div>

      <SettingsFormSection className={cn('max-w-2xl', sectionTightClass)}>
        <SettingsFormSectionHeader className={sectionHeaderTightClass} icon={Wrench} title={t.maintenanceTitle} subtitle={t.maintenanceHint} />
        <div className="flex flex-col gap-2 sm:flex-row">
          <Button
            variant="secondary"
            disabled={disabled}
            onClick={() => {
              if (!confirm(t.confirmResetStore)) return;
              void doAction('reset_store');
            }}
          >
            {actionBusy === 'reset_store' ? (
              <Loader2 className="mr-2 size-4 animate-spin" aria-hidden />
            ) : (
              <Trash2 className="mr-2 size-4" aria-hidden />
            )}
            {t.resetStore}
          </Button>
          <Button
            variant="secondary"
            disabled={disabled}
            onClick={() => {
              if (!confirm(t.confirmClearLock)) return;
              void doAction('clear_lock');
            }}
          >
            {actionBusy === 'clear_lock' ? (
              <Loader2 className="mr-2 size-4 animate-spin" aria-hidden />
            ) : (
              <Unlock className="mr-2 size-4" aria-hidden />
            )}
            {t.clearLock}
          </Button>
        </div>
      </SettingsFormSection>
    </div>
  );
}
