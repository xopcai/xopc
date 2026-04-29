import { Loader2, Play, RefreshCw, Trash2, Unlock } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import useSWR from 'swr';

import { Button } from '@/components/ui/button';
import { messages } from '@/i18n/messages';
import en from '@/i18n/locales/en.json' with { type: 'json' };
import { useGatewayStore } from '@/stores/gateway-store';
import { useLocaleStore } from '@/stores/locale-store';
import { cn } from '@/lib/cn';
import { SettingsFormSection, settingsFormSectionClassName } from '@/features/settings/settings-form-section';
import {
  dreamingSwrKey,
  fetchDreamingStatus,
  fetchDreamingPreview,
  postDreamingAction,
  postDreamingRunNow,
  type DreamingGatewayStatus,
  type DreamingLastRunRecord,
  type DreamingPreviewItem,
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

type DreamingSettingsI18n = (typeof en)['dreamingSettings'];

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

function lockStatusLabel(s: DreamingGatewayStatus['lock']): { text: string; className: string } {
  if (s.locked) return { text: 'Locked', className: 'text-amber-600 dark:text-amber-400' };
  return { text: 'Unlocked', className: 'text-emerald-600 dark:text-emerald-400' };
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
  const [cfgForm, setCfgForm] = useState<DreamingConfigState | null>(null);
  const [cfgBaseline, setCfgBaseline] = useState<DreamingConfigState | null>(null);
  const [cfgSaving, setCfgSaving] = useState(false);
  const [cfgOk, setCfgOk] = useState(false);
  const [cfgError, setCfgError] = useState<string | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [previewItems, setPreviewItems] = useState<DreamingPreviewItem[] | null>(null);

  const { data, error, isLoading, mutate } = useSWR(hasToken ? dreamingSwrKey() : null, fetchDreamingStatus, {
    revalidateOnFocus: false,
  });

  const lockLabel = useMemo(() => (data ? lockStatusLabel(data.lock) : null), [data]);

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

  const doRunNow = useCallback(async () => {
    setRunBusy(true);
    setRunOk(false);
    setRunError(null);
    try {
      await postDreamingRunNow();
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
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-lg font-semibold text-fg">{t.title}</h1>
          <p className="mt-1 text-sm text-fg-muted">{t.subtitle}</p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="secondary"
            className="px-2.5 py-1.5 text-xs"
            disabled={!hasToken || runBusy}
            onClick={() => void doRunNow()}
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
      </div>

      {error ? (
        <p className="text-sm text-amber-600 dark:text-amber-400" role="alert">
          {error instanceof Error ? error.message : String(error)}
        </p>
      ) : null}
      {actionError ? (
        <p className="text-sm text-amber-600 dark:text-amber-400" role="alert">
          {actionError}
        </p>
      ) : null}
      {runError ? (
        <p className="text-sm text-amber-600 dark:text-amber-400" role="alert">
          {runError}
        </p>
      ) : null}
      {actionOk ? (
        <p className="text-sm text-emerald-600 dark:text-emerald-400" role="status">
          {t.actionOk}
        </p>
      ) : null}
      {runOk ? (
        <p className="text-sm text-emerald-600 dark:text-emerald-400" role="status">
          {t.runQueued}
        </p>
      ) : null}

      {previewError ? (
        <p className="text-sm text-amber-600 dark:text-amber-400" role="alert">
          {previewError}
        </p>
      ) : null}

      {cfgError ? (
        <p className="text-sm text-amber-600 dark:text-amber-400" role="alert">
          {cfgError}
        </p>
      ) : null}

      {cfgOk ? (
        <p className="text-sm text-emerald-600 dark:text-emerald-400" role="status">
          {t.configSaved}
        </p>
      ) : null}

      <SettingsFormSection>
        <div className="mb-4 flex items-start justify-between gap-3">
          <div>
            <div className="text-sm font-semibold text-fg">{t.configTitle}</div>
            <p className="mt-0.5 text-xs text-fg-muted">{t.configHint}</p>
          </div>
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
        </div>

        {cfgForm ? (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
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
              <div className={rowLabelClass()}>{t.configDeepEnabled}</div>
              <label className="mt-2 inline-flex items-center gap-2 text-sm text-fg">
                <input
                  type="checkbox"
                  className="ui-checkbox"
                  checked={cfgForm.deepEnabled}
                  onChange={(e) => setCfgForm({ ...cfgForm, deepEnabled: e.target.checked })}
                />
                <span>{cfgForm.deepEnabled ? t.on : t.off}</span>
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

            <div className={settingsFormSectionClassName()}>
              <div className={rowLabelClass()}>{t.configMinScore}</div>
              <input
                type="number"
                step="0.01"
                min={0}
                max={1}
                className="mt-2 w-full rounded-lg border border-edge bg-surface-panel px-3 py-2 text-sm text-fg dark:border-edge"
                value={cfgForm.minScore}
                onChange={(e) => setCfgForm({ ...cfgForm, minScore: Number(e.target.value) })}
              />
            </div>

            <div className={settingsFormSectionClassName()}>
              <div className={rowLabelClass()}>{t.configMinRecallCount}</div>
              <input
                type="number"
                step="1"
                min={1}
                className="mt-2 w-full rounded-lg border border-edge bg-surface-panel px-3 py-2 text-sm text-fg dark:border-edge"
                value={cfgForm.minRecallCount}
                onChange={(e) => setCfgForm({ ...cfgForm, minRecallCount: Number(e.target.value) })}
              />
            </div>

            <div className={settingsFormSectionClassName()}>
              <div className={rowLabelClass()}>{t.configLimit}</div>
              <input
                type="number"
                step="1"
                min={0}
                className="mt-2 w-full rounded-lg border border-edge bg-surface-panel px-3 py-2 text-sm text-fg dark:border-edge"
                value={cfgForm.limit}
                onChange={(e) => setCfgForm({ ...cfgForm, limit: Number(e.target.value) })}
              />
            </div>
          </div>
        ) : (
          <p className="text-sm text-fg-muted">{t.configLoading}</p>
        )}
      </SettingsFormSection>

      <SettingsFormSection>
        <div className="mb-4 flex items-start justify-between gap-3">
          <div>
            <div className="text-sm font-semibold text-fg">{t.previewTitle}</div>
            <p className="mt-0.5 text-xs text-fg-muted">{t.previewHint}</p>
          </div>
          <Button
            variant="secondary"
            className="px-2.5 py-1.5 text-xs"
            disabled={!hasToken || previewLoading}
            onClick={() => void loadPreview()}
          >
            {previewLoading ? <Loader2 className="mr-2 size-4 animate-spin" aria-hidden /> : null}
            {t.previewLoad}
          </Button>
        </div>

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
                      {skipped ? (
                        <span className="text-amber-600 dark:text-amber-400">{skipped}</span>
                      ) : (
                        <span className="text-emerald-600 dark:text-emerald-400">{t.previewEligible}</span>
                      )}
                    </div>
                    {it.snippet ? (
                      <div className="mt-2 text-sm text-fg">
                        {it.snippet}
                      </div>
                    ) : null}
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
        <div className="mb-4 flex items-center justify-between gap-3">
          <div>
            <div className="text-sm font-semibold text-fg">{t.statusTitle}</div>
            <p className="mt-0.5 text-xs text-fg-muted">{t.statusHint}</p>
          </div>
          {isLoading ? <Loader2 className="size-4 animate-spin text-fg-muted" aria-hidden /> : null}
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div className={settingsFormSectionClassName()}>
            <div className={rowLabelClass()}>{t.enabled}</div>
            <div className={rowValueClass()}>{data ? (data.config.enabled ? t.on : t.off) : '—'}</div>
          </div>
          <div className={settingsFormSectionClassName()}>
            <div className={rowLabelClass()}>{t.schedule}</div>
            <div className={rowValueClass()}>{data ? data.config.frequency : '—'}</div>
          </div>
          <div className={settingsFormSectionClassName()}>
            <div className={rowLabelClass()}>{t.timezone}</div>
            <div className={rowValueClass()}>{data ? data.config.timezone : '—'}</div>
          </div>
          <div className={settingsFormSectionClassName()}>
            <div className={rowLabelClass()}>{t.lock}</div>
            <div className={cn(rowValueClass(), lockLabel?.className)}>{lockLabel ? lockLabel.text : '—'}</div>
          </div>
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

        {data ? (
          <div className="mt-4 text-xs text-fg-muted">
            <div>
              <span className="font-medium text-fg">{t.deepGate}</span>{' '}
              {t.deepGateValue
                .replace('{{minScore}}', String(data.config.deep.minScore))
                .replace('{{minRecallCount}}', String(data.config.deep.minRecallCount))
                .replace('{{limit}}', String(data.config.deep.limit))}
            </div>
          </div>
        ) : null}
      </SettingsFormSection>

      <SettingsFormSection>
        <div className="mb-4">
          <div className="text-sm font-semibold text-fg">{t.lastRunTitle}</div>
          <p className="mt-0.5 text-xs text-fg-muted">{t.lastRunHint}</p>
        </div>
        {data?.lastRun?.exists ? (
          <div className="space-y-3">
            {data.lastRun.parseError ? (
              <p className="text-sm text-amber-600 dark:text-amber-400" role="alert">
                {t.lastRunParseError}
                {': '}
                {data.lastRun.parseError}
              </p>
            ) : null}
            {data.lastRun.record ? <LastRunStructuredView t={t} r={data.lastRun.record} /> : null}
            {data.lastRun.raw !== undefined && data.lastRun.raw !== null ? (
              <div>
                <div className="mb-1 text-xs font-medium text-fg-muted">{t.lastRunRaw}</div>
                <pre className="max-h-[12rem] overflow-auto rounded-xl border border-edge bg-surface-panel/60 p-3 text-xs text-fg-muted">
                  {JSON.stringify(data.lastRun.raw, null, 2)}
                </pre>
              </div>
            ) : null}
          </div>
        ) : (
          <p className="text-sm text-fg-muted">{t.lastRunEmpty}</p>
        )}
      </SettingsFormSection>

      <SettingsFormSection>
        <div className="mb-4">
          <div className="text-sm font-semibold text-fg">{t.maintenanceTitle}</div>
          <p className="mt-0.5 text-xs text-fg-muted">{t.maintenanceHint}</p>
        </div>
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

