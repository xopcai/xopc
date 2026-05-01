import type { ClientHistoryMessage } from '../session/client-history.js';

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
}

/** Model choice for the selector overlay. */
export interface TuiModelChoice {
  id: string;
  name: string;
  provider: string;
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

  /** Send a chat message, returns the run id. */
  sendChat(opts: ChatSendOptions): Promise<{ runId: string }>;

  /** Abort an active run. */
  abortChat(opts: { sessionKey: string; runId: string }): Promise<{ ok: boolean }>;

  /** Load chat history for a session. */
  loadHistory(opts: {
    sessionKey: string;
    limit?: number;
  }): Promise<{ messages: HistoryMessage[] }>;

  /** List sessions. */
  listSessions(): Promise<TuiSessionItem[]>;

  /** Fetch session info (model, tokens, thinking). */
  getSessionInfo(sessionKey: string): Promise<SessionInfo>;

  /** List available models. */
  listModels(): Promise<TuiModelChoice[]>;

  /** Reset / create new session. */
  resetSession(sessionKey: string): Promise<void>;

  /** Patch session settings (e.g. model). */
  patchSession(
    sessionKey: string,
    patch: Record<string, unknown>,
  ): Promise<void>;
}

/** A single message in chat history (aligned with `ClientHistoryMessage`). */
export type HistoryMessage = ClientHistoryMessage;
