import type { ToolActivity } from '@xopcai/gateway-contract';

import { activityForProgress, activityForTool } from './desktop-pet-activity';
import {
  progressNarrative,
  toolNarrative,
  type DesktopPetNarrativeLabels,
} from './desktop-pet-narrative';
import type { AgentActivityDetailLevel } from '@/features/gateway/agent-run-stream-event-bridge';
import type { PetFeedback, PetSessionUpdate } from '@/types/electron';

export type AgentStreamDetail = {
  sessionKey?: string;
  event?: unknown;
  activityDetailLevel?: AgentActivityDetailLevel;
};

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object'
    ? (value as Record<string, unknown>)
    : {};
}

function text(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function safePublicSummary(value: unknown): string | undefined {
  const summary = text(value)
    ?.replace(/```[\s\S]*?```/g, '')
    .replace(/[`*_#>\[\]]/g, '')
    .replace(/https?:\/\/\S+/g, '')
    .replace(
      /(?:token|authorization|api[_-]?key|password|secret)\s*[:=].*/gi,
      '[redacted]',
    )
    .replace(/\s+/g, ' ')
    .trim();
  return summary ? summary.slice(0, 96) : undefined;
}

const feedbackStates = new Set(['working', 'waiting', 'success', 'error']);
const feedbackReassurances = new Set([
  'making_progress',
  'waiting_safely',
  'completed',
  'work_preserved',
  'details_available',
]);
const feedbackActions = new Set(['open_session', 'confirm', 'review_error']);

function parsePetFeedback(value: unknown): PetFeedback | undefined {
  const input = record(value);
  if (input.version !== 2 || !feedbackStates.has(String(input.taskState))) {
    return undefined;
  }
  if (input.sensitivity !== 'public' && input.sensitivity !== 'private') {
    return undefined;
  }
  const nextActionInput = record(input.nextAction);
  const nextAction =
    feedbackActions.has(String(nextActionInput.type)) &&
    feedbackActions.has(String(nextActionInput.label))
      ? {
          type: String(
            nextActionInput.type,
          ) as NonNullable<PetFeedback['nextAction']>['type'],
          label: String(
            nextActionInput.label,
          ) as NonNullable<PetFeedback['nextAction']>['label'],
        }
      : undefined;
  const progressInput = record(input.progress);
  const progress =
    typeof progressInput.completed === 'number' &&
    typeof progressInput.total === 'number' &&
    progressInput.total > 0
      ? { completed: progressInput.completed, total: progressInput.total }
      : undefined;
  const reassurance = feedbackReassurances.has(String(input.reassurance))
    ? (input.reassurance as PetFeedback['reassurance'])
    : undefined;
  const publicSummary =
    input.sensitivity === 'public'
      ? safePublicSummary(input.publicSummary)
      : undefined;
  return {
    version: 2,
    taskState: String(input.taskState) as PetFeedback['taskState'],
    sensitivity: input.sensitivity,
    ...(reassurance ? { reassurance } : {}),
    ...(nextAction ? { nextAction } : {}),
    ...(progress ? { progress } : {}),
    ...(publicSummary ? { publicSummary } : {}),
  };
}

export function mapAgentStreamEvent(
  detail: AgentStreamDetail,
  sequence: number,
  sessionLabel: string,
  labels: DesktopPetNarrativeLabels,
): PetSessionUpdate | null {
  if (!detail.sessionKey) return null;
  const event = record(detail.event);
  const payload = record(event.payload);
  const type = text(event.type);
  if (!type) return null;
  const runId = text(event.runId) ?? 'active';
  const base = {
    sessionKey: detail.sessionKey,
    runId,
    sessionLabel,
    sequence,
    timestamp: Date.now(),
  };
  const feedback = parsePetFeedback(payload.petFeedback ?? event.petFeedback);
  const publicSummary = feedback
    ? feedback.publicSummary
    : safePublicSummary(payload.publicSummary ?? event.publicSummary);
  if (type === 'run_start') {
    return {
      ...base,
      state: 'running',
      phase: 'preparing',
      action: labels.tipRunStart,
      animation: 'prepare',
      priority: 'low',
    };
  }
  if (type === 'thinking_delta') {
    if (detail.activityDetailLevel !== 'stream') return null;
    return {
      ...base,
      state: 'running',
      phase: 'planning',
      action: labels.tipThinking,
      animation: 'prepare',
      priority: 'low',
    };
  }
  if (type === 'tool_start' || type === 'tool_update') {
    const toolName = text(event.toolName) ?? text(payload.toolName) ?? 'tool';
    const semanticRecord = record(payload.activity);
    const semantic = typeof semanticRecord.category === 'string' && typeof semanticRecord.action === 'string'
      ? semanticRecord as ToolActivity
      : undefined;
    const activity = activityForTool(toolName, payload.args, semantic);
    const phase = activity.phase ?? 'running';
    const narrative = toolNarrative(
      labels,
      toolName,
      phase,
      activity.detail,
      semantic,
    );
    return {
      ...base,
      state: 'running',
      phase,
      ...narrative,
      detail: activity.detail,
    };
  }
  if (type === 'progress' || type === 'compaction') {
    const activity =
      type === 'compaction'
        ? { phase: 'compacting' as const }
        : activityForProgress(payload);
    const phase = activity.phase ?? 'preparing';
    const narrative = progressNarrative(
      labels,
      phase,
      activity.completed,
      activity.total,
    );
    return {
      ...base,
      state: 'running',
      phase,
      ...narrative,
      feedback,
      progress:
        feedback?.progress ??
        (typeof activity.completed === 'number' &&
        typeof activity.total === 'number'
          ? { completed: activity.completed, total: activity.total }
          : undefined),
    };
  }
  if (type === 'clarify_request') {
    return {
      ...base,
      state: 'waiting',
      phase: 'waiting',
      action: labels.tipWaiting,
      animation: 'wait',
      priority: 'high',
      publicSummary,
      feedback,
    };
  }
  if (type === 'assistant_message_start' || type === 'assistant_delta') {
    return {
      ...base,
      state: 'running',
      phase: 'running',
      action: labels.tipAssistantDelta,
      animation: 'create',
      priority: 'low',
    };
  }
  if (type === 'review_start' || type === 'review_delta') {
    return {
      ...base,
      state: 'running',
      phase: 'reading',
      action: labels.tipReview,
      animation: 'read',
      priority: 'normal',
    };
  }
  if (type === 'command_output_delta') {
    return {
      ...base,
      state: 'running',
      phase: 'running',
      action: labels.tipCommandDelta,
      animation: 'execute',
      priority: 'low',
    };
  }
  if (type === 'assistant_message_end') {
    const presentation = text(payload.presentation) === 'narration'
      ? 'narration'
      : 'answer';
    return {
      ...base,
      state: 'running',
      phase: presentation === 'narration' ? 'preparing' : 'running',
      action: presentation === 'narration'
        ? labels.tipAssistantNarrationDone
        : labels.tipAssistantAnswerDone,
      animation: presentation === 'narration' ? 'prepare' : 'create',
      priority: presentation === 'narration' ? 'low' : 'normal',
      publicSummary,
    };
  }
  if (type === 'run_end') {
    const state = feedback?.taskState === 'error' ? 'error' : 'success';
    return {
      ...base,
      state,
      phase: state === 'error' ? 'waiting' : 'running',
      action: state === 'error' ? labels.tipError : labels.tipComplete,
      animation: state === 'error' ? 'concern' : 'success',
      priority: 'high',
      publicSummary,
      feedback,
    };
  }
  if (type === 'error') {
    return {
      ...base,
      state: 'error',
      phase: 'waiting',
      action: labels.tipError,
      animation: 'concern',
      priority: 'high',
      publicSummary,
      feedback,
    };
  }
  return null;
}
