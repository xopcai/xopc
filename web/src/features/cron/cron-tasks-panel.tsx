import { Info, Loader2 } from 'lucide-react';
import type { MutableRefObject } from 'react';

import { Button } from '@/components/ui/button';
import type { CronJob } from '@/features/cron/cron-api';
import { CronJobCard } from '@/features/cron/cron-job-card';
import type { CronTemplateFilter } from '@/features/cron/cron-template-library';
import { CronTemplateLibrary } from '@/features/cron/cron-template-library';
import type { MessageBundle } from '@/i18n/messages';
import { cn } from '@/lib/cn';

type CronCopy = MessageBundle['cron'];

export type CronTasksPanelProps = {
  c: CronCopy;
  localeTag: string;
  scheduleBadgeLabels: CronCopy['scheduleBadge'];
  loading: boolean;
  jobsCount: number;
  sortedJobs: CronJob[];
  templateCategoryFilter: CronTemplateFilter;
  onTemplateCategoryFilterChange: (v: CronTemplateFilter) => void;
  onSelectTemplate: (templateId: string) => void;
  keepAwake: boolean;
  wakeSupported: boolean;
  onWakeUnsupportedClick: () => void;
  onKeepAwakeToggle: () => void;
  absorbCardClickJobIdRef: MutableRefObject<string | null>;
  scheduleAbsorbNextMenuCardClick: (jobId: string) => void;
  onOpenDetail: (job: CronJob) => void;
  onToggle: (job: CronJob, enabled: boolean) => void;
  onEdit: (job: CronJob) => void;
  onAddJob: () => void;
  onRunNow: (job: CronJob) => void;
  onDelete: (job: CronJob) => void;
};

export function CronTasksPanel({
  c,
  localeTag,
  scheduleBadgeLabels,
  loading,
  jobsCount,
  sortedJobs,
  templateCategoryFilter,
  onTemplateCategoryFilterChange,
  onSelectTemplate,
  keepAwake,
  wakeSupported,
  onWakeUnsupportedClick,
  onKeepAwakeToggle,
  absorbCardClickJobIdRef,
  scheduleAbsorbNextMenuCardClick,
  onOpenDetail,
  onToggle,
  onEdit,
  onAddJob,
  onRunNow,
  onDelete,
}: CronTasksPanelProps) {
  return (
    <section aria-labelledby="cron-tasks-panel" className="flex flex-col gap-4">
      <h2 id="cron-tasks-panel" className="sr-only">
        {c.tabMyTasks}
      </h2>
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

      {loading && jobsCount === 0 ? (
        <div className="flex justify-center py-16" aria-busy="true">
          <Loader2 className="size-8 animate-spin text-accent" strokeWidth={1.75} />
        </div>
      ) : jobsCount === 0 ? (
        <div className="flex flex-col gap-6 rounded-2xl bg-surface-base px-4 py-8 dark:bg-surface-hover/25 sm:px-6 sm:py-10">
          <div className="w-full max-w-6xl">
            <CronTemplateLibrary
              cron={c}
              localeTag={localeTag}
              scheduleBadgeLabels={scheduleBadgeLabels}
              categoryFilter={templateCategoryFilter}
              onCategoryFilterChange={onTemplateCategoryFilterChange}
              onSelectTemplate={onSelectTemplate}
            />
          </div>
          <div className="flex justify-center">
            <Button type="button" variant="primary" onClick={onAddJob}>
              {c.emptyStateCta}
            </Button>
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-[repeat(auto-fill,minmax(280px,1fr))]">
          {sortedJobs.map((job) => (
            <CronJobCard
              key={job.id}
              job={job}
              c={c}
              localeTag={localeTag}
              scheduleBadgeLabels={scheduleBadgeLabels}
              absorbCardClickJobIdRef={absorbCardClickJobIdRef}
              scheduleAbsorbNextMenuCardClick={scheduleAbsorbNextMenuCardClick}
              onOpenDetail={(j) => void onOpenDetail(j)}
              onToggle={(j, en) => void onToggle(j, en)}
              onEdit={onEdit}
              onRunNow={onRunNow}
              onDelete={onDelete}
            />
          ))}
        </div>
      )}
    </section>
  );
}
