import type { ClientHistoryMessage } from '../session/client-history.js';
import type { ExportFormat } from '../session/types.js';

import type { SessionInfo } from './tui-types.js';

/** Options for sending a chat message. */
export interface ChatSendOptions {
  sessionKey: string;
  message: string;
  thinking?: string;
}

/** SSE event from the agent stream or broadcast channel. */
export interface TuiEvent {
  event: string;
  data: unknown;
}

/** Minimal session list item. */
export interface TuiSessionItem {
  key: string;
  updatedAt?: number | null;
  model?: string | null;
  totalTokens?: number | null;
  displayName?: string;
  messageCount?: number;
  forkedFromSessionKey?: string;
  cwd?: string;
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

export type TuiExportFormat = ExportFormat | 'html';

export interface TuiCompactionResult {
  compacted: boolean;
  summary?: string;
  tokensBefore?: number;
  tokensAfter?: number;
  transcriptSummary?: string;
}

export interface TuiBranchSummary {
  sourceSessionKey: string;
  targetSessionKey: string;
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
 * Abstraction over the gateway (SSE) or embedded agent backend.
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
  /** Broadcast SSE sequence gap (if the gateway emits `gap` events). */
  onGap?: (info: { expected: number; received: number }) => void;

  /** Start the backend (open SSE streams / start agent service). */
  start(): void;

  /** Stop the backend. */
  stop(): void;

  /** Current active chat abort signal, if a run is in progress. */
  getActiveSignal?(): AbortSignal | undefined;

  /** Send a chat message, returns the run id. */
  sendChat(opts: ChatSendOptions): Promise<{ runId: string }>;

  /** Abort an active run. */
  abortChat(opts: { sessionKey: string; runId: string }): Promise<{ ok: boolean }>;

  /** Inject steering text into an active run (tool-boundary delivery). */
  steerChat(opts: { sessionKey: string; message: string }): Promise<{ ok: boolean }>;

  /** Load chat history for a session. */
  loadHistory(opts: {
    sessionKey: string;
    limit?: number;
  }): Promise<{ messages: HistoryMessage[] }>;

  /** Load current transcript rows as a tree-shaped list. */
  loadTranscriptTree(sessionKey: string): Promise<TuiTranscriptTreeEntry[]>;

  /** Compute transcript message/token statistics. */
  getSessionStats(sessionKey: string): Promise<TuiSessionStats>;

  /** List sessions. */
  listSessions(): Promise<TuiSessionItem[]>;

  /** Fetch session info (model, tokens, thinking). */
  getSessionInfo(sessionKey: string): Promise<SessionInfo>;

  /** List available models. */
  listModels(): Promise<TuiModelChoice[]>;

  /** Reset / create new session. */
  resetSession(sessionKey: string): Promise<void>;

  /** Rename session display name. */
  renameSession(sessionKey: string, name: string): Promise<{ ok: boolean }>;

  /** Delete session and transcript. */
  deleteSession(sessionKey: string): Promise<{ ok: boolean }>;

  /** Patch session settings (e.g. model). */
  patchSession(
    sessionKey: string,
    patch: Record<string, unknown>,
  ): Promise<void>;

  /** Compact session transcript (returns whether compaction ran). */
  compactSession(
    sessionKey: string,
    options?: { force?: boolean; instructions?: string },
  ): Promise<TuiCompactionResult>;

  /** Export a session transcript. */
  exportSession(sessionKey: string, format: ExportFormat): Promise<string>;

  /** Import an xopc JSON session export into a new session key. */
  importSession(
    targetSessionKey: string,
    jsonContent: string,
  ): Promise<{ sessionKey: string; rowCount: number }>;

  /** Create a share link for a workspace file/folder/site artifact. */
  createShare(
    sessionKey: string,
    request: TuiShareRequest,
    options?: { agentId?: string },
  ): Promise<TuiShareResult>;

  /** Ask an ephemeral side question using this session as read-only background. */
  btwQuery(sessionKey: string, question: string): Promise<{ text: string; error?: string }>;

  /** Fork one session transcript into a new session key. */
  forkSession(
    sourceSessionKey: string,
    targetSessionKey: string,
  ): Promise<{ sessionKey: string; rowCount: number }>;

  /** Fork one session transcript through a selected transcript-tree entry. */
  forkSessionAt(
    sourceSessionKey: string,
    targetSessionKey: string,
    entryId: string,
  ): Promise<{ sessionKey: string; rowCount: number }>;

  /** Append or clear a label for a transcript entry. */
  setTranscriptLabel(
    sessionKey: string,
    entryId: string,
    label: string | undefined,
  ): Promise<{ ok: boolean }>;

  /** Append extension state for replay by TUI extension sessionManager APIs. */
  appendCustomEntry(
    sessionKey: string,
    customType: string,
    data?: unknown,
  ): Promise<{ ok: boolean }>;

  /** Append a visible extension custom message. */
  appendCustomMessage(
    sessionKey: string,
    message: {
      customType: string;
      content?: string | unknown[];
      display?: boolean;
      details?: unknown;
    },
  ): Promise<{ ok: boolean }>;
}

/** A single message in chat history (aligned with `ClientHistoryMessage`). */
export type HistoryMessage = ClientHistoryMessage;
