import { Activity, Loader2, Moon, Sparkles, Sun } from 'lucide-react';

import { type DreamingGatewayStatus } from '@/features/settings/dreaming-api';
import {
  PanelHeading,
  PhaseStatusCard,
  StatCell,
  type DreamingSettingsI18n,
} from '@/features/settings/dreaming-settings-shared';
import {
  phasePanelClass,
  sectionHeaderTightClass,
  sectionTightClass,
} from '@/features/settings/dreaming-settings-shared.styles';
import { isoShort } from '@/features/settings/dreaming-settings-shared.utils';
import { SettingsFormSection, SettingsFormSectionHeader } from '@/features/settings/settings-form-section';
import { formatCronExpressionLabel, type ScheduleBadgeLabels } from '@/features/scheduling/cron/format-cron-label';
import { ScheduleSummary } from '@/features/scheduling/schedule-summary';
import { cn } from '@/lib/cn';

type Props = {
  t: DreamingSettingsI18n;
  data: DreamingGatewayStatus | undefined;
  isLoading: boolean;
  localeTag: string;
  scheduleBadgeLabels: ScheduleBadgeLabels;
};

export function DreamingRuntimeSection({ t, data, isLoading, localeTag, scheduleBadgeLabels }: Props) {
  return (
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
            <StatCell label={t.lock}>{data?.config.promotionWritePolicy.decision ?? '—'}</StatCell>
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
            <StatCell label={t.storeEntries}>{data ? String(data.store.signalCount) : '—'}</StatCell>
            <StatCell label={t.storePromoted}>{data ? String(data.store.dreamingSignalCount) : '—'}</StatCell>
            <StatCell label={t.storeUpdatedAt}>{data ? isoShort(data.store.lastSignalAt) : '—'}</StatCell>
            <StatCell label={t.storeLastPromotedAt}>{data?.storePath ?? '—'}</StatCell>
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
                details={`lookback=${data.config.phases.light.lookbackDays}d, limit=${data.config.phases.light.limit}`}
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
                details={`minScore=${data.config.phases.deep.minScore}, recalls>=${data.config.phases.deep.minRecallCount}, queries>=${data.config.phases.deep.minUniqueQueries}, limit=${data.config.phases.deep.limit}, halfLife=${data.config.phases.deep.recencyHalfLifeDays}d`}
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
          <p className="mb-2 text-xs text-fg-muted">Structured traces from SQLite.</p>
          {data?.traces?.length ? (
            <pre className="max-h-64 overflow-auto rounded-lg bg-surface-base/50 p-2.5 text-xs text-fg-muted">
              {JSON.stringify(data.traces.slice(0, 10), null, 2)}
            </pre>
          ) : (
            <p className="text-xs text-fg-muted">{t.lastRunEmpty}</p>
          )}
        </div>
      </div>
    </SettingsFormSection>
  );
}
