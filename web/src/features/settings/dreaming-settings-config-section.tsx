import { Loader2, Moon, Settings2, Sparkles, Sun } from 'lucide-react';

import { Button } from '@/components/ui/button';
import type { DreamingConfigState } from '@/features/settings/dreaming-config-api';
import {
  FieldCell,
  PhaseConfigPanel,
  numInputClass,
  phasePanelClass,
  sectionHeaderTightClass,
  sectionTightClass,
  type DreamingSettingsI18n,
} from '@/features/settings/dreaming-settings-shared';
import { SettingsFormSection, SettingsFormSectionHeader } from '@/features/settings/settings-form-section';
import type { CronSchedulePickerLabels } from '@/features/scheduling/cron/cron-schedule-picker';
import { ScheduleField } from '@/features/scheduling/schedule-field';
import { cn } from '@/lib/cn';

type Props = {
  t: DreamingSettingsI18n;
  schedulePickerLabels: CronSchedulePickerLabels;
  hasToken: boolean;
  cfgForm: DreamingConfigState | null;
  cfgBaseline: DreamingConfigState | null;
  cfgSaving: boolean;
  cfgDirty: boolean;
  setCfgForm: (next: DreamingConfigState | null | ((prev: DreamingConfigState | null) => DreamingConfigState | null)) => void;
  setCfgOk: (v: boolean) => void;
  setCfgError: (v: string | null) => void;
  saveConfig: () => void | Promise<void>;
};

export function DreamingConfigSection({
  t,
  schedulePickerLabels,
  hasToken,
  cfgForm,
  cfgBaseline,
  cfgSaving,
  cfgDirty,
  setCfgForm,
  setCfgOk,
  setCfgError,
  saveConfig,
}: Props) {
  return (
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
            <FieldCell label={t.configLightDedupe}>
              <input
                type="number"
                step="0.01"
                min={0}
                max={1}
                className={numInputClass}
                value={cfgForm.light.dedupeSimilarity}
                disabled={!hasToken || cfgSaving}
                onChange={(e) =>
                  setCfgForm((prev) =>
                    prev ? { ...prev, light: { ...prev.light, dedupeSimilarity: Number(e.target.value) } } : prev,
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
      ) : (
        <p className="text-sm text-fg-muted">{t.configLoading}</p>
      )}
    </SettingsFormSection>
  );
}
