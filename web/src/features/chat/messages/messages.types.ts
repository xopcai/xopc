/** Canonical chat message model for the web UI (gateway chat + embedded agent chat). */

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
  /**
   * Server-assigned tool call id from SSE `tool_start`. Optional because
   * historical / rehydrated transcripts may not have it. Used to route
   * `tool_update` snapshots back to the right block when multiple workflows
   * (or tools) run in the same assistant turn.
   */
  toolCallId?: string;
  name: string;
  input?: unknown;
  status: 'running' | 'done' | 'error';
  /** Serialized tool output; may be an object in edge cases (normalize before parsing). */
  result?: string | unknown;
  /**
   * Live structured details streamed from the tool while it's still running
   * (SSE `tool_update`). Only populated for tools that call `onUpdate` with
   * a structured `details` payload — today that's the `workflow` tool. The
   * WorkflowCard reads this first and falls back to `result` after `tool_end`.
   */
  details?: unknown;
};

/** Reasoning / thinking segment; order in `content` matches model execution (vs tools & text). */
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
  /** Thumbnail / first-page preview (base64), optional */
  preview?: string;
  extractedText?: string;
  /** Persisted media URI — fetch via `GET /api/media/read?uri=`. */
  uri?: string;
  /** Known clip length (sec). Set for recorded voice; HTML audio may omit WebM duration. */
  durationSeconds?: number;
};

/** Alias for message attachments (API / editor payloads). */
export type Attachment = MessageAttachment;

export interface Message {
  role: 'user' | 'assistant';
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
  return 'stream';
}
