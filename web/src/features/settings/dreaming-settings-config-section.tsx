import { Info, Loader2, Moon, Play, Sparkles, Sun } from 'lucide-react';

import { Button } from '@/components/ui/button';
import type { DreamingConfigState } from '@/features/settings/dreaming-config-api';
import type { DreamingPhaseId } from '@/features/settings/dreaming-api';
import {
  FieldCell,
  PhaseConfigPanel,
  type DreamingSettingsI18n,
} from '@/features/settings/dreaming-settings-shared';
import {
  numInputClass,
  phasePanelClass,
} from '@/features/settings/dreaming-settings-shared.styles';
import { SettingsFormSection } from '@/features/settings/settings-form-section';
import type { CronSchedulePickerLabels } from '@/features/scheduling/cron/cron-schedule-picker';
import { ScheduleField } from '@/features/scheduling/schedule-field';
import { cn } from '@/lib/cn';

type Props = {
  t: DreamingSettingsI18n;
  schedulePickerLabels: CronSchedulePickerLabels;
  hasToken: boolean;
  cfgForm: DreamingConfigState | null;
  cfgBaseline: DreamingConfigState | null;
  cfgDirty: boolean;
  cfgSaving: boolean;
  runPhase: DreamingPhaseId;
  runBusy: boolean;
  setCfgForm: (next: DreamingConfigState | null | ((prev: DreamingConfigState | null) => DreamingConfigState | null)) => void;
  doRunNow: (phase: DreamingPhaseId) => void | Promise<void>;
};

export function DreamingConfigSection({
  t,
  schedulePickerLabels,
  hasToken,
  cfgForm,
  cfgBaseline,
  cfgDirty,
  cfgSaving,
  runPhase,
  runBusy,
  setCfgForm,
  doRunNow,
}: Props) {
  const phaseRunAction = (phase: DreamingPhaseId, phaseEnabled: boolean) =>
    cfgForm?.enabled ? (
      <PhaseRunButton
        t={t}
        busy={runBusy && runPhase === phase}
        disabled={!hasToken || cfgSaving || runBusy || !phaseEnabled || cfgDirty}
        title={cfgDirty ? t.runNowSaveFirstHint : t.runNowHint}
        onClick={() => {
          void doRunNow(phase);
        }}
      />
    ) : null;

  const phaseDraftState = (phase: DreamingPhaseId) => {
    if (!cfgForm || !cfgBaseline) return null;
    const current = cfgForm[phase];
    const saved = cfgBaseline[phase];
    if (JSON.stringify(current) === JSON.stringify(saved)) return null;
    if (current.enabled !== saved.enabled) {
      return current.enabled ? t.phaseWillEnable : t.phaseWillDisable;
    }
    return t.phasePendingSave;
  };

  return (
    <SettingsFormSection className="min-w-0 !p-0">
      {cfgForm ? (
        <div className="space-y-3">
          <div className={cn(phasePanelClass, 'flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between')}>
            <div className="min-w-0">
              <div className="text-sm font-semibold text-fg">{t.masterTitle}</div>
              <p className="mt-1 text-xs text-fg-subtle">{t.masterHint}</p>
            </div>
            <label
              className={cn(
                'inline-flex w-fit cursor-pointer items-center gap-2 rounded-xl border px-3 py-1.5 text-sm transition-colors',
                cfgForm.enabled
                  ? 'border-emerald-500/30 bg-emerald-500/5 text-fg'
                  : 'border-edge-subtle bg-surface-panel/50 text-fg-muted',
              )}
            >
              <input
                type="checkbox"
                className="ui-checkbox"
                checked={cfgForm.enabled}
                disabled={!hasToken || cfgSaving}
                onChange={(e) => setCfgForm((prev) => (prev ? { ...prev, enabled: e.target.checked } : prev))}
              />
              <span className={cn('text-xs font-semibold', cfgForm.enabled ? 'text-emerald-600 dark:text-emerald-400' : '')}>
                {cfgForm.enabled ? t.masterOn : t.masterOff}
              </span>
            </label>
          </div>

          {cfgDirty ? (
            <div className="flex items-start gap-2 rounded-xl border border-amber-500/25 bg-amber-500/5 px-3 py-2 text-xs text-amber-900 dark:text-amber-100">
              <Info className="mt-0.5 size-3.5 shrink-0" aria-hidden />
              <div className="min-w-0">
                <div className="font-semibold">{t.unsavedConfigTitle}</div>
                <p className="mt-0.5 leading-snug text-amber-800/90 dark:text-amber-100/80">{t.unsavedConfigHint}</p>
              </div>
            </div>
          ) : null}

          <div className="space-y-2">
            <SectionHeading title={t.scheduleTitle} />
            <div className={phasePanelClass}>
              <div className="grid grid-cols-1 gap-2 lg:grid-cols-12">
                <div className="lg:col-span-9">
                  <ScheduleField
                    kind="cron"
                    label={t.configFrequency}
                    value={cfgForm.frequency}
                    onChange={(frequency) => setCfgForm((prev) => (prev ? { ...prev, frequency } : prev))}
                    labels={schedulePickerLabels}
                    disabled={!hasToken || cfgSaving}
                  />
                </div>
                <FieldCell label={t.configTimezone} className="lg:col-span-3">
                  <input
                    className={numInputClass}
                    value={cfgForm.timezone}
                    disabled={!hasToken || cfgSaving}
                    onChange={(e) => setCfgForm((prev) => (prev ? { ...prev, timezone: e.target.value } : prev))}
                    placeholder="Asia/Shanghai"
                  />
                </FieldCell>
              </div>
            </div>
          </div>

          <div className="space-y-2">
            <SectionHeading title={t.phasesTitle} />

            <PhaseConfigPanel
              icon={<Sun className="size-4 text-amber-500" />}
              title={t.configPhaseLight}
              hint={t.configPhaseLightHint}
              enabled={cfgForm.light.enabled}
              onEnabledChange={(enabled) =>
                setCfgForm((prev) => (prev ? { ...prev, light: { ...prev.light, enabled } } : prev))
              }
              cron={cfgForm.light.cron}
              onCronChange={(cron) => setCfgForm((prev) => (prev ? { ...prev, light: { ...prev.light, cron } } : prev))}
              scheduleLabels={schedulePickerLabels}
              disabled={!hasToken || cfgSaving}
              showEnabledControl={cfgForm.enabled}
              actions={phaseRunAction('light', cfgForm.light.enabled)}
              status={phaseDraftState('light') ? <PhasePendingBadge label={phaseDraftState('light') ?? ''} /> : null}
              enabledLabel={phaseDraftState('light') ?? undefined}
              onLabel={t.on}
              offLabel={t.off}
              cronLabel={t.configPhaseCron}
            >
              <FieldCell label={t.configLightLookbackDays}>
                <input
                  type="number"
                  step="1"
                  min={1}
                  className={numInputClass}
                  value={cfgForm.light.lookbackDays}
                  disabled={!hasToken || cfgSaving}
                  onChange={(e) =>
                    setCfgForm((prev) =>
                      prev ? { ...prev, light: { ...prev.light, lookbackDays: Number(e.target.value) } } : prev,
                    )
                  }
                />
              </FieldCell>
              <FieldCell label={t.configLightLimit}>
                <input
                  type="number"
                  step="1"
                  min={0}
                  className={numInputClass}
                  value={cfgForm.light.limit}
                  disabled={!hasToken || cfgSaving}
                  onChange={(e) =>
                    setCfgForm((prev) =>
                      prev ? { ...prev, light: { ...prev.light, limit: Number(e.target.value) } } : prev,
                    )
                  }
                />
              </FieldCell>
            </PhaseConfigPanel>

          <PhaseConfigPanel
            icon={<Moon className="size-4 text-indigo-500" />}
            title={t.configPhaseDeep}
            hint={t.configPhaseDeepHint}
            enabled={cfgForm.deep.enabled}
            onEnabledChange={(enabled) =>
              setCfgForm((prev) => (prev ? { ...prev, deep: { ...prev.deep, enabled } } : prev))
            }
            cron={cfgForm.deep.cron}
            onCronChange={(cron) => setCfgForm((prev) => (prev ? { ...prev, deep: { ...prev.deep, cron } } : prev))}
            scheduleLabels={schedulePickerLabels}
            disabled={!hasToken || cfgSaving}
            showEnabledControl={cfgForm.enabled}
            actions={phaseRunAction('deep', cfgForm.deep.enabled)}
            status={phaseDraftState('deep') ? <PhasePendingBadge label={phaseDraftState('deep') ?? ''} /> : null}
            enabledLabel={phaseDraftState('deep') ?? undefined}
            onLabel={t.on}
            offLabel={t.off}
            cronLabel={t.configPhaseCron}
          >
            <FieldCell label={t.configDeepMinScore}>
              <input
                type="number"
                step="0.01"
                min={0}
                max={1}
                className={numInputClass}
                value={cfgForm.deep.minScore}
                disabled={!hasToken || cfgSaving}
                onChange={(e) =>
                  setCfgForm((prev) =>
                    prev ? { ...prev, deep: { ...prev.deep, minScore: Number(e.target.value) } } : prev,
                  )
                }
              />
            </FieldCell>
            <FieldCell label={t.configDeepMinRecallCount}>
              <input
                type="number"
                step="1"
                min={1}
                className={numInputClass}
                value={cfgForm.deep.minRecallCount}
                disabled={!hasToken || cfgSaving}
                onChange={(e) =>
                  setCfgForm((prev) =>
                    prev ? { ...prev, deep: { ...prev.deep, minRecallCount: Number(e.target.value) } } : prev,
                  )
                }
              />
            </FieldCell>
            <FieldCell label={t.configDeepMinUniqueQueries}>
              <input
                type="number"
                step="1"
                min={1}
                className={numInputClass}
                value={cfgForm.deep.minUniqueQueries}
                disabled={!hasToken || cfgSaving}
                onChange={(e) =>
                  setCfgForm((prev) =>
                    prev ? { ...prev, deep: { ...prev.deep, minUniqueQueries: Number(e.target.value) } } : prev,
                  )
                }
              />
            </FieldCell>
            <FieldCell label={t.configDeepLimit}>
              <input
                type="number"
                step="1"
                min={0}
                className={numInputClass}
                value={cfgForm.deep.limit}
                disabled={!hasToken || cfgSaving}
                onChange={(e) =>
                  setCfgForm((prev) =>
                    prev ? { ...prev, deep: { ...prev.deep, limit: Number(e.target.value) } } : prev,
                  )
                }
              />
            </FieldCell>
            <FieldCell label={t.configDeepHalfLife}>
              <input
                type="number"
                step="1"
                min={1}
                className={numInputClass}
                value={cfgForm.deep.recencyHalfLifeDays}
                disabled={!hasToken || cfgSaving}
                onChange={(e) =>
                  setCfgForm((prev) =>
                    prev
                      ? { ...prev, deep: { ...prev.deep, recencyHalfLifeDays: Number(e.target.value) } }
                      : prev,
                  )
                }
              />
            </FieldCell>
            <FieldCell label={t.configDeepMaxAge}>
              <input
                type="number"
                step="1"
                min={1}
                className={numInputClass}
                value={cfgForm.deep.maxAgeDays}
                disabled={!hasToken || cfgSaving}
                onChange={(e) =>
                  setCfgForm((prev) =>
                    prev ? { ...prev, deep: { ...prev.deep, maxAgeDays: Number(e.target.value) } } : prev,
                  )
                }
              />
            </FieldCell>
          </PhaseConfigPanel>

          <PhaseConfigPanel
            icon={<Sparkles className="size-4 text-purple-500" />}
            title={t.configPhaseRem}
            hint={t.configPhaseRemHint}
            enabled={cfgForm.rem.enabled}
            onEnabledChange={(enabled) =>
              setCfgForm((prev) => (prev ? { ...prev, rem: { ...prev.rem, enabled } } : prev))
            }
            cron={cfgForm.rem.cron}
            onCronChange={(cron) => setCfgForm((prev) => (prev ? { ...prev, rem: { ...prev.rem, cron } } : prev))}
            scheduleLabels={schedulePickerLabels}
            disabled={!hasToken || cfgSaving}
            showEnabledControl={cfgForm.enabled}
            actions={phaseRunAction('rem', cfgForm.rem.enabled)}
            status={phaseDraftState('rem') ? <PhasePendingBadge label={phaseDraftState('rem') ?? ''} /> : null}
            enabledLabel={phaseDraftState('rem') ?? undefined}
            onLabel={t.on}
            offLabel={t.off}
            cronLabel={t.configPhaseCron}
          >
            <FieldCell label={t.configRemLookbackDays}>
              <input
                type="number"
                step="1"
                min={1}
                className={numInputClass}
                value={cfgForm.rem.lookbackDays}
                disabled={!hasToken || cfgSaving}
                onChange={(e) =>
                  setCfgForm((prev) =>
                    prev ? { ...prev, rem: { ...prev.rem, lookbackDays: Number(e.target.value) } } : prev,
                  )
                }
              />
            </FieldCell>
            <FieldCell label={t.configRemLimit}>
              <input
                type="number"
                step="1"
                min={0}
                className={numInputClass}
                value={cfgForm.rem.limit}
                disabled={!hasToken || cfgSaving}
                onChange={(e) =>
                  setCfgForm((prev) =>
                    prev ? { ...prev, rem: { ...prev.rem, limit: Number(e.target.value) } } : prev,
                  )
                }
              />
            </FieldCell>
            <FieldCell label={t.configRemMinStrength}>
              <input
                type="number"
                step="0.01"
                min={0}
                max={1}
                className={numInputClass}
                value={cfgForm.rem.minPatternStrength}
                disabled={!hasToken || cfgSaving}
                onChange={(e) =>
                  setCfgForm((prev) =>
                    prev
                      ? { ...prev, rem: { ...prev.rem, minPatternStrength: Number(e.target.value) } }
                      : prev,
                  )
                }
              />
            </FieldCell>
          </PhaseConfigPanel>
          </div>
        </div>
      ) : (
        <p className="text-sm text-fg-muted">{t.configLoading}</p>
      )}
    </SettingsFormSection>
  );
}

function SectionHeading({ title }: { title: string }) {
  return <div className="px-0.5 text-xs font-semibold uppercase tracking-wide text-fg-muted">{title}</div>;
}

function PhasePendingBadge({ label }: { label: string }) {
  return (
    <span className="inline-flex shrink-0 rounded-md border border-amber-500/25 bg-amber-500/10 px-1.5 py-0.5 text-[0.65rem] font-semibold text-amber-800 dark:text-amber-200">
      {label}
    </span>
  );
}

function PhaseRunButton({
  t,
  busy,
  disabled,
  title,
  onClick,
}: {
  t: DreamingSettingsI18n;
  busy: boolean;
  disabled: boolean;
  title: string;
  onClick: () => void;
}) {
  return (
    <Button
      type="button"
      variant="secondary"
      className="h-7 gap-1.5 rounded-lg px-2 text-xs"
      disabled={disabled}
      title={title}
      onClick={onClick}
    >
      {busy ? <Loader2 className="size-3.5 animate-spin" aria-hidden /> : <Play className="size-3.5" aria-hidden />}
      {t.runNow}
    </Button>
  );
}
