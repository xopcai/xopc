import type { TaskStatus } from '@xopcai/gateway-contract';
import { ExternalLink, Target } from 'lucide-react';
import { memo, useEffect } from 'react';
import { Link } from 'react-router-dom';
import useSWR from 'swr';

import { fetchTask } from '@/features/tasks/home-api';
import { taskCopy } from '@/features/tasks/task-copy';
import { cn } from '@/lib/cn';
import { useGatewayStore } from '@/stores/gateway-store';
import { useLocaleStore } from '@/stores/locale-store';

const TERMINAL_STATUSES = new Set<TaskStatus>(['completed', 'cancelled']);
const NEEDS_USER_STATUSES = new Set<TaskStatus>(['needs_user', 'blocked']);

function statusClass(status: TaskStatus): string {
  if (status === 'completed') return 'border-success/35 text-success';
  if (NEEDS_USER_STATUSES.has(status)) return 'border-warning/40 text-warning';
  if (status === 'cancelled' || status === 'paused') return 'border-edge text-fg-muted';
  return 'border-accent/40 text-accent';
}

/** Durable task state shown inside the conversation that is executing it. */
export const TaskSessionBanner = memo(function TaskSessionBanner({
  taskId,
}: {
  taskId: string;
}) {
  const language = useLocaleStore((state) => state.language);
  const token = useGatewayStore((state) => state.token);
  const copy = taskCopy(language);
  const { data, mutate } = useSWR(
    token ? ['task-session-banner', taskId, token] : null,
    () => fetchTask(taskId),
    {
      revalidateOnFocus: true,
      refreshInterval: (latest) => latest && !TERMINAL_STATUSES.has(latest.task.status)
        ? 2_000
        : 0,
    },
  );

  useEffect(() => {
    const refresh = () => void mutate();
    const events = [
      'agent-run-started',
      'agent-run-ended',
      'session-transcript-updated',
      'task-queue-updated',
    ];
    for (const event of events) window.addEventListener(event, refresh);
    return () => {
      for (const event of events) window.removeEventListener(event, refresh);
    };
  }, [mutate]);

  if (!data) return null;

  const { task, execution } = data;
  const latestReceipt = data.receipts[0];
  const status = task.status;
  const needsUser = NEEDS_USER_STATUSES.has(status);
  const isActive = !TERMINAL_STATUSES.has(status)
    && !NEEDS_USER_STATUSES.has(status)
    && status !== 'paused';
  const detail = needsUser
    ? execution?.blockedReason ?? latestReceipt?.nextAction ?? latestReceipt?.summary
    : status === 'completed'
      ? latestReceipt?.summary
      : execution?.nextAction ?? latestReceipt?.nextAction ?? latestReceipt?.summary ?? copy.noDecisionNeeded;
  const verifiedEvidenceCount = latestReceipt?.evidence
    .filter((item) => item.strength === 'verified').length ?? 0;

  return (
    <section
      className="mb-6 rounded-xl border border-edge bg-surface-panel px-3 py-3 sm:px-4"
      aria-label={copy.taskProgress.title}
      aria-live="polite"
    >
      <div className="flex items-start gap-3">
        <span className="relative mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-full bg-accent-soft text-accent-fg">
          <Target className="size-4" aria-hidden />
          {isActive ? (
            <span className="absolute -right-0.5 -top-0.5 size-2.5 rounded-full border-2 border-surface-panel bg-accent motion-safe:animate-pulse" />
          ) : null}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs font-medium text-fg-muted">{copy.taskProgress.title}</span>
            <span className={cn('rounded-full border px-1.5 py-0.5 text-[10px] font-medium', statusClass(status))}>
              {copy.taskProgress.statuses[status]}
            </span>
            {verifiedEvidenceCount > 0 ? (
              <span className="text-[11px] text-fg-muted">
                {verifiedEvidenceCount} {copy.taskProgress.evidence}
              </span>
            ) : null}
          </div>
          <p className="mt-1 text-sm font-medium leading-5 text-fg">{task.objective}</p>
          {detail ? <p className="mt-1 line-clamp-2 text-xs leading-5 text-fg-muted">{detail}</p> : null}
        </div>
        <Link
          to={`/tasks/${encodeURIComponent(task.id)}`}
          className="inline-flex shrink-0 items-center gap-1 rounded-md px-2 py-1.5 text-xs font-medium text-accent hover:bg-accent-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
        >
          {needsUser ? copy.taskProgress.decide : copy.taskProgress.open}
          <ExternalLink className="size-3.5" aria-hidden />
        </Link>
      </div>
    </section>
  );
});
