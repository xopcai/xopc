import type { ReactNode } from 'react';

import {
  type DreamingLastRunRecord,
  type PhaseLastRun,
} from '@/features/settings/dreaming-api';
import { phasePanelClass } from '@/features/settings/dreaming-settings-shared.styles';
import { formatDurationMs } from '@/features/settings/dreaming-settings-shared.utils';
import type { CronSchedulePickerLabels } from '@/features/scheduling/cron/cron-schedule-picker';
import { ScheduleField } from '@/features/scheduling/schedule-field';
import type { MessageBundle } from '@/i18n/messages';
import { cn } from '@/lib/cn';

export type DreamingSettingsI18n = MessageBundle['dreamingSettings'];

const rowLabelClass = 'text-xs font-medium text-fg-muted';
const rowValueClass = 'text-sm font-medium text-fg';

export function FieldCell({
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
      <span className={rowLabelClass}>{label}</span>
      {children}
    </div>
  );
}

export function StatCell({
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
      <dt className={rowLabelClass}>{label}</dt>
      <dd className={cn(rowValueClass, 'mt-0.5')}>{children}</dd>
    </div>
  );
}

export function PanelHeading({ label, className }: { label: string; className?: string }) {
  return (
    <h3 className={cn('text-[0.7rem] font-semibold uppercase tracking-wider text-fg-muted', className)}>{label}</h3>
  );
}

export function PhaseConfigPanel({
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

export function PhaseStatusCard({
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

export function PhaseLastRunBlock({
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

export function LastRunStructuredView({ t, r }: { t: DreamingSettingsI18n; r: DreamingLastRunRecord }) {
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
