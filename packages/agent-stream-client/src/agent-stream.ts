/** Dispatches Chat Stream Protocol events received from realtime run topics. */

import type {
  AgentStreamClarifyRequestPayload,
  AgentStreamCommandCompletedPayload,
  AgentStreamCommandOutputDeltaPayload,
  AgentStreamCommandStartedPayload,
  AgentStreamPatchAppliedPayload,
  AgentStreamProgressState,
  AgentStreamReviewPayload,
  AgentStreamTtsAudioPayload,
  AgentStreamTurnDiffPayload,
  AgentStreamTurnPlanUpdatedPayload,
  AgentStreamUserTranscriptAttachment,
  AgentStreamUserTranscriptPayload,
  PetFeedback,
} from '@xopcai/gateway-contract';

export type ProgressState = AgentStreamProgressState;
export type UserTranscriptAttachment = AgentStreamUserTranscriptAttachment;
export type CommandStartedPayload = AgentStreamCommandStartedPayload;
export type CommandOutputDeltaPayload = AgentStreamCommandOutputDeltaPayload;
export type CommandCompletedPayload = AgentStreamCommandCompletedPayload;
export type PatchAppliedPayload = AgentStreamPatchAppliedPayload;
export type TurnDiffPayload = AgentStreamTurnDiffPayload;
export type TurnPlanUpdatedPayload = AgentStreamTurnPlanUpdatedPayload;
export type ReviewPayload = AgentStreamReviewPayload;

export type AgentStreamCallbacks = {
  onStreamStart: () => void;
  onUserTranscript?: (payload: AgentStreamUserTranscriptPayload) => void;
  onToken: (delta: string) => void;
  onThinking: (content: string, isDelta: boolean) => void;
  onThinkingEnd: () => void;
  onToolStart: (toolName: string, args?: unknown, toolCallId?: string) => void;
  onToolUpdate?: (toolName: string, toolCallId: string | undefined, details: unknown) => void;
  onToolEnd: (toolName: string, isError: boolean, result?: unknown, toolCallId?: string) => void;
  onCommandStarted?: (payload: CommandStartedPayload) => void;
  onCommandOutputDelta?: (payload: CommandOutputDeltaPayload) => void;
  onCommandCompleted?: (payload: CommandCompletedPayload) => void;
  onPatchApplied?: (payload: PatchAppliedPayload) => void;
  onTurnPlanUpdated?: (payload: TurnPlanUpdatedPayload) => void;
  onTurnDiff?: (payload: TurnDiffPayload) => void;
  onReview?: (payload: ReviewPayload) => void;
  onProgress: (progress: ProgressState) => void;
  onTtsAudio?: (payload: AgentStreamTtsAudioPayload) => void;
  onClarifyRequest?: (payload: AgentStreamClarifyRequestPayload) => void;
  onPetFeedback?: (feedback: PetFeedback) => void;
  onResult: () => void;
  onError: (msg: string) => void;
};

export type AgentStreamDispatchOptions = {
  /** Current session key (for persisting runId for abort/resume). */
  sessionKey?: string;
  savePendingRunId?: (sessionKey: string, runId: string) => void;
};

type ParsedEvent = {
  type?: unknown;
  runId?: unknown;
  payload?: unknown;
  timestamp?: unknown;
};

function payloadOf(parsed: ParsedEvent): Record<string, unknown> {
  return parsed.payload && typeof parsed.payload === 'object'
    ? parsed.payload as Record<string, unknown>
    : {};
}

function normalizedEventName(event: string, parsed: ParsedEvent): string {
  const payloadType = typeof parsed.type === 'string' ? parsed.type.trim() : '';
  return (event === 'message' || event === '') && payloadType ? payloadType : event;
}

function normalizeTranscriptAttachments(raw: unknown): UserTranscriptAttachment[] | undefined {
  const rawAttachments = Array.isArray(raw) ? raw : undefined;
  return rawAttachments
    ?.filter((item): item is Record<string, unknown> => item != null && typeof item === 'object')
    .map((item) => ({
      uri: typeof item.uri === 'string' ? item.uri : undefined,
      workspaceRelativePath:
        typeof item.workspaceRelativePath === 'string' ? item.workspaceRelativePath : undefined,
      mimeType: typeof item.mimeType === 'string' ? item.mimeType : undefined,
      name: typeof item.name === 'string' ? item.name : undefined,
      durationSeconds:
        typeof item.durationSeconds === 'number' && Number.isFinite(item.durationSeconds)
          ? item.durationSeconds
          : undefined,
    }));
}

function serializePayload(value: unknown): unknown {
  if (value == null || typeof value === 'string') return value;
  return value;
}

const petTaskStates = new Set(['working', 'waiting', 'success', 'error']);
const petReassurances = new Set(['making_progress', 'waiting_safely', 'completed', 'work_preserved', 'details_available']);
const petActions = new Set(['open_session', 'confirm', 'review_error']);

function normalizePetFeedback(raw: unknown): PetFeedback | undefined {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined;
  const input = raw as Record<string, unknown>;
  if (input.version !== 2 || !petTaskStates.has(String(input.taskState))) return undefined;
  if (input.sensitivity !== 'public' && input.sensitivity !== 'private') return undefined;
  const actionInput = input.nextAction && typeof input.nextAction === 'object' && !Array.isArray(input.nextAction)
    ? input.nextAction as Record<string, unknown>
    : undefined;
  const nextAction = actionInput && petActions.has(String(actionInput.type)) && petActions.has(String(actionInput.label))
    ? {
        type: String(actionInput.type) as NonNullable<PetFeedback['nextAction']>['type'],
        label: String(actionInput.label) as NonNullable<PetFeedback['nextAction']>['label'],
      }
    : undefined;
  const progressInput = input.progress && typeof input.progress === 'object' && !Array.isArray(input.progress)
    ? input.progress as Record<string, unknown>
    : undefined;
  const progress = progressInput
    && typeof progressInput.completed === 'number'
    && typeof progressInput.total === 'number'
    && progressInput.total > 0
    ? { completed: progressInput.completed, total: progressInput.total }
    : undefined;
  const reassurance = petReassurances.has(String(input.reassurance))
    ? input.reassurance as PetFeedback['reassurance']
    : undefined;
  const publicSummary = input.sensitivity === 'public' && typeof input.publicSummary === 'string' && input.publicSummary.trim()
    ? input.publicSummary.trim().slice(0, 160)
    : undefined;
  return {
    version: 2,
    taskState: String(input.taskState) as PetFeedback['taskState'],
    sensitivity: input.sensitivity,
    ...(publicSummary ? { publicSummary } : {}),
    ...(reassurance ? { reassurance } : {}),
    ...(nextAction ? { nextAction } : {}),
    ...(progress ? { progress } : {}),
  };
}

export function dispatchAgentStreamEvent(
  event: string,
  data: string,
  cb: AgentStreamCallbacks | undefined,
  options?: AgentStreamDispatchOptions,
): void {
  let parsed: ParsedEvent;
  try {
    parsed = JSON.parse(data) as ParsedEvent;
  } catch {
    return;
  }

  const p = payloadOf(parsed);
  const effectiveEvent = normalizedEventName(event, parsed);
  const petFeedback = normalizePetFeedback(p.petFeedback);
  if (petFeedback) cb?.onPetFeedback?.(petFeedback);

  switch (effectiveEvent) {
    case 'run_start':
      if (typeof parsed.runId === 'string' && options?.sessionKey) {
        options.savePendingRunId?.(options.sessionKey, parsed.runId);
      }
      cb?.onStreamStart();
      break;
    case 'user_transcript': {
      const text = typeof p.text === 'string' ? p.text : '';
      const attachments = normalizeTranscriptAttachments(p.attachments ?? p.media);
      cb?.onUserTranscript?.({ text, attachments });
      break;
    }
    case 'user_message':
      break;
    case 'assistant_message_start':
      cb?.onStreamStart();
      break;
    case 'assistant_delta':
      if (typeof p.delta === 'string' && p.delta) cb?.onToken(p.delta);
      break;
    case 'thinking_delta':
      if (typeof p.delta === 'string' && p.delta) cb?.onThinking(p.delta, true);
      break;
    case 'thinking_end':
    case 'assistant_message_end':
      cb?.onThinkingEnd();
      break;
    case 'tool_start': {
      const toolName = String(p.toolName || 'unknown');
      const toolCallId = typeof p.toolCallId === 'string' ? p.toolCallId : undefined;
      if (toolName === 'exec_command') break;
      if (toolName === 'clarify') break;
      cb?.onToolStart(toolName, p.args, toolCallId);
      break;
    }
    case 'tool_update': {
      const toolName = typeof p.toolName === 'string' && p.toolName ? p.toolName : 'unknown';
      const toolCallId = typeof p.toolCallId === 'string' ? p.toolCallId : undefined;
      const details = p.details && typeof p.details === 'object'
        ? p.details as Record<string, unknown>
        : undefined;
      if (toolName === 'exec_command' && details?.kind === 'command_output_delta') break;
      if (p.details !== undefined) cb?.onToolUpdate?.(toolName, toolCallId, p.details);
      if (typeof p.textDelta === 'string' && p.textDelta) {
        cb?.onToolUpdate?.(toolName, toolCallId, { textDelta: p.textDelta });
      }
      break;
    }
    case 'tool_end': {
      const toolName = typeof p.toolName === 'string' && p.toolName ? p.toolName : 'unknown';
      const isError = p.status === 'error' || p.status === 'cancelled';
      if (toolName === 'exec_command') break;
      if (toolName === 'apply_patch' && !isError) break;
      cb?.onToolEnd(
        toolName,
        isError,
        serializePayload(p.result),
        typeof p.toolCallId === 'string' ? p.toolCallId : undefined,
      );
      break;
    }
    case 'command_started': {
      const toolCallId = typeof p.toolCallId === 'string' ? p.toolCallId : '';
      const command = typeof p.command === 'string' ? p.command : '';
      if (toolCallId && command) {
        cb?.onCommandStarted?.({
          toolCallId,
          command,
          cwd: typeof p.cwd === 'string' ? p.cwd : undefined,
        });
      }
      break;
    }
    case 'command_output_delta': {
      const toolCallId = typeof p.toolCallId === 'string' ? p.toolCallId : '';
      const delta = typeof p.delta === 'string' ? p.delta : '';
      if (toolCallId && delta) {
        cb?.onCommandOutputDelta?.({
          toolCallId,
          stream: p.stream === 'stderr' ? 'stderr' : 'stdout',
          delta,
        });
      }
      break;
    }
    case 'command_completed': {
      const toolCallId = typeof p.toolCallId === 'string' ? p.toolCallId : '';
      if (toolCallId) {
        cb?.onCommandCompleted?.({
          toolCallId,
          command: typeof p.command === 'string' ? p.command : '',
          cwd: typeof p.cwd === 'string' ? p.cwd : undefined,
          exitCode: typeof p.exitCode === 'number' ? p.exitCode : null,
          durationMs: typeof p.durationMs === 'number' ? p.durationMs : undefined,
          timedOut: p.timedOut === true,
          truncated: p.truncated === true,
        });
      }
      break;
    }
    case 'patch_applied': {
      const toolCallId = typeof p.toolCallId === 'string' ? p.toolCallId : '';
      if (toolCallId) {
        cb?.onPatchApplied?.({
          toolCallId,
          changes: Array.isArray(p.changes) ? p.changes : [],
          diff: typeof p.diff === 'string' ? p.diff : '',
          added: typeof p.added === 'number' ? p.added : 0,
          removed: typeof p.removed === 'number' ? p.removed : 0,
        });
      }
      break;
    }
    case 'turn_diff':
      cb?.onTurnDiff?.({
        files: Array.isArray(p.files) ? p.files.filter((x): x is string => typeof x === 'string') : [],
        diff: typeof p.diff === 'string' ? p.diff : '',
        added: typeof p.added === 'number' ? p.added : 0,
        removed: typeof p.removed === 'number' ? p.removed : 0,
      });
      break;
    case 'turn_plan': {
      const plan = normalizeTurnPlan(p.plan);
      if (plan.length > 0) {
        cb?.onTurnPlanUpdated?.({
          explanation: typeof p.explanation === 'string' && p.explanation.trim() ? p.explanation.trim() : undefined,
          plan,
        });
      }
      break;
    }
    case 'review':
      cb?.onReview?.({ review: p.review });
      break;
    case 'progress':
      cb?.onProgress({
        stage: String(p.stage || 'thinking'),
        message: String(p.message || ''),
        detail: p.detail as string | undefined,
        toolName: p.toolName as string | undefined,
        timestamp: Date.now(),
        petFeedback,
      });
      break;
    case 'compaction':
      if (typeof p.message === 'string') {
        cb?.onProgress({ stage: 'compaction', message: p.message, timestamp: Date.now() });
      }
      break;
    case 'tts_audio': {
      const uri = typeof p.uri === 'string' ? p.uri.trim() : '';
      if (!uri) break;
      cb?.onTtsAudio?.({
        uri,
        mimeType: String(p.mimeType || 'audio/mpeg'),
        name: String(p.name || 'voice.mp3'),
        attachTo: p.attachTo === 'last_assistant' ? 'last_assistant' : undefined,
        messageId: typeof p.messageId === 'string' ? p.messageId : undefined,
      });
      break;
    }
    case 'clarify_request': {
      const requestId = typeof p.requestId === 'string' ? p.requestId.trim() : '';
      const question = typeof p.question === 'string' ? p.question.trim() : '';
      if (requestId && question && cb?.onClarifyRequest) {
        const choices = Array.isArray(p.choices)
          ? (p.choices as unknown[]).filter((x): x is string => typeof x === 'string' && x.trim().length > 0)
          : undefined;
        const def = typeof p.default === 'string' && p.default.trim() ? p.default.trim() : undefined;
        cb.onClarifyRequest({
          requestId,
          question,
          choices: choices && choices.length >= 2 ? choices : undefined,
          default: def,
          petFeedback,
        });
      }
      break;
    }
    case 'run_end':
      cb?.onResult();
      break;
    case 'error':
      cb?.onError(String(p.message || 'Send failed'));
      break;
  }
}

function normalizeTurnPlan(raw: unknown): TurnPlanUpdatedPayload['plan'] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((item) => {
      const rec = item && typeof item === 'object' && !Array.isArray(item)
        ? item as Record<string, unknown>
        : undefined;
      const step = typeof rec?.step === 'string' ? rec.step.trim() : '';
      const status = rec?.status;
      if (!step || (status !== 'pending' && status !== 'in_progress' && status !== 'completed')) {
        return undefined;
      }
      return { step, status };
    })
    .filter((item): item is TurnPlanUpdatedPayload['plan'][number] => Boolean(item));
}
