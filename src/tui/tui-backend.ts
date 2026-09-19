import type { ClientHistoryMessage } from '../session/client-history.js';
import type { SessionTimelineItem } from '../session/transcript-outline.js';
import type { ExportFormat } from '../session/types.js';
import type { ReviewContext } from '../review/review-git.js';

import type { SessionInfo, TuiEventSource } from './tui-types.js';
import type { TuiChatInputDelivery, TuiChatInputState } from './tui-chat-input-state.js';

export type { TuiChatInput, TuiChatInputDelivery, TuiChatInputState, TuiChatInputStatus } from './tui-chat-input-state.js';
export { countPendingChatInputs } from './tui-chat-input-state.js';

/** Options for sending a chat message. */
export interface ChatSendOptions {
  conversationId: string;
  message: string;
  attachments?: TuiInboundAttachment[];
  thinking?: string;
}

export interface TuiInboundAttachment {
  id?: string;
  type: string;
  mimeType?: string;
  data?: string;
  name?: string;
  size?: number;
  uri?: string;
}

/** Event from an agent run or gateway topic. */
export interface TuiEvent {
  event: string;
  data: unknown;
  source?: TuiEventSource;
}

export interface TuiComposerHistoryItem {
  id: number;
  text: string;
  createdAt: number;
}

/** Minimal session list item. */
export interface TuiSessionItem {
  agentId?: string;
  sourceChannel?: string;
  generatedShell?: boolean;
  key: string;
  updatedAt?: number | null;
  model?: string | null;
  totalTokens?: number | null;
  displayName?: string;
  messageCount?: number;
  forkedFromConversationId?: string;
  cwd?: string;
}

export interface TuiAgentInfo {
  id: string;
  enabled: boolean;
  displayName?: string;
}

/** Model choice for the selector overlay. */
export interface TuiModelChoice {
  id: string;
  name: string;
  provider: string;
  contextWindow?: number;
}

export interface TuiSessionStats {
  totalMessages: number;
  userMessages: number;
  assistantMessages: number;
  toolCalls: number;
  toolResults: number;
  contextRows: number;
  tokens: {
    input: number;
    output: number;
    cacheRead: number;
    cacheWrite: number;
    total: number;
  };
}

export interface TuiHistoryWindow {
  messages: HistoryMessage[];
  startRowNumber: number;
  endRowNumber: number;
  totalRows: number;
}

export type TuiExportFormat = ExportFormat | 'html';

export interface TuiCompactionResult {
  compacted: boolean;
  summary?: string;
  tokensBefore?: number;
  tokensAfter?: number;
  transcriptSummary?: string;
}

export interface TuiBranchSummary {
  sourceConversationId: string;
  targetConversationId: string;
  rowCount: number;
  entryId?: string;
  restoredText?: string;
}

export type TuiShareAudience = 'friend' | 'colleague' | 'public';
export type TuiShareMode = 'auto' | 'force-file' | 'force-site' | 'force-zip';

export interface TuiShareRequest {
  path: string;
  audience?: TuiShareAudience;
  mode?: TuiShareMode;
  title?: string;
  description?: string;
}

export interface TuiShareResult {
  kind: string;
  shareUrl: string;
  title?: string;
  description?: string;
  thumbnailUrl?: string;
  reachability?: string;
  reachabilityHint?: string | null;
  expiresAt?: string;
  maxViews?: number | null;
  routingReason?: string;
  routingHint?: string;
}

export interface TuiStartupResources {
  context: string[];
  skills: string[];
  workflows: string[];
  connectors: string[];
}

export interface TuiWorkspaceFileSearchEntry {
  name: string;
  path: string;
  isDirectory: boolean;
}

export interface TuiWorkflowRunStartRequest {
  conversationId: string;
  definitionId: string;
  agentId?: string;
  goal?: string;
  input?: unknown;
}

export interface TuiWorkflowRunStartResult {
  runId: string;
  conversationId: string;
  definitionId: string;
}

export interface TuiStartupProjectResult {
  project: {
    id: string;
    name: string;
    defaultAgentId?: string;
    workspaceRoot?: string;
  } | null;
  created?: boolean;
  reason?: 'exact' | 'contained' | 'auto_created';
}

/** Read-only transcript tree row for current-session navigation/inspection. */
export interface TuiTranscriptTreeEntry {
  id: string;
  parentId?: string;
  depth: number;
  label: string;
  role?: string;
  userLabel?: string;
  labelTimestamp?: string;
  turn: number;
  preview?: string;
  contentText?: string;
  toolCallPreview?: string;
  createdAt?: string;
  isOnActivePath?: boolean;
  isCurrentLeaf?: boolean;
}

/**
 * Abstraction over the realtime gateway or embedded agent backend.
 *
 * Both implementations expose the same surface so the TUI core stays
 * transport-agnostic.
 */
export interface TuiBackend {
  /** Connection metadata (for header display). */
  readonly connectionLabel: string;

  /** Lifecycle callbacks wired by the TUI. */
  onEvent?: (evt: TuiEvent) => void;
  onConnected?: () => void;
  onDisconnected?: (reason: string) => void;
  /** Realtime sequence gap. */
  onGap?: (info: { expected: number; received: number }) => void;

  /** Start the backend connection or embedded agent service. */
  start(): void;

  /** Stop the backend. */
  stop(): void;

  /** Current active chat abort signal, if a run is in progress. */
  getActiveSignal?(): AbortSignal | undefined;

  /** Global composer history, shared across sessions and clients. */
  getComposerInputHistory(): Promise<TuiComposerHistoryItem[]>;

  /** Persist one submitted chat input. */
  recordComposerInputHistory(text: string): Promise<TuiComposerHistoryItem>;

  /** Send a chat message, returns the run id. */
  sendChat(opts: ChatSendOptions): Promise<{ runId: string }>;

  /** Reattach to a live gateway/webchat run when the original response stream stalled. */
  resumeChat?(opts: { conversationId: string; runId: string }): Promise<{ ok: boolean; reason?: string }>;

  /** Abort an active run. */
  abortChat(opts: { conversationId: string; runId: string }): Promise<{ ok: boolean }>;

  /** Inject steering text into an active run (tool-boundary delivery). */
  submitChatInput(opts: { conversationId: string; message: string; delivery: TuiChatInputDelivery }): Promise<{
    ok: boolean;
    effectiveDelivery?: TuiChatInputDelivery;
    state?: TuiChatInputState;
  }>;
  getChatInputState(conversationId: string): Promise<TuiChatInputState>;
  updateChatInput(opts: {
    conversationId: string;
    inputId: string;
    version: number;
    content: string;
  }): Promise<{ ok: boolean; state?: TuiChatInputState }>;
  removeChatInput(opts: {
    conversationId: string;
    inputId: string;
    version: number;
  }): Promise<{ ok: boolean; state?: TuiChatInputState }>;

  /** Start a workflow run directly, without routing through the LLM. */
  startWorkflowRun?(opts: TuiWorkflowRunStartRequest): Promise<TuiWorkflowRunStartResult>;

  /** Resolve or create the project implied by the TUI launch workspace. */
  resolveStartupProject?(opts: {
    workspacePath: string;
    conversationId: string;
    agentId: string;
    autoCreate?: boolean;
  }): Promise<TuiStartupProjectResult>;

  /** Load startup resources shown in `/start` and initial help. */
  getStartupResources?(conversationId: string): Promise<TuiStartupResources>;

  /** Re-evaluate project-scoped resources after a local trust decision changes. */
  refreshWorkspaceTrust?(): void | Promise<void>;

  /** Fuzzy search files in this session's effective workspace. */
  searchWorkspaceFiles?(
    conversationId: string,
    query: string,
    options?: { limit?: number },
  ): Promise<TuiWorkspaceFileSearchEntry[]>;

  /** Load git branches/commits/status for the interactive review launcher. */
  getReviewContext?(conversationId: string): Promise<ReviewContext>;

  /** Load chat history for a session. */
  loadHistory(opts: {
    conversationId: string;
    limit?: number;
  }): Promise<{ messages: HistoryMessage[] }>;

  /** Load a bounded transcript window around a persisted row number. */
  loadHistoryWindow?(opts: {
    conversationId: string;
    rowNumber: number;
    before?: number;
    after?: number;
  }): Promise<TuiHistoryWindow>;

  /** Load current transcript rows as a tree-shaped list. */
  loadTranscriptTree(conversationId: string): Promise<TuiTranscriptTreeEntry[]>;

  /** Load current transcript rows as timeline items for turn navigation. */
  loadTimeline(conversationId: string): Promise<SessionTimelineItem[]>;

  /** Compute transcript message/token statistics. */
  getSessionStats(conversationId: string): Promise<TuiSessionStats>;

  /** List sessions. */
  listSessions(): Promise<TuiSessionItem[]>;

  /** List agents available for TUI agent switching. */
  listAgents(): Promise<TuiAgentInfo[]>;

  /** Persist the default agent for fresh TUI sessions. */
  setTuiDefaultAgent?(agentId: string): Promise<{ agentId: string }>;

  /** Fetch session info (model, tokens, thinking). */
  getSessionInfo(conversationId: string): Promise<SessionInfo>;
  createConversation(agentId: string, conversationId?: string): Promise<string>;

  /** List available models. */
  listModels(): Promise<TuiModelChoice[]>;

  /** Refresh dynamic model catalogs after credentials change. */
  refreshModels?(): Promise<void>;

  /** Reset / create new session. */
  resetSession(conversationId: string): Promise<void>;

  /** Rename session display name. */
  renameSession(conversationId: string, name: string): Promise<{ ok: boolean }>;

  /** Delete session and transcript. */
  deleteSession(conversationId: string): Promise<{ ok: boolean }>;

  /** Patch session settings (e.g. model). */
  patchSession(
    conversationId: string,
    patch: Record<string, unknown>,
  ): Promise<void>;

  /** Compact session transcript (returns whether compaction ran). */
  compactSession(
    conversationId: string,
    options?: { force?: boolean; instructions?: string },
  ): Promise<TuiCompactionResult>;

  /** Export a session transcript. */
  exportSession(conversationId: string, format: ExportFormat): Promise<string>;

  /** Import an xopc JSON session export into a new session key. */
  importSession(
    targetConversationId: string,
    jsonContent: string,
  ): Promise<{ conversationId: string; rowCount: number }>;

  /** Create a share link for a workspace file/folder/site artifact. */
  createShare(
    conversationId: string,
    request: TuiShareRequest,
    options?: { agentId?: string },
  ): Promise<TuiShareResult>;

  /** Ask an ephemeral side question using this session as read-only background. */
  btwQuery(conversationId: string, question: string): Promise<{ text: string; error?: string }>;

  /** Fork one session transcript into a new session key. */
  forkSession(
    sourceConversationId: string,
    targetConversationId: string,
  ): Promise<{ conversationId: string; rowCount: number }>;

  /** Fork one session transcript through a selected transcript-tree entry. */
  forkSessionAt(
    sourceConversationId: string,
    targetConversationId: string,
    entryId: string,
  ): Promise<{ conversationId: string; rowCount: number }>;

  /** Append or clear a label for a transcript entry. */
  setTranscriptLabel(
    conversationId: string,
    entryId: string,
    label: string | undefined,
  ): Promise<{ ok: boolean }>;

  /** Append extension state for replay by TUI extension sessionManager APIs. */
  appendCustomEntry(
    conversationId: string,
    customType: string,
    data?: unknown,
  ): Promise<{ ok: boolean }>;

  /** Append a visible extension custom message. */
  appendCustomMessage(
    conversationId: string,
    message: {
      customType: string;
      content?: string | unknown[];
      display?: boolean;
      details?: unknown;
    },
  ): Promise<{ ok: boolean }>;

  /** Persist a local TUI shell execution for replay and optional LLM context. */
  appendBashExecution(
    conversationId: string,
    entry: {
      command: string;
      output?: string;
      exitCode?: number | null;
      signal?: string | null;
      excludeFromContext?: boolean;
      truncated?: boolean;
      fullOutputPath?: string;
    },
  ): Promise<{ ok: boolean }>;
}

/** A single message in chat history (aligned with `ClientHistoryMessage`). */
export type HistoryMessage = ClientHistoryMessage;
