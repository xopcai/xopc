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
  source?: { data?: string };
};

export type ToolUseContent = {
  type: 'tool_use';
  id: string;
  name: string;
  input?: unknown;
  status: 'running' | 'done' | 'error';
  /** Serialized tool output; may be an object in edge cases. */
  result?: string | unknown;
};

/** Reasoning / thinking segment; order in `content` matches model execution. */
export type ThinkingContent = {
  type: 'thinking';
  text: string;
  streaming?: boolean;
};

export type MessageContent = TextContent | ImageContent | ToolUseContent | ThinkingContent;

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
  workspaceRelativePath?: string;
  durationSeconds?: number;
};

export interface Message {
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
