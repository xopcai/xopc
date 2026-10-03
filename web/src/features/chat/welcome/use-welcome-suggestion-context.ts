import { useEffect, useState } from 'react';

import { readLocalSessionDraft } from '@/features/chat/session/local-session-drafts';
import type { WelcomeSuggestionContext, WelcomeSuggestionContextStatus } from '@/features/chat/welcome/welcome-suggestions';
import { fetchProject, fetchProjectOperatingView } from '@/features/projects/api';
import { getSessionDetail } from '@/features/sessions/session-api';
import type { TaskDetail } from '@/features/tasks/home-api';
import type { WorkflowRunView } from '@/features/workflows/workflow-api';

type UseWelcomeSuggestionContextOptions = {
  enabled: boolean;
  conversationId?: string | null;
  sourceContextPending?: boolean;
  sourceContextFailed?: boolean;
  suppressProjectContext?: boolean;
  task?: TaskDetail | null;
  workflow?: WorkflowRunView | null;
};

export type WelcomeSuggestionContextState = {
  context: WelcomeSuggestionContext;
  status: WelcomeSuggestionContextStatus;
};

type InternalWelcomeSuggestionContextState = WelcomeSuggestionContextState & {
  key: string;
};

function contextStateKey(options: UseWelcomeSuggestionContextOptions): string {
  if (!options.enabled) return 'disabled';
  if (options.sourceContextPending) return `pending:${options.conversationId ?? ''}`;
  if (options.task) return `task:${options.task.task.id}:${options.task.task.version}`;
  if (options.workflow) return `workflow:${options.workflow.run.id}:${options.workflow.run.status}`;
  if (options.suppressProjectContext) return `suppressed:${options.conversationId ?? ''}`;
  if (options.conversationId) {
    return `session:${options.conversationId}:failed:${options.sourceContextFailed ? '1' : '0'}`;
  }
  return 'empty';
}

function immediateContextState(options: UseWelcomeSuggestionContextOptions): InternalWelcomeSuggestionContextState {
  const key = contextStateKey(options);
  if (!options.enabled) return { key, context: { kind: 'empty' }, status: 'ready' };
  if (options.sourceContextPending) return { key, context: { kind: 'empty' }, status: 'loading' };
  if (options.task) {
    const latestReceipt = options.task.receipts[0];
    return {
      key,
      context: {
        kind: 'task',
        taskId: options.task.task.id,
        taskTitle: options.task.task.title,
        phase: options.task.task.phase,
        operationalState: options.task.operationalState,
        attentionSummary: options.task.attention[0]?.summary,
        nextAction: latestReceipt?.nextAction,
        recentFailure: latestReceipt?.failure?.recoveryAction,
      },
      status: 'ready',
    };
  }
  if (options.workflow) {
    const run = options.workflow.run;
    return {
      key,
      context: {
        kind: 'workflow',
        workflowName: run.goal.trim() || run.title || run.definitionId,
        status: run.status,
        nextAction: run.result?.followUps?.[0]?.prompt ?? run.result?.actions?.[0]?.label,
        recentFailure: run.error?.message,
      },
      status: 'ready',
    };
  }
  if (options.suppressProjectContext) {
    return {
      key,
      context: { kind: 'empty' },
      status: options.sourceContextFailed ? 'degraded' : 'ready',
    };
  }
  return {
    key,
    context: { kind: 'empty' },
    status: options.conversationId ? 'loading' : 'ready',
  };
}

export function useWelcomeSuggestionContext(options: UseWelcomeSuggestionContextOptions): WelcomeSuggestionContextState {
  const {
    enabled,
    conversationId,
    sourceContextPending,
    sourceContextFailed,
    suppressProjectContext,
    task,
    workflow,
  } = options;
  const currentKey = contextStateKey(options);
  const [state, setState] = useState<InternalWelcomeSuggestionContextState>(() => immediateContextState(options));

  useEffect(() => {
    let cancelled = false;
    const currentOptions: UseWelcomeSuggestionContextOptions = {
      enabled,
      conversationId,
      sourceContextPending,
      sourceContextFailed,
      suppressProjectContext,
      task,
      workflow,
    };
    const immediate = immediateContextState(currentOptions);
    if (
      !enabled ||
      sourceContextPending ||
      task ||
      workflow ||
      suppressProjectContext ||
      !conversationId
    ) {
      setState(immediate);
      return undefined;
    }

    setState(immediate);
    void (async () => {
      let degraded = Boolean(sourceContextFailed);
      let projectId: string | null = null;
      try {
        const draft = await readLocalSessionDraft(conversationId);
        projectId = draft
          ? draft.creation.projectId?.trim() || null
          : (await getSessionDetail(conversationId)).projectId?.trim() || null;
      } catch {
        degraded = true;
      }

      if (!projectId) {
        if (!cancelled) {
          setState({
            key: currentKey,
            context: { kind: 'empty' },
            status: degraded ? 'degraded' : 'ready',
          });
        }
        return;
      }

      try {
        const [projectResult, operatingResult] = await Promise.allSettled([
          fetchProject(projectId),
          fetchProjectOperatingView(projectId),
        ]);
        if (projectResult.status === 'rejected') throw projectResult.reason;
        const operating = operatingResult.status === 'fulfilled' ? operatingResult.value : null;
        if (!operating) degraded = true;
        const blocker = operating?.blockers[0];
        const failedResult = operating?.digest.health === 'attention'
          ? operating.recentResults.find(
              ({ receipt }) => receipt.status === 'failed' || receipt.verification.status === 'failed',
            )
          : undefined;
        if (!cancelled) {
          setState({
            key: currentKey,
            context: {
              kind: 'project',
              projectId,
              projectName: projectResult.value.name,
              recommendedAction: operating?.digest.recommendedAction,
              blockedReason: blocker?.detail ?? blocker?.title,
              recentFailure: failedResult?.receipt.failure?.recoveryAction ?? failedResult?.receipt.summary,
            },
            status: degraded ? 'degraded' : 'ready',
          });
        }
      } catch {
        if (!cancelled) {
          setState({ key: currentKey, context: { kind: 'empty' }, status: 'degraded' });
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [
    conversationId,
    currentKey,
    enabled,
    sourceContextFailed,
    sourceContextPending,
    suppressProjectContext,
    task,
    workflow,
  ]);

  const visibleState = state.key === currentKey ? state : immediateContextState(options);
  return { context: visibleState.context, status: visibleState.status };
}
