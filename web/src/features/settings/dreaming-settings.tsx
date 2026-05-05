import { Activity, Loader2, Moon, Play, RefreshCw, ScanLine, Settings2, Sparkles, Sun, Trash2, Unlock, Wrench } from 'lucide-react';
import type { ReactNode } from 'react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import useSWR from 'swr';

import { Button } from '@/components/ui/button';
import { messages, type MessageBundle } from '@/i18n/messages';
import { useGatewayStore } from '@/stores/gateway-store';
import { useLocaleStore } from '@/stores/locale-store';
import { cn } from '@/lib/cn';
import {
  SettingsFormSection,
  settingsFormSectionClassName,
  SettingsFormSectionHeader,
} from '@/features/settings/settings-form-section';
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

function rowLabelClass(): string {
  return 'text-xs font-medium text-fg-muted';
}

function rowValueClass(): string {
  return 'text-sm font-medium text-fg';
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

function Subsection({ label, children, className }: { label: string; children: ReactNode; className?: string }) {
  return (
    <div className={cn('space-y-2', className)}>
      <h3 className="text-[0.7rem] font-semibold uppercase tracking-wider text-fg-muted">{label}</h3>
      {children}
    </div>
  );
}

function PhaseStatusCard({
  icon,
  label,
  enabled,
  cron,
  details,
  t,
}: {
  icon: ReactNode;
  label: string;
  enabled: boolean;
  cron: string;
  details: string;
  t: DreamingSettingsI18n;
}) {
  return (
    <div className={cn(settingsFormSectionClassName(), 'space-y-1.5')}>
      <div className="flex items-center gap-2">
        {icon}
        <span className="text-sm font-medium text-fg">{label}</span>
        <span className={cn('ml-auto text-xs font-medium', enabled ? 'text-emerald-600 dark:text-emerald-400' : 'text-fg-muted')}>
          {enabled ? t.on : t.off}
        </span>
      </div>
      <div className="font-mono text-xs text-fg-muted">{cron}</div>
      <div className="text-xs text-fg-muted">{details}</div>
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
    <Subsection label={label}>
      {lastRun?.exists ? (
        <details className="group rounded-lg border border-edge-subtle">
          <summary className="cursor-pointer list-none px-3 py-2 text-xs font-medium text-fg-muted marker:hidden [&::-webkit-details-marker]:hidden">
            <span className="underline decoration-edge underline-offset-2 group-open:text-fg">{t.lastRunRaw}</span>
          </summary>
          <pre className="max-h-[12rem] overflow-auto border-t border-edge-subtle p-3 text-xs text-fg-muted">
            {JSON.stringify(lastRun.raw, null, 2)}
          </pre>
        </details>
      ) : (
        <p className="text-sm text-fg-muted">{t.phaseLastRunEmpty}</p>
      )}
    </Subsection>
  );
}

function LastRunStructuredView({ t, r }: { t: DreamingSettingsI18n; r: DreamingLastRunRecord }) {
  const s = r.deep?.skipped;
  return (
    <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
      <div className={settingsFormSectionClassName()}>
        <div className={rowLabelClass()}>{t.lastRunStatus}</div>
        <div className={cn(rowValueClass(), r.ok ? 'text-emerald-600 dark:text-emerald-400' : 'text-amber-600 dark:text-amber-400')}>
          {r.ok ? t.lastRunSuccess : t.lastRunFailure}
        </div>
      </div>
      <div className={settingsFormSectionClassName()}>
        <div className={rowLabelClass()}>{t.lastRunDuration}</div>
        <div className={rowValueClass()}>{formatDurationMs(r.durationMs)}</div>
      </div>
      <div className={cn(settingsFormSectionClassName(), 'sm:col-span-2')}>
        <div className={rowLabelClass()}>{t.lastRunReason}</div>
        <div className={rowValueClass()}>{r.reason}</div>
        {r.errorMessage ? (
          <div className="mt-1 text-xs text-amber-600 dark:text-amber-400">{`${t.lastRunError}: ${r.errorMessage}`}</div>
        ) : null}
      </div>
      <div className={settingsFormSectionClassName()}>
        <div className={rowLabelClass()}>{t.lastRunRanked}</div>
        <div className={rowValueClass()}>{String(r.deep?.candidatesRanked ?? '—')}</div>
      </div>
      <div className={settingsFormSectionClassName()}>
        <div className={rowLabelClass()}>{t.lastRunApplied}</div>
        <div className={rowValueClass()}>{String(r.deep?.applied ?? '—')}</div>
      </div>
      {s ? (
        <div className="sm:col-span-2">
          <div className="mb-2 text-xs font-medium text-fg">{t.lastRunSkipped}</div>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <div className={settingsFormSectionClassName()}>
              <div className={rowLabelClass()}>{t.lastRunSkipKey}</div>
              <div className={rowValueClass()}>{String(s.alreadyPromotedKey)}</div>
            </div>
            <div className={settingsFormSectionClassName()}>
              <div className={rowLabelClass()}>{t.lastRunSkipRehydrate}</div>
              <div className={rowValueClass()}>{String(s.rehydrateFailed)}</div>
            </div>
            <div className={settingsFormSectionClassName()}>
              <div className={rowLabelClass()}>{t.lastRunSkipContaminated}</div>
              <div className={rowValueClass()}>{String(s.contaminated)}</div>
            </div>
            <div className={settingsFormSectionClassName()}>
              <div className={rowLabelClass()}>{t.lastRunSkipHash}</div>
              <div className={rowValueClass()}>{String(s.hashDuplicate)}</div>
            </div>
          </div>
        </div>
      ) : null}
    </div>
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

  return (
    <div className="mx-auto flex w-full max-w-app-main flex-col gap-6 px-4 py-8">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <h1 className="text-lg font-semibold text-fg">{t.title}</h1>
          <p className="mt-1 text-sm text-fg-muted">{t.subtitle}</p>
        </div>
        <div className="flex shrink-0 items-center justify-end gap-2">
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

      <div className="flex flex-col gap-6">
        <SettingsFormSection className="min-w-0">
          <SettingsFormSectionHeader
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
          <div className="space-y-5">
            {/* Global settings */}
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <div className={settingsFormSectionClassName()}>
                <div className={rowLabelClass()}>{t.configEnabled}</div>
                <label className="mt-2 inline-flex items-center gap-2 text-sm text-fg">
                  <input
                    type="checkbox"
                    className="ui-checkbox"
                    checked={cfgForm.enabled}
                    onChange={(e) => setCfgForm({ ...cfgForm, enabled: e.target.checked })}
                  />
                  <span>{cfgForm.enabled ? t.on : t.off}</span>
                </label>
              </div>
              <div className={settingsFormSectionClassName()}>
                <div className={rowLabelClass()}>{t.configFrequency}</div>
                <input
                  className="mt-2 w-full rounded-lg border border-edge bg-surface-panel px-3 py-2 text-sm text-fg placeholder:text-fg-subtle dark:border-edge"
                  value={cfgForm.frequency}
                  onChange={(e) => setCfgForm({ ...cfgForm, frequency: e.target.value })}
                  placeholder="0 3 * * *"
                />
              </div>
              <div className={settingsFormSectionClassName()}>
                <div className={rowLabelClass()}>{t.configTimezone}</div>
                <input
                  className="mt-2 w-full rounded-lg border border-edge bg-surface-panel px-3 py-2 text-sm text-fg placeholder:text-fg-subtle dark:border-edge"
                  value={cfgForm.timezone}
                  onChange={(e) => setCfgForm({ ...cfgForm, timezone: e.target.value })}
                  placeholder="Asia/Shanghai"
                />
              </div>
            </div>

            {/* Light Sleep */}
            <Subsection label={t.configPhaseLight}>
              <p className="text-xs text-fg-muted">{t.configPhaseLightHint}</p>
              <div className="mt-2 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <div className={settingsFormSectionClassName()}>
                  <div className={rowLabelClass()}>{t.configPhaseEnabled}</div>
                  <label className="mt-2 inline-flex items-center gap-2 text-sm text-fg">
                    <input type="checkbox" className="ui-checkbox" checked={cfgForm.light.enabled} onChange={(e) => setCfgForm({ ...cfgForm, light: { ...cfgForm.light, enabled: e.target.checked } })} />
                    <span>{cfgForm.light.enabled ? t.on : t.off}</span>
                  </label>
                </div>
                <div className={settingsFormSectionClassName()}>
                  <div className={rowLabelClass()}>{t.configPhaseCron}</div>
                  <input className="mt-2 w-full rounded-lg border border-edge bg-surface-panel px-3 py-2 text-sm text-fg dark:border-edge" value={cfgForm.light.cron} onChange={(e) => setCfgForm({ ...cfgForm, light: { ...cfgForm.light, cron: e.target.value } })} placeholder="0 */6 * * *" />
                </div>
                <div className={settingsFormSectionClassName()}>
                  <div className={rowLabelClass()}>{t.configLightLookbackDays}</div>
                  <input type="number" step="1" min={1} className="mt-2 w-full rounded-lg border border-edge bg-surface-panel px-3 py-2 text-sm text-fg dark:border-edge" value={cfgForm.light.lookbackDays} onChange={(e) => setCfgForm({ ...cfgForm, light: { ...cfgForm.light, lookbackDays: Number(e.target.value) } })} />
                </div>
                <div className={settingsFormSectionClassName()}>
                  <div className={rowLabelClass()}>{t.configLightLimit}</div>
                  <input type="number" step="1" min={0} className="mt-2 w-full rounded-lg border border-edge bg-surface-panel px-3 py-2 text-sm text-fg dark:border-edge" value={cfgForm.light.limit} onChange={(e) => setCfgForm({ ...cfgForm, light: { ...cfgForm.light, limit: Number(e.target.value) } })} />
                </div>
                <div className={settingsFormSectionClassName()}>
                  <div className={rowLabelClass()}>{t.configLightDedupe}</div>
                  <input type="number" step="0.01" min={0} max={1} className="mt-2 w-full rounded-lg border border-edge bg-surface-panel px-3 py-2 text-sm text-fg dark:border-edge" value={cfgForm.light.dedupeSimilarity} onChange={(e) => setCfgForm({ ...cfgForm, light: { ...cfgForm.light, dedupeSimilarity: Number(e.target.value) } })} />
                </div>
              </div>
            </Subsection>

            {/* Deep Sleep */}
            <Subsection label={t.configPhaseDeep}>
              <p className="text-xs text-fg-muted">{t.configPhaseDeepHint}</p>
              <div className="mt-2 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <div className={settingsFormSectionClassName()}>
                  <div className={rowLabelClass()}>{t.configPhaseEnabled}</div>
                  <label className="mt-2 inline-flex items-center gap-2 text-sm text-fg">
                    <input type="checkbox" className="ui-checkbox" checked={cfgForm.deep.enabled} onChange={(e) => setCfgForm({ ...cfgForm, deep: { ...cfgForm.deep, enabled: e.target.checked } })} />
                    <span>{cfgForm.deep.enabled ? t.on : t.off}</span>
                  </label>
                </div>
                <div className={settingsFormSectionClassName()}>
                  <div className={rowLabelClass()}>{t.configPhaseCron}</div>
                  <input className="mt-2 w-full rounded-lg border border-edge bg-surface-panel px-3 py-2 text-sm text-fg dark:border-edge" value={cfgForm.deep.cron} onChange={(e) => setCfgForm({ ...cfgForm, deep: { ...cfgForm.deep, cron: e.target.value } })} placeholder="0 3 * * *" />
                </div>
                <div className={settingsFormSectionClassName()}>
                  <div className={rowLabelClass()}>{t.configDeepMinScore}</div>
                  <input type="number" step="0.01" min={0} max={1} className="mt-2 w-full rounded-lg border border-edge bg-surface-panel px-3 py-2 text-sm text-fg dark:border-edge" value={cfgForm.deep.minScore} onChange={(e) => setCfgForm({ ...cfgForm, deep: { ...cfgForm.deep, minScore: Number(e.target.value) } })} />
                </div>
                <div className={settingsFormSectionClassName()}>
                  <div className={rowLabelClass()}>{t.configDeepMinRecallCount}</div>
                  <input type="number" step="1" min={1} className="mt-2 w-full rounded-lg border border-edge bg-surface-panel px-3 py-2 text-sm text-fg dark:border-edge" value={cfgForm.deep.minRecallCount} onChange={(e) => setCfgForm({ ...cfgForm, deep: { ...cfgForm.deep, minRecallCount: Number(e.target.value) } })} />
                </div>
                <div className={settingsFormSectionClassName()}>
                  <div className={rowLabelClass()}>{t.configDeepLimit}</div>
                  <input type="number" step="1" min={0} className="mt-2 w-full rounded-lg border border-edge bg-surface-panel px-3 py-2 text-sm text-fg dark:border-edge" value={cfgForm.deep.limit} onChange={(e) => setCfgForm({ ...cfgForm, deep: { ...cfgForm.deep, limit: Number(e.target.value) } })} />
                </div>
                <div className={settingsFormSectionClassName()}>
                  <div className={rowLabelClass()}>{t.configDeepHalfLife}</div>
                  <input type="number" step="1" min={1} className="mt-2 w-full rounded-lg border border-edge bg-surface-panel px-3 py-2 text-sm text-fg dark:border-edge" value={cfgForm.deep.recencyHalfLifeDays} onChange={(e) => setCfgForm({ ...cfgForm, deep: { ...cfgForm.deep, recencyHalfLifeDays: Number(e.target.value) } })} />
                </div>
                <div className={settingsFormSectionClassName()}>
                  <div className={rowLabelClass()}>{t.configDeepMaxAge}</div>
                  <input type="number" step="1" min={1} className="mt-2 w-full rounded-lg border border-edge bg-surface-panel px-3 py-2 text-sm text-fg dark:border-edge" value={cfgForm.deep.maxAgeDays} onChange={(e) => setCfgForm({ ...cfgForm, deep: { ...cfgForm.deep, maxAgeDays: Number(e.target.value) } })} />
                </div>
              </div>
            </Subsection>

            {/* REM Sleep */}
            <Subsection label={t.configPhaseRem}>
              <p className="text-xs text-fg-muted">{t.configPhaseRemHint}</p>
              <div className="mt-2 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <div className={settingsFormSectionClassName()}>
                  <div className={rowLabelClass()}>{t.configPhaseEnabled}</div>
                  <label className="mt-2 inline-flex items-center gap-2 text-sm text-fg">
                    <input type="checkbox" className="ui-checkbox" checked={cfgForm.rem.enabled} onChange={(e) => setCfgForm({ ...cfgForm, rem: { ...cfgForm.rem, enabled: e.target.checked } })} />
                    <span>{cfgForm.rem.enabled ? t.on : t.off}</span>
                  </label>
                </div>
                <div className={settingsFormSectionClassName()}>
                  <div className={rowLabelClass()}>{t.configPhaseCron}</div>
                  <input className="mt-2 w-full rounded-lg border border-edge bg-surface-panel px-3 py-2 text-sm text-fg dark:border-edge" value={cfgForm.rem.cron} onChange={(e) => setCfgForm({ ...cfgForm, rem: { ...cfgForm.rem, cron: e.target.value } })} placeholder="0 5 * * 0" />
                </div>
                <div className={settingsFormSectionClassName()}>
                  <div className={rowLabelClass()}>{t.configRemLookbackDays}</div>
                  <input type="number" step="1" min={1} className="mt-2 w-full rounded-lg border border-edge bg-surface-panel px-3 py-2 text-sm text-fg dark:border-edge" value={cfgForm.rem.lookbackDays} onChange={(e) => setCfgForm({ ...cfgForm, rem: { ...cfgForm.rem, lookbackDays: Number(e.target.value) } })} />
                </div>
                <div className={settingsFormSectionClassName()}>
                  <div className={rowLabelClass()}>{t.configRemLimit}</div>
                  <input type="number" step="1" min={0} className="mt-2 w-full rounded-lg border border-edge bg-surface-panel px-3 py-2 text-sm text-fg dark:border-edge" value={cfgForm.rem.limit} onChange={(e) => setCfgForm({ ...cfgForm, rem: { ...cfgForm.rem, limit: Number(e.target.value) } })} />
                </div>
                <div className={settingsFormSectionClassName()}>
                  <div className={rowLabelClass()}>{t.configRemMinStrength}</div>
                  <input type="number" step="0.01" min={0} max={1} className="mt-2 w-full rounded-lg border border-edge bg-surface-panel px-3 py-2 text-sm text-fg dark:border-edge" value={cfgForm.rem.minPatternStrength} onChange={(e) => setCfgForm({ ...cfgForm, rem: { ...cfgForm.rem, minPatternStrength: Number(e.target.value) } })} />
                </div>
              </div>
            </Subsection>
          </div>
        ) : (
          <p className="text-sm text-fg-muted">{t.configLoading}</p>
        )}
        </SettingsFormSection>

        <SettingsFormSection className="min-w-0">
          <SettingsFormSectionHeader
            icon={Activity}
            title={t.runtimeTitle}
            subtitle={t.runtimeHint}
            trailing={isLoading ? <Loader2 className="size-4 shrink-0 animate-spin text-fg-muted" aria-hidden /> : null}
          />

          <div className="space-y-6">
            <Subsection label={t.subsectionSchedule}>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                <div className={settingsFormSectionClassName()}>
                  <div className={rowLabelClass()}>{t.enabled}</div>
                  <div className={rowValueClass()}>{data ? (data.config.enabled ? t.on : t.off) : '—'}</div>
                </div>
                <div className={settingsFormSectionClassName()}>
                  <div className={rowLabelClass()}>{t.lock}</div>
                  <div className={cn(rowValueClass(), lockLabel?.className)}>{lockLabel ? lockLabel.text : '—'}</div>
                </div>
                <div className={cn(settingsFormSectionClassName(), 'sm:col-span-2')}>
                  <div className={rowLabelClass()}>{t.schedule}</div>
                  <div className="mt-1 break-all font-mono text-sm text-fg">{data ? data.config.frequency : '—'}</div>
                </div>
                <div className={settingsFormSectionClassName()}>
                  <div className={rowLabelClass()}>{t.timezone}</div>
                  <div className={rowValueClass()}>{data ? data.config.timezone : '—'}</div>
                </div>
              </div>
            </Subsection>

            <Subsection label={t.subsectionStore}>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                <div className={settingsFormSectionClassName()}>
                  <div className={rowLabelClass()}>{t.storeEntries}</div>
                  <div className={rowValueClass()}>{data ? String(data.store.entryCount) : '—'}</div>
                </div>
                <div className={settingsFormSectionClassName()}>
                  <div className={rowLabelClass()}>{t.storePromoted}</div>
                  <div className={rowValueClass()}>{data ? String(data.store.promotedCount) : '—'}</div>
                </div>
                <div className={settingsFormSectionClassName()}>
                  <div className={rowLabelClass()}>{t.storeUpdatedAt}</div>
                  <div className={rowValueClass()}>{data ? isoShort(data.store.updatedAt) : '—'}</div>
                </div>
                <div className={settingsFormSectionClassName()}>
                  <div className={rowLabelClass()}>{t.storeLastPromotedAt}</div>
                  <div className={rowValueClass()}>{data ? isoShort(data.store.lastPromotedAt) : '—'}</div>
                </div>
              </div>
            </Subsection>

            {data?.config?.phases ? (
              <Subsection label={t.subsectionPhases}>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                  <PhaseStatusCard
                    icon={<Sun className="size-4 text-amber-500" />}
                    label="Light"
                    enabled={data.config.phases.light.enabled}
                    cron={data.config.phases.light.cron}
                    details={`lookback=${data.config.phases.light.lookbackDays}d, limit=${data.config.phases.light.limit}, dedupe=${data.config.phases.light.dedupeSimilarity}`}
                    t={t}
                  />
                  <PhaseStatusCard
                    icon={<Moon className="size-4 text-indigo-500" />}
                    label="Deep"
                    enabled={data.config.phases.deep.enabled}
                    cron={data.config.phases.deep.cron}
                    details={`minScore=${data.config.phases.deep.minScore}, recalls≥${data.config.phases.deep.minRecallCount}, limit=${data.config.phases.deep.limit}, halfLife=${data.config.phases.deep.recencyHalfLifeDays}d`}
                    t={t}
                  />
                  <PhaseStatusCard
                    icon={<Sparkles className="size-4 text-purple-500" />}
                    label="REM"
                    enabled={data.config.phases.rem.enabled}
                    cron={data.config.phases.rem.cron}
                    details={`lookback=${data.config.phases.rem.lookbackDays}d, limit=${data.config.phases.rem.limit}, strength≥${data.config.phases.rem.minPatternStrength}`}
                    t={t}
                  />
                </div>
              </Subsection>
            ) : null}

            <Subsection label={t.subsectionLastRun}>
              <p className="mb-2 text-xs text-fg-muted">{t.lastRunBlockHint}</p>
              {data?.lastRun?.exists ? (
                <div className="space-y-3">
                  {data.lastRun.parseError ? (
                    <p className="text-sm text-amber-600 dark:text-amber-400" role="alert">
                      {t.lastRunParseError}
                      {': '}
                      {data.lastRun.parseError}
                    </p>
                  ) : null}
                  {data.lastRun.record ? (
                    <div className="rounded-xl border border-edge-subtle bg-surface-panel/40 p-2 sm:p-3">
                      <LastRunStructuredView t={t} r={data.lastRun.record} />
                    </div>
                  ) : null}
                  {data.lastRun.raw !== undefined && data.lastRun.raw !== null ? (
                    <details className="group rounded-lg border border-edge-subtle">
                      <summary className="cursor-pointer list-none px-3 py-2 text-xs font-medium text-fg-muted marker:hidden [&::-webkit-details-marker]:hidden">
                        <span className="underline decoration-edge underline-offset-2 group-open:text-fg">{t.lastRunRaw}</span>
                      </summary>
                      <pre className="max-h-[12rem] overflow-auto border-t border-edge-subtle p-3 text-xs text-fg-muted">
                        {JSON.stringify(data.lastRun.raw, null, 2)}
                      </pre>
                    </details>
                  ) : null}
                </div>
              ) : (
                <p className="text-sm text-fg-muted">{t.lastRunEmpty}</p>
              )}
            </Subsection>

            <PhaseLastRunBlock label={t.subsectionLightLastRun} lastRun={data?.lightLastRun} t={t} />
            <PhaseLastRunBlock label={t.subsectionRemLastRun} lastRun={data?.remLastRun} t={t} />
          </div>
        </SettingsFormSection>
      </div>

      <SettingsFormSection>
        <SettingsFormSectionHeader
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
                    className="rounded-xl border border-edge-subtle bg-surface-panel/60 px-3 py-3"
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

      <SettingsFormSection>
        <SettingsFormSectionHeader
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

      <SettingsFormSection className="max-w-2xl">
        <SettingsFormSectionHeader icon={Wrench} title={t.maintenanceTitle} subtitle={t.maintenanceHint} />
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

