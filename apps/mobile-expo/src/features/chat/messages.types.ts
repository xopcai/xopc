/**
 * Canonical chat message model for the mobile UI.
 * Ported from web/src/features/chat/messages.types.ts — kept in sync.
 */

export type TextContent = {
  type: 'text';
  text: string;
};

export type ImageContent = {
  type: 'image';
  source?: { data?: string; media_type?: string };
};

export type ToolUseContent = {
  type: 'tool_use';
  id: string;
  toolCallId?: string;
  name: string;
  input?: unknown;
  status: 'running' | 'done' | 'error';
  /** Serialized tool output; may be an object in edge cases. */
  result?: string | unknown;
  /** Live structured details from tool_update events. */
  details?: unknown;
};

/** Reasoning / thinking segment; order in `content` matches model execution. */
export type ThinkingContent = {
  type: 'thinking';
  text: string;
  streaming?: boolean;
};

export type AudioContent = {
  type: 'audio';
  workspaceRelativePath?: string;
  uri?: string;
  mimeType?: string;
  name?: string;
  durationSeconds?: number;
};

export type MessageContent = TextContent | ImageContent | ToolUseContent | ThinkingContent | AudioContent;

export type MessageAttachment = {
  id?: string;
  name?: string;
  type?: string;
  mimeType?: string;
  size?: number;
  content?: string;
  data?: string;
  preview?: string;
  extractedText?: string;
  uri?: string;
  workspaceRelativePath?: string;
  durationSeconds?: number;
};

export interface Message {
  id?: string;
  role: 'user' | 'assistant' | 'user-with-attachments';
  content: MessageContent[];
  attachments?: MessageAttachment[];
  usage?: {
    inputTokens?: number;
    outputTokens?: number;
    totalTokens?: number;
    cost?: number;
  };
  timestamp?: number;
}

export interface ProgressState {
  stage: string;
  message: string;
  detail?: string;
  toolName?: string;
  timestamp: number;
}

/** Session `agent-config.reasoningLevel` (matches server). */
export type ReasoningLevel = 'off' | 'on' | 'stream';

export function coerceReasoningLevel(raw: string | undefined): ReasoningLevel {
  if (raw === 'on' || raw === 'stream' || raw === 'off') return raw;
  return 'off';
}
