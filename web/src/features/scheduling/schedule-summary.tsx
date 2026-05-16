import {
  formatCronExpressionLabel,
  type ScheduleBadgeLabels,
} from '@/features/scheduling/cron/format-cron-label';
import {
  formatIntervalMsLabel,
  type IntervalPresetLabels,
} from '@/features/scheduling/interval/format-interval-label';

type ScheduleSummaryShell = {
  locale: string;
  className?: string;
};

export type CronScheduleSummaryProps = ScheduleSummaryShell & {
  kind: 'cron';
  expression: string;
  labels: ScheduleBadgeLabels;
  timezone?: string;
  nextRun?: string | null;
};

export type IntervalScheduleSummaryProps = ScheduleSummaryShell & {
  kind: 'interval';
  valueMs: number;
  presetLabels?: IntervalPresetLabels;
};

export type ScheduleSummaryProps = CronScheduleSummaryProps | IntervalScheduleSummaryProps;

export function ScheduleSummary(props: ScheduleSummaryProps) {
  const text =
    props.kind === 'cron'
      ? formatCronExpressionLabel(props.expression, props.locale, props.labels, {
          timezone: props.timezone,
          nextRun: props.nextRun,
        })
      : formatIntervalMsLabel(props.valueMs, props.locale, props.presetLabels);

  return <span className={props.className}>{text}</span>;
}
