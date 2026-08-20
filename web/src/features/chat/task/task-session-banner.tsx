import type { TaskOperationalState, TaskPhase } from '@xopcai/gateway-contract';
import { ExternalLink, Target } from 'lucide-react';
import { memo, useEffect } from 'react';
import { Link, useLocation } from 'react-router-dom';
import useSWR from 'swr';

import { fetchTask } from '@/features/tasks/home-api';
import { taskCopy } from '@/features/tasks/task-copy';
import { cn } from '@/lib/cn';
import { withDetailReturnTo } from '@/lib/navigation-return';
import { useGatewayStore } from '@/stores/gateway-store';
import { useLocaleStore } from '@/stores/locale-store';

function statusClass(phase: TaskPhase, operationalState: TaskOperationalState): string {
  if (phase === 'closed') return 'border-success/35 text-success';
  if (operationalState === 'waiting' || operationalState === 'blocked') return 'border-warning/40 text-warning';
  return 'border-accent/40 text-accent';
}

/** Durable task state shown inside the conversation that is executing it. */
export const TaskSessionBanner = memo(function TaskSessionBanner({
  taskId,
}: {
  taskId: string;
}) {
  const location = useLocation();
  const language = useLocaleStore((state) => state.language);
  const token = useGatewayStore((state) => state.token);
  const copy = taskCopy(language);
  const { data, mutate } = useSWR(
    token ? ['task-session-banner', taskId, token] : null,
    () => fetchTask(taskId),
    {
      revalidateOnFocus: true,
      refreshInterval: (latest) => latest && latest.task.phase !== 'closed'
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
      'task-run-updated',
    ];
    for (const event of events) window.addEventListener(event, refresh);
    return () => {
      for (const event of events) window.removeEventListener(event, refresh);
    };
  }, [mutate]);

  if (!data) return null;

  const { task, operationalState } = data;
  const latestReceipt = data.receipts[0];
  const needsUser = data.attention.length > 0;
  const isActive = task.phase !== 'closed' && ['queued', 'running', 'verifying'].includes(operationalState);
  const detail = needsUser
    ? data.attention[0]?.summary ?? latestReceipt?.nextAction ?? latestReceipt?.summary
    : task.phase === 'closed'
      ? latestReceipt?.summary
      : latestReceipt?.nextAction ?? latestReceipt?.summary ?? copy.noDecisionNeeded;
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
            <span className={cn('rounded-full border px-1.5 py-0.5 text-[10px] font-medium', statusClass(task.phase, operationalState))}>
              {task.phase} · {operationalState}
            </span>
            {verifiedEvidenceCount > 0 ? (
              <span className="text-[11px] text-fg-muted">
                {verifiedEvidenceCount} {copy.taskProgress.evidence}
              </span>
            ) : null}
          </div>
          <p className="mt-1 text-sm font-medium leading-5 text-fg">{task.title}</p>
          {detail ? <p className="mt-1 line-clamp-2 text-xs leading-5 text-fg-muted">{detail}</p> : null}
        </div>
        <Link
          to={withDetailReturnTo(`/tasks/${encodeURIComponent(task.id)}`, `${location.pathname}${location.search}`)}
          className="inline-flex shrink-0 items-center gap-1 rounded-md px-2 py-1.5 text-xs font-medium text-accent hover:bg-accent-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
        >
          {needsUser ? copy.taskProgress.decide : copy.taskProgress.open}
          <ExternalLink className="size-3.5" aria-hidden />
        </Link>
      </div>
    </section>
  );
});
