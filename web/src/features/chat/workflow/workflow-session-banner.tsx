import { memo, useMemo } from 'react';

import type { ToolUseContent } from '@/features/chat/messages/messages.types';
import { WorkflowCard } from '@/features/chat/workflow/workflow-card';
import { workflowCardLabels } from '@/features/chat/workflow/workflow-card-labels';
import type { WorkflowSnapshot } from '@/features/chat/workflow/workflow.types';
import { cancelWorkflowRun, type WorkflowRunView } from '@/features/workflows/workflow-api';
import { runViewToSnapshot } from '@/features/workflows/run-view-to-snapshot';
import { ACTIVE_RUN_STATUSES } from '@/features/workflows/workflow-page.constants';
import { useLocaleStore } from '@/stores/locale-store';

function viewToToolBlock(view: WorkflowRunView): ToolUseContent {
  const snapshot = runViewToSnapshot(view);
  const status = view.run.status;
  const blockStatus =
    status === 'running' || status === 'queued'
      ? 'running'
      : status === 'succeeded'
        ? 'done'
        : 'error';
  return {
    type: 'tool_use',
    id: `workflow-run:${view.run.id}`,
    name: 'workflow',
    input: { name: view.run.definitionId },
    status: blockStatus,
    details: snapshot satisfies WorkflowSnapshot,
  };
}

/** Live workflow progress card pinned above the message list in workflow sessions. */
export const WorkflowSessionBanner = memo(function WorkflowSessionBanner({
  view,
  sessionKey,
  onAbortCurrentTurn,
  onSendUserMessage,
}: {
  view: WorkflowRunView;
  sessionKey: string | null;
  onAbortCurrentTurn?: () => void;
  onSendUserMessage?: (text: string) => void;
}) {
  const language = useLocaleStore((s) => s.language);
  const labels = workflowCardLabels(language);
  const block = useMemo(() => viewToToolBlock(view), [view]);
  const isActive = ACTIVE_RUN_STATUSES.has(view.run.status);

  const handleAbort = () => {
    if (isActive) {
      void cancelWorkflowRun(view.run.id).catch(() => {
        /* panel / SSE will reflect terminal state */
      });
    }
    onAbortCurrentTurn?.();
  };

  return (
    <div className="mb-6">
      <WorkflowCard
        block={block}
        startedAt={view.run.startedAtMs}
        sessionKey={sessionKey}
        onAbort={isActive ? handleAbort : undefined}
        onSendChatMessage={onSendUserMessage}
        labels={labels}
      />
    </div>
  );
});
