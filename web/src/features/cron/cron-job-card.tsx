import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import { Clock, MoreVertical } from 'lucide-react';

import { MarkdownView } from '@/components/markdown/markdown-view';
import { Button } from '@/components/ui/button';
import type { MutableRefObject } from 'react';

import type { CronJob } from '@/features/cron/cron-api';
import { cronJobBodyText } from '@/features/cron/cron-api';
import { formatScheduleBadge } from '@/features/cron/cron-utils';
import type { MessageBundle } from '@/i18n/messages';
import { cn } from '@/lib/cn';

type CronCopy = MessageBundle['cron'];

export type CronJobCardProps = {
  job: CronJob;
  c: CronCopy;
  localeTag: string;
  scheduleBadgeLabels: CronCopy['scheduleBadge'];
  absorbCardClickJobIdRef: MutableRefObject<string | null>;
  scheduleAbsorbNextMenuCardClick: (jobId: string) => void;
  onOpenDetail: (job: CronJob) => void;
  onToggle: (job: CronJob, enabled: boolean) => void;
  onEdit: (job: CronJob) => void;
  onRunNow: (job: CronJob) => void;
  onDelete: (job: CronJob) => void;
};

export function CronJobCard({
  job,
  c,
  localeTag,
  scheduleBadgeLabels,
  absorbCardClickJobIdRef,
  scheduleAbsorbNextMenuCardClick,
  onOpenDetail,
  onToggle,
  onEdit,
  onRunNow,
  onDelete,
}: CronJobCardProps) {
  return (
    <article
      role="button"
      tabIndex={0}
      className={cn(
        'flex h-full min-h-0 cursor-pointer flex-col rounded-xl border border-edge-subtle bg-surface-base text-left transition-colors duration-150 ease-out dark:border-edge-subtle',
        'hover:bg-surface-hover',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-surface-panel',
      )}
      onClick={() => {
        if (absorbCardClickJobIdRef.current === job.id) {
          absorbCardClickJobIdRef.current = null;
          return;
        }
        void onOpenDetail(job);
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          if (absorbCardClickJobIdRef.current === job.id) {
            absorbCardClickJobIdRef.current = null;
            return;
          }
          void onOpenDetail(job);
        }
      }}
    >
      <div className="flex items-start justify-between gap-2 px-4 pt-3">
        <button
          type="button"
          role="switch"
          aria-checked={job.enabled}
          className={cn(
            'inline-flex h-6 w-10 shrink-0 items-center rounded-full border border-edge p-0.5 transition-colors',
            job.enabled ? 'justify-end bg-accent' : 'justify-start bg-surface-hover',
          )}
          onClick={(e) => {
            e.stopPropagation();
            void onToggle(job, !job.enabled);
          }}
        >
          <span className="size-4 rounded-full bg-surface-panel shadow-surface ring-1 ring-edge/40 dark:ring-edge/55" />
        </button>
        <DropdownMenu.Root>
          <DropdownMenu.Trigger asChild>
            <Button
              type="button"
              variant="ghost"
              className="size-8 shrink-0 p-0"
              aria-label={c.jobCardMenuAria}
              onClick={(e) => e.stopPropagation()}
            >
              <MoreVertical className="size-4" strokeWidth={1.75} />
            </Button>
          </DropdownMenu.Trigger>
          <DropdownMenu.Portal>
            <DropdownMenu.Content
              className="z-50 min-w-[10rem] rounded-xl border border-edge-subtle bg-surface-panel p-1 shadow-elevated dark:border-edge-subtle"
              sideOffset={4}
              align="end"
              onCloseAutoFocus={(e) => e.preventDefault()}
            >
              <DropdownMenu.Item
                className="cursor-pointer select-none rounded-lg px-2 py-1.5 text-sm text-fg outline-none data-highlighted:bg-surface-hover"
                onSelect={() => {
                  scheduleAbsorbNextMenuCardClick(job.id);
                  onEdit(job);
                }}
              >
                {c.edit}
              </DropdownMenu.Item>
              <DropdownMenu.Item
                className="cursor-pointer select-none rounded-lg px-2 py-1.5 text-sm text-fg outline-none data-highlighted:bg-surface-hover"
                onSelect={() => {
                  scheduleAbsorbNextMenuCardClick(job.id);
                  onRunNow(job);
                }}
              >
                {c.runNow}
              </DropdownMenu.Item>
              <DropdownMenu.Item
                className="cursor-pointer select-none rounded-lg px-2 py-1.5 text-sm text-red-600 outline-none data-highlighted:bg-red-500/10 dark:text-red-400"
                onSelect={() => {
                  scheduleAbsorbNextMenuCardClick(job.id);
                  onDelete(job);
                }}
              >
                {c.delete}
              </DropdownMenu.Item>
            </DropdownMenu.Content>
          </DropdownMenu.Portal>
        </DropdownMenu.Root>
      </div>
      <div className="flex flex-1 flex-col gap-2 px-4 pb-3 pt-2">
        <h3 className="line-clamp-2 font-semibold text-fg">{job.name || job.id}</h3>
        <div
          className="max-h-[4.5rem] overflow-hidden text-sm text-fg-muted [&_.markdown-body]:text-sm [&_.markdown-body]:leading-snug"
          title={cronJobBodyText(job)}
        >
          <MarkdownView content={cronJobBodyText(job)} compact />
        </div>
      </div>
      <div className="flex items-center gap-1.5 border-t border-edge-subtle/90 px-4 py-2.5 text-xs text-fg-muted dark:border-edge-subtle">
        <Clock className="size-3.5 shrink-0" strokeWidth={1.75} aria-hidden />
        <span className="min-w-0 truncate">{formatScheduleBadge(job, localeTag, scheduleBadgeLabels)}</span>
      </div>
    </article>
  );
}
