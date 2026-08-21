import type { ToolActivity } from '@xopcai/gateway-contract';

/** Canonical chat message model for the web UI (gateway chat + embedded agent chat). */

export type TextContent = {
  type: 'text';
  text: string;
  /** One model message segment within an assistant turn. */
  segmentId?: string;
  /** Pending text is intentionally rendered like narration until the segment ends. */
  presentation?: 'pending' | 'narration' | 'answer';
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
  activity?: ToolActivity;
  input?: unknown;
  status: 'running' | 'done' | 'error';
  /** Tool lifecycle timing from the stream or reconstructed session transcript. */
  startedAt?: number;
  completedAt?: number;
  durationMs?: number;
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

export type ReviewFindingContent = {
  title: string;
  body: string;
  priority: 0 | 1 | 2 | 3;
  confidenceScore?: number;
  filePath?: string;
  lineStart?: number;
  lineEnd?: number;
};

export type ReviewContent = {
  type: 'review';
  reviewId?: string;
  target: string;
  summary: string;
  findings: ReviewFindingContent[];
  overallCorrectness: 'patch is correct' | 'patch is incorrect' | 'unknown';
  overallExplanation: string;
  overallConfidenceScore?: number;
  generatedAt?: number;
  source?: 'model' | 'local';
  /** Isolated reviewer context state, present only while `/review` is streaming. */
  status?: 'preparing' | 'reviewing' | 'complete' | 'error';
  /** User-facing reviewer draft; never contains the model's transport JSON. */
  analysisMarkdown?: string;
  errorMessage?: string;
};

export type MessageContent = TextContent | ImageContent | ToolUseContent | ThinkingContent | ReviewContent;

export type MessageAttachment = {
  taskId?: string;
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
  /** Media store bucket (`inbound`, `tts`, `outbound`) when provided by the gateway. */
  bucket?: string;
  /** Absolute media-store path from persisted transcript metadata. Do not expose as a download URL. */
  path?: string;
  /** Workspace-relative generated artifact path, used for assistant output de-dupe. */
  workspaceRelativePath?: string;
  /** Known clip length (sec). Set for recorded voice; HTML audio may omit WebM duration. */
  durationSeconds?: number;
};

/** Alias for message attachments (API / editor payloads). */
export type Attachment = MessageAttachment;

export interface Message {
  role: 'user' | 'assistant';
  content: MessageContent[];
  /** Stable server run identifier used to attribute context and feedback. */
  turnId?: string;
  /** Client-only identity that survives live-to-persisted message reconciliation. */
  renderKey?: string;
  /** Client-only hint: reveal this live response progressively even if the transport already ended. */
  progressiveRender?: boolean;
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
  completed?: number;
  total?: number;
  timestamp: number;
}

/** Session `agent-config.reasoningLevel` (matches server). */
export type ReasoningLevel = 'off' | 'on' | 'stream';

export function coerceReasoningLevel(raw: string | undefined): ReasoningLevel {
  if (raw === 'on' || raw === 'stream' || raw === 'off') return raw;
  return 'on';
}
