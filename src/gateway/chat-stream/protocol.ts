export type ChatStreamStatus = 'success' | 'error' | 'cancelled';

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
export type AssistantMessageEndEvent = ChatStreamEnvelope<
  'assistant_message_end',
  { messageId: string; usage?: { inputTokens?: number; outputTokens?: number; totalTokens?: number; cost?: number } }
>;
export type ProgressEvent = ChatStreamEnvelope<'progress', { stage: string; message: string; detail?: string; toolName?: string }>;
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
  { requestId: string; question: string; choices?: string[]; default?: string }
>;
export type RunEndEvent = ChatStreamEnvelope<'run_end', { status: ChatStreamStatus; summary?: string }>;
export type StreamErrorEvent = ChatStreamEnvelope<'error', { code: string; message: string; recoverable?: boolean }>;

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
  | AssistantMessageEndEvent
  | ProgressEvent
  | CompactionEvent
  | TtsAudioEvent
  | ClarifyRequestEvent
  | RunEndEvent
  | StreamErrorEvent;
