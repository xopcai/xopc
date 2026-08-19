import type { OutcomeInternalStatus } from '@xopcai/gateway-contract';
import { ExternalLink, Target } from 'lucide-react';
import { memo, useEffect } from 'react';
import { Link } from 'react-router-dom';
import useSWR from 'swr';

import { fetchOutcome } from '@/features/work/work-home-api';
import { workCopy } from '@/features/work/work-copy';
import { cn } from '@/lib/cn';
import { useGatewayStore } from '@/stores/gateway-store';
import { useLocaleStore } from '@/stores/locale-store';

const TERMINAL_STATUSES = new Set<OutcomeInternalStatus>(['completed', 'cancelled']);
const NEEDS_USER_STATUSES = new Set<OutcomeInternalStatus>(['needs_user', 'blocked']);

function statusClass(status: OutcomeInternalStatus): string {
  if (status === 'completed') return 'border-success/35 text-success';
  if (NEEDS_USER_STATUSES.has(status)) return 'border-warning/40 text-warning';
  if (status === 'cancelled' || status === 'paused') return 'border-edge text-fg-muted';
  return 'border-accent/40 text-accent';
}

/** Durable outcome state shown inside the conversation that is executing it. */
export const OutcomeSessionBanner = memo(function OutcomeSessionBanner({
  outcomeId,
}: {
  outcomeId: string;
}) {
  const language = useLocaleStore((state) => state.language);
  const token = useGatewayStore((state) => state.token);
  const copy = workCopy(language);
  const { data, mutate } = useSWR(
    token ? ['outcome-session-banner', outcomeId, token] : null,
    () => fetchOutcome(outcomeId),
    {
      revalidateOnFocus: true,
      refreshInterval: (latest) => latest && !TERMINAL_STATUSES.has(latest.outcome.internalStatus)
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
      'outcome-queue-updated',
    ];
    for (const event of events) window.addEventListener(event, refresh);
    return () => {
      for (const event of events) window.removeEventListener(event, refresh);
    };
  }, [mutate]);

  if (!data) return null;

  const { outcome, execution } = data;
  const latestReceipt = data.receipts[0];
  const status = outcome.internalStatus;
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
      aria-label={copy.outcomeProgress.title}
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
            <span className="text-xs font-medium text-fg-muted">{copy.outcomeProgress.title}</span>
            <span className={cn('rounded-full border px-1.5 py-0.5 text-[10px] font-medium', statusClass(status))}>
              {copy.outcomeProgress.statuses[status]}
            </span>
            {verifiedEvidenceCount > 0 ? (
              <span className="text-[11px] text-fg-muted">
                {verifiedEvidenceCount} {copy.outcomeProgress.evidence}
              </span>
            ) : null}
          </div>
          <p className="mt-1 text-sm font-medium leading-5 text-fg">{outcome.objective}</p>
          {detail ? <p className="mt-1 line-clamp-2 text-xs leading-5 text-fg-muted">{detail}</p> : null}
        </div>
        <Link
          to={`/work/${encodeURIComponent(outcome.id)}`}
          className="inline-flex shrink-0 items-center gap-1 rounded-md px-2 py-1.5 text-xs font-medium text-accent hover:bg-accent-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
        >
          {needsUser ? copy.outcomeProgress.decide : copy.outcomeProgress.open}
          <ExternalLink className="size-3.5" aria-hidden />
        </Link>
      </div>
    </section>
  );
});
