export type ChatStreamStatus = 'success' | 'error' | 'cancelled';

export type PetFeedbackTaskState = 'working' | 'waiting' | 'success' | 'error';
export type PetFeedbackSensitivity = 'public' | 'private';
export type PetFeedbackReassurance = 'making_progress' | 'waiting_safely' | 'completed' | 'work_preserved' | 'details_available';
export type PetFeedbackActionType = 'open_session' | 'confirm' | 'review_error';
export type PetFeedbackActionLabel = PetFeedbackActionType;
export type PetFeedbackProgress = { completed: number; total: number };
export type PetFeedback = {
  version: 2;
  taskState: PetFeedbackTaskState;
  /** Present only when the producer explicitly marks a short summary as ambient-safe. */
  publicSummary?: string;
  reassurance?: PetFeedbackReassurance;
  nextAction?: { type: PetFeedbackActionType; label: PetFeedbackActionLabel };
  sensitivity: PetFeedbackSensitivity;
  progress?: PetFeedbackProgress;
};

export interface ChatStreamEnvelope<TType extends string, TPayload> {
  type: TType;
  seq?: number;
  runId: string;
  sessionKey: string;
  timestamp: number;
  payload: TPayload;
}

export type RunStartEvent = ChatStreamEnvelope<'run_start', { channel: string }>;
export type UserMessageEvent = ChatStreamEnvelope<'user_message', { message: unknown }>;
export type UserTranscriptEvent = ChatStreamEnvelope<'user_transcript', { text: string; media?: unknown }>;
export type AssistantMessageStartEvent = ChatStreamEnvelope<'assistant_message_start', { messageId: string }>;
export type AssistantDeltaEvent = ChatStreamEnvelope<'assistant_delta', { messageId: string; delta: string }>;
export type ThinkingDeltaEvent = ChatStreamEnvelope<'thinking_delta', { messageId: string; delta: string }>;
export type ThinkingEndEvent = ChatStreamEnvelope<'thinking_end', { messageId: string }>;
export type ToolStartEvent = ChatStreamEnvelope<
  'tool_start',
  { messageId: string; toolCallId: string; toolName: string; args?: unknown }
>;
export type ToolUpdateEvent = ChatStreamEnvelope<
  'tool_update',
  { messageId: string; toolCallId: string; toolName: string; details?: unknown; textDelta?: string }
>;
export type ToolEndEvent = ChatStreamEnvelope<
  'tool_end',
  {
    messageId: string;
    toolCallId: string;
    toolName: string;
    status: ChatStreamStatus;
    result?: { content?: unknown[]; details?: unknown; text?: string };
    errorMessage?: string;
  }
>;
export type CommandStartedEvent = ChatStreamEnvelope<
  'command_started',
  { messageId: string; toolCallId: string; command: string; cwd?: string }
>;
export type CommandOutputDeltaEvent = ChatStreamEnvelope<
  'command_output_delta',
  { messageId: string; toolCallId: string; stream: 'stdout' | 'stderr'; delta: string }
>;
export type CommandCompletedEvent = ChatStreamEnvelope<
  'command_completed',
  {
    messageId: string;
    toolCallId: string;
    command: string;
    cwd?: string;
    exitCode: number | null;
    durationMs?: number;
    timedOut?: boolean;
    truncated?: boolean;
  }
>;
export type PatchAppliedEvent = ChatStreamEnvelope<
  'patch_applied',
  {
    messageId: string;
    toolCallId: string;
    changes: unknown[];
    diff: string;
    added: number;
    removed: number;
  }
>;
export type TurnPlanStatus = 'pending' | 'in_progress' | 'completed';
export type TurnPlanUpdatedEvent = ChatStreamEnvelope<
  'turn_plan',
  {
    messageId: string;
    explanation?: string;
    plan: { step: string; status: TurnPlanStatus }[];
  }
>;
export type TurnDiffEvent = ChatStreamEnvelope<
  'turn_diff',
  { messageId: string; files: string[]; diff: string; added: number; removed: number }
>;
export type ReviewStartEvent = ChatStreamEnvelope<
  'review_start',
  { messageId: string; reviewId: string; target: string; stage: 'preparing' | 'reviewing' }
>;
export type ReviewDeltaEvent = ChatStreamEnvelope<
  'review_delta',
  { messageId: string; reviewId: string; delta: string }
>;
export type ReviewEndEvent = ChatStreamEnvelope<
  'review_end',
  { messageId: string; reviewId: string; status: 'complete' | 'error'; message?: string }
>;
export type ReviewEvent = ChatStreamEnvelope<'review', { messageId: string; review: unknown }>;
export type AssistantMessageEndEvent = ChatStreamEnvelope<
  'assistant_message_end',
  { messageId: string; usage?: { inputTokens?: number; outputTokens?: number; totalTokens?: number; cost?: number } }
>;
export type ProgressEvent = ChatStreamEnvelope<
  'progress',
  { stage: string; message: string; detail?: string; toolName?: string; completed?: number; total?: number; petFeedback: PetFeedback }
>;
export type CompactionEvent = ChatStreamEnvelope<
  'compaction',
  { status: 'started' | 'completed' | 'skipped'; tokensBefore?: number; tokensAfter?: number; summary?: string }
>;
export type TtsAudioEvent = ChatStreamEnvelope<
  'tts_audio',
  { uri: string; mimeType: string; name: string; attachTo?: 'last_assistant'; messageId?: string }
>;
export type ClarifyRequestEvent = ChatStreamEnvelope<
  'clarify_request',
  { requestId: string; question: string; choices?: string[]; default?: string; petFeedback: PetFeedback }
>;
export type MemoryConsentRequiredEvent = ChatStreamEnvelope<
  'memory_consent_required',
  { requests: Array<{ id: string; recordId: string; statement: string; purpose: string }> }
>;
export type MemoryCapturedEvent = ChatStreamEnvelope<
  'memory_captured',
  { records: Array<{ id: string; content: string; kind: string }> }
>;
export type RunEndEvent = ChatStreamEnvelope<'run_end', { status: ChatStreamStatus; summary?: string; petFeedback: PetFeedback }>;
export type StreamErrorEvent = ChatStreamEnvelope<'error', { code: string; message: string; recoverable?: boolean; petFeedback: PetFeedback }>;

export type ChatStreamEvent =
  | RunStartEvent
  | UserMessageEvent
  | UserTranscriptEvent
  | AssistantMessageStartEvent
  | AssistantDeltaEvent
  | ThinkingDeltaEvent
  | ThinkingEndEvent
  | ToolStartEvent
  | ToolUpdateEvent
  | ToolEndEvent
  | CommandStartedEvent
  | CommandOutputDeltaEvent
  | CommandCompletedEvent
  | PatchAppliedEvent
  | TurnPlanUpdatedEvent
  | TurnDiffEvent
  | ReviewStartEvent
  | ReviewDeltaEvent
  | ReviewEndEvent
  | ReviewEvent
  | AssistantMessageEndEvent
  | ProgressEvent
  | CompactionEvent
  | TtsAudioEvent
  | ClarifyRequestEvent
  | MemoryConsentRequiredEvent
  | MemoryCapturedEvent
  | RunEndEvent
  | StreamErrorEvent;
