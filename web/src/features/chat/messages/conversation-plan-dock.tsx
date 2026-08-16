import * as Popover from '@radix-ui/react-popover';
import { Ban, Check, ChevronDown, Circle, CircleDot, ListChecks } from 'lucide-react';

import type {
  ConversationChangeSummary,
  ConversationPlan,
  ConversationPlanItemStatus,
} from '@/features/chat/messages/conversation-plan';
import { cn } from '@/lib/cn';
import { interaction } from '@/lib/interaction';

type ConversationPlanLabels = {
  heading: string;
  stepProgress: string;
  completedProgress: string;
  finished: string;
  ended: string;
  planned: string;
  filesChangedOne: string;
  filesChangedOther: string;
};

function replaceCounts(template: string, values: Record<string, number>): string {
  return Object.entries(values).reduce(
    (text, [key, value]) => text.replaceAll(`{{${key}}}`, String(value)),
    template,
  );
}

function StatusIcon({ status }: { status: ConversationPlanItemStatus }) {
  if (status === 'completed') {
    return (
      <span className="mt-0.5 inline-flex size-4 shrink-0 items-center justify-center rounded-full bg-fg-muted text-surface-panel">
        <Check className="size-3" strokeWidth={2.5} aria-hidden />
      </span>
    );
  }
  if (status === 'in_progress') {
    return <CircleDot className="mt-0.5 size-4 shrink-0 text-accent" strokeWidth={2} aria-hidden />;
  }
  if (status === 'cancelled') {
    return <Ban className="mt-0.5 size-4 shrink-0 text-fg-disabled" strokeWidth={1.75} aria-hidden />;
  }
  return <Circle className="mt-0.5 size-4 shrink-0 text-fg-subtle" strokeWidth={1.75} aria-hidden />;
}

function changeSummaryText(
  summary: ConversationChangeSummary | null,
  labels: ConversationPlanLabels,
): string | null {
  if (!summary) return null;
  const fileTemplate = summary.files.length === 1
    ? labels.filesChangedOne
    : labels.filesChangedOther;
  const files = replaceCounts(fileTemplate, { count: summary.files.length });
  return `${files} · +${summary.added} -${summary.removed}`;
}

export function ConversationPlanDock({
  plan,
  changeSummary,
  isStreaming,
  labels,
}: {
  plan: ConversationPlan;
  changeSummary: ConversationChangeSummary | null;
  isStreaming: boolean;
  labels: ConversationPlanLabels;
}) {
  const activeItem = plan.currentIndex != null ? plan.items[plan.currentIndex - 1] : undefined;
  const allCompleted = plan.items.every((item) => item.status === 'completed');
  const allClosed = plan.items.every(
    (item) => item.status === 'completed' || item.status === 'cancelled',
  );
  const progressText = replaceCounts(labels.completedProgress, {
    completed: plan.completedCount,
    total: plan.totalCount,
  });
  let stateText = labels.ended;
  if (allCompleted) {
    stateText = labels.finished;
  } else if (activeItem) {
    stateText = replaceCounts(labels.stepProgress, {
      current: plan.currentIndex ?? 1,
      total: plan.totalCount,
    });
  } else if (!allClosed && isStreaming) {
    stateText = labels.planned;
  }
  const changes = changeSummaryText(changeSummary, labels);
  const triggerLabel = [stateText, activeItem?.title, changes].filter(Boolean).join(' · ');

  return (
    <div className="flex w-full justify-center pb-2 pt-1">
      <Popover.Root>
        <Popover.Trigger asChild>
          <button
            type="button"
            className={cn(
              'inline-flex min-h-9 max-w-full items-center gap-2 rounded-pill border border-edge-subtle bg-surface-panel px-3 py-1.5 text-sm text-fg shadow-surface',
              interaction.transition,
              'hover:border-edge hover:bg-surface-hover/60',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-surface-panel',
            )}
            aria-label={`${labels.heading}: ${triggerLabel}`}
          >
            {allCompleted ? (
              <Check className="size-4 shrink-0 text-fg-muted" strokeWidth={2} aria-hidden />
            ) : activeItem ? (
              <CircleDot className="size-4 shrink-0 text-accent" strokeWidth={2} aria-hidden />
            ) : (
              <ListChecks className="size-4 shrink-0 text-fg-muted" strokeWidth={1.75} aria-hidden />
            )}
            <span className="min-w-0 truncate">{stateText}</span>
            {activeItem ? <span className="min-w-0 truncate text-fg-muted">· {activeItem.title}</span> : null}
            {changes ? <span className="hidden shrink-0 tabular-nums text-fg-subtle sm:inline">· {changes}</span> : null}
            <ChevronDown className="size-3.5 shrink-0 text-fg-subtle" aria-hidden />
          </button>
        </Popover.Trigger>
        <Popover.Portal>
          <Popover.Content
            side="top"
            align="center"
            sideOffset={8}
            collisionPadding={16}
            className="z-50 w-[min(28rem,calc(100vw-2rem))] overflow-hidden rounded-xl border border-edge bg-surface-panel shadow-popover outline-none"
          >
            <div className="flex items-center justify-between gap-3 border-b border-edge-subtle px-4 py-3">
              <div className="min-w-0">
                <div className="flex items-center gap-2 text-sm font-medium text-fg">
                  <ListChecks className="size-4 text-fg-muted" strokeWidth={1.75} aria-hidden />
                  <span>{labels.heading}</span>
                </div>
                {plan.explanation ? (
                  <p className="mt-1 line-clamp-2 text-xs leading-relaxed text-fg-muted">
                    {plan.explanation}
                  </p>
                ) : null}
              </div>
              <span className="shrink-0 text-xs tabular-nums text-fg-subtle">{progressText}</span>
            </div>
            <ol className="max-h-[min(22rem,55vh)] overflow-y-auto px-4 py-3" aria-label={labels.heading}>
              {plan.items.map((item) => (
                <li
                  key={item.id}
                  className={cn(
                    'flex gap-3 py-2 text-sm leading-relaxed text-fg-muted',
                    item.status === 'in_progress' && 'font-medium text-fg',
                    item.status === 'cancelled' && 'text-fg-disabled',
                  )}
                >
                  <StatusIcon status={item.status} />
                  <span className="min-w-0 [overflow-wrap:anywhere]">{item.title}</span>
                </li>
              ))}
            </ol>
            {changes ? (
              <div className="border-t border-edge-subtle px-4 py-2 text-right text-xs tabular-nums text-fg-subtle">
                {changes}
              </div>
            ) : null}
          </Popover.Content>
        </Popover.Portal>
      </Popover.Root>
    </div>
  );
}
