import { ArrowUpRight, GitBranch } from 'lucide-react';
import { memo } from 'react';
import { useNavigate } from 'react-router-dom';

import type { WorkflowRunLinkEntry } from '@/features/workflows/parse-workflow-run-links';
import { workflowBoardHref } from '@/features/workflows/workflow-page.utils';
import { cn } from '@/lib/cn';
import { interaction } from '@/lib/interaction';
import { messages } from '@/i18n/messages';
import { useLocaleStore } from '@/stores/locale-store';

function statusLabel(status: WorkflowRunLinkEntry['status'], labels: ReturnType<typeof messages>['workflows']): string {
  if (status === 'running' || status === 'queued') return labels.runLinkRunning;
  if (status === 'succeeded') return labels.runLinkCompleted;
  return labels.runLinkFinished;
}

export const WorkflowRunLinkCard = memo(function WorkflowRunLinkCard({
  link,
  className,
}: {
  link: WorkflowRunLinkEntry;
  className?: string;
}) {
  const language = useLocaleStore((s) => s.language);
  const labels = messages(language).workflows;
  const navigate = useNavigate();
  const title = link.goal.trim() || link.definitionId;

  return (
    <button
      type="button"
      onClick={() => navigate(workflowBoardHref(link.runId))}
      className={cn(
        'flex w-full items-start gap-3 rounded-2xl border border-edge bg-surface-panel px-4 py-3 text-left',
        'transition-colors hover:bg-surface-hover/60',
        interaction.focusRingPanel,
        className,
      )}
    >
      <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg bg-accent-soft text-accent-fg">
        <GitBranch className="size-4" aria-hidden />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-xs font-medium uppercase tracking-wide text-fg-subtle">
          {statusLabel(link.status, labels)}
        </span>
        <span className="mt-1 block text-sm font-semibold text-fg">{link.definitionId}</span>
        <span className="mt-0.5 block truncate text-sm text-fg-muted">{title}</span>
        <span className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-accent-fg">
          {labels.taskOpenDetails}
          <ArrowUpRight className="size-3.5" aria-hidden />
        </span>
      </span>
    </button>
  );
});
