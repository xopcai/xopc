import { ChevronRight, Info, Loader2 } from 'lucide-react';
import type { MutableRefObject } from 'react';
import { Link } from 'react-router-dom';

import { Button } from '@/components/ui/button';
import type { CronJob } from '@/features/cron/cron-api';
import { CronJobCard } from '@/features/cron/cron-job-card';
import type { HeartbeatSettingsState } from '@/features/settings/heartbeat-settings.types';
import { formatIntervalMsLabel } from '@/features/scheduling/interval/format-interval-label';
import { messages, type MessageBundle } from '@/i18n/messages';
import type { StoredLanguage } from '@/lib/storage';
import { cn } from '@/lib/cn';

type CronCopy = MessageBundle['cron'];

export type CronSystemTasksPanelProps = {
  c: CronCopy;
  language: StoredLanguage;
  localeTag: string;
  scheduleBadgeLabels: CronCopy['scheduleBadge'];
  loading: boolean;
  sortedSystemJobs: CronJob[];
  heartbeat: HeartbeatSettingsState;
  keepAwake: boolean;
  wakeSupported: boolean;
  onWakeUnsupportedClick: () => void;
  onKeepAwakeToggle: () => void;
  absorbCardClickJobIdRef: MutableRefObject<string | null>;
  scheduleAbsorbNextMenuCardClick: (jobId: string) => void;
  onOpenDetail: (job: CronJob) => void;
  onToggle: (job: CronJob, enabled: boolean) => void;
  onEdit: (job: CronJob) => void;
  onRunNow: (job: CronJob) => void;
  onDelete: (job: CronJob) => void;
};

export function CronSystemTasksPanel({
  c,
  language,
  localeTag,
  scheduleBadgeLabels,
  loading,
  sortedSystemJobs,
  heartbeat,
  keepAwake,
  wakeSupported,
  onWakeUnsupportedClick,
  onKeepAwakeToggle,
  absorbCardClickJobIdRef,
  scheduleAbsorbNextMenuCardClick,
  onOpenDetail,
  onToggle,
  onEdit,
  onRunNow,
  onDelete,
}: CronSystemTasksPanelProps) {
  const hbInterval = formatIntervalMsLabel(
    heartbeat.intervalMs,
    localeTag,
    messages(language).heartbeatSettings.intervalPresets,
  );

  return (
    <section aria-labelledby="cron-system-tasks-panel" className="flex flex-col gap-4">
      <h2 id="cron-system-tasks-panel" className="sr-only">
        {c.tabSystemTasks}
      </h2>
      <p className="text-sm text-fg-muted">{c.systemTasksIntro}</p>

      <div className="flex flex-col gap-3 rounded-xl border border-accent/25 bg-accent/5 px-4 py-3 dark:border-accent/30 dark:bg-accent/10 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex gap-3 text-sm text-fg">
          <Info className="mt-0.5 size-4 shrink-0 text-accent" strokeWidth={1.75} aria-hidden />
          <p className="text-pretty text-fg-muted">{c.wakeBanner}</p>
        </div>
        <div className="flex shrink-0 items-center gap-2 sm:pl-4">
          <span className="text-sm text-fg">{c.keepAwake}</span>
          <button
            type="button"
            role="switch"
            aria-checked={keepAwake}
            disabled={!wakeSupported}
            title={!wakeSupported ? c.wakeLockUnavailable : undefined}
            className={cn(
              'inline-flex h-6 w-10 shrink-0 items-center rounded-full border border-edge p-0.5 transition-colors',
              keepAwake ? 'justify-end bg-accent' : 'justify-start bg-surface-hover',
              !wakeSupported && 'cursor-not-allowed opacity-50',
            )}
            onClick={() => {
              if (!wakeSupported) onWakeUnsupportedClick();
              else onKeepAwakeToggle();
            }}
          >
            <span className="size-4 rounded-full bg-surface-panel shadow-surface ring-1 ring-edge/40 dark:ring-edge/55" />
          </button>
        </div>
      </div>

      <div className="rounded-xl border border-edge bg-surface-base p-4 dark:bg-surface-hover/20">
        <div className="flex flex-col gap-1 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h3 className="text-sm font-semibold text-fg">{c.systemHeartbeatTitle}</h3>
            <p className="mt-1 text-xs text-fg-muted">{c.systemHeartbeatHint}</p>
          </div>
          <Button type="button" variant="ghost" className="shrink-0 gap-1 self-start px-2 py-1.5 text-xs" asChild>
            <Link to="/settings/heartbeat">
              {c.systemHeartbeatSettingsLink}
              <ChevronRight className="size-3.5 opacity-70" aria-hidden />
            </Link>
          </Button>
        </div>
        <dl className="mt-3 grid gap-2 text-sm sm:grid-cols-2">
          <div>
            <dt className="text-xs font-medium text-fg-muted">{c.systemHeartbeatStatus}</dt>
            <dd className="text-fg">{heartbeat.enabled ? c.enabled : c.disabled}</dd>
          </div>
          <div>
            <dt className="text-xs font-medium text-fg-muted">{c.systemHeartbeatInterval}</dt>
            <dd className="text-fg">{c.systemHeartbeatEvery.replace(/\{\{value\}\}/g, hbInterval)}</dd>
          </div>
        </dl>
      </div>

      <div>
        <div className="mb-2 flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
          <h3 className="text-sm font-semibold text-fg">{c.systemDreamingTitle}</h3>
          <Button type="button" variant="ghost" className="shrink-0 gap-1 self-start px-2 py-1.5 text-xs" asChild>
            <Link to="/settings/dreams">
              {c.systemDreamingSettingsLink}
              <ChevronRight className="size-3.5 opacity-70" aria-hidden />
            </Link>
          </Button>
        </div>
        <p className="mb-3 text-xs text-fg-muted">{c.systemDreamingHint}</p>
        {loading && sortedSystemJobs.length === 0 ? (
          <div className="flex justify-center py-12" aria-busy="true">
            <Loader2 className="size-8 animate-spin text-accent" strokeWidth={1.75} />
          </div>
        ) : sortedSystemJobs.length === 0 ? (
          <p className="rounded-lg border border-edge-subtle bg-surface-hover/30 px-3 py-4 text-sm text-fg-muted dark:border-edge-subtle">
            {c.systemDreamingEmpty}
          </p>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2">
            {sortedSystemJobs.map((job) => (
              <CronJobCard
                key={job.id}
                job={job}
                c={c}
                localeTag={localeTag}
                scheduleBadgeLabels={scheduleBadgeLabels}
                absorbCardClickJobIdRef={absorbCardClickJobIdRef}
                scheduleAbsorbNextMenuCardClick={scheduleAbsorbNextMenuCardClick}
                onOpenDetail={onOpenDetail}
                onToggle={onToggle}
                onEdit={onEdit}
                onRunNow={onRunNow}
                onDelete={onDelete}
              />
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
