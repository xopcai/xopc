/** TUI configuration options passed from CLI. */
export interface TuiOptions {
  /** Connect to a running gateway instead of embedded mode. */
  url?: string;
  /** Gateway bearer token. */
  token?: string;
  /** Session key to resume. */
  session?: string;
  /** Thinking level override. */
  thinking?: string;
  /** Single message to send on start, then stay open. */
  message?: string;
  /** Run in embedded (local) mode — no gateway required. */
  local?: boolean;
}

export type TuiExitReason = 'exit' | 'signal';

export interface TuiResult {
  exitReason: TuiExitReason;
}

/** SSE events emitted by POST /api/agent. */
export interface AgentSSEStatusEvent {
  status: string;
  runId: string;
}

export interface AgentSSETokenEvent {
  content: string;
}

export interface AgentSSEThinkingEvent {
  content: string;
  isDelta?: boolean;
}

export interface AgentSSEToolStartEvent {
  toolName: string;
  toolCallId: string;
  args?: unknown;
}

export interface AgentSSEToolEndEvent {
  toolName: string;
  toolCallId: string;
  isError: boolean;
  result?: string;
}

export interface AgentSSEErrorEvent {
  content: string;
}

export interface AgentSSEResultEvent {
  ok: boolean;
  payload?: { status?: string; summary?: string };
}

/** Parsed SSE event from the stream. */
export interface ParsedSSEEvent {
  event: string;
  data: string;
  id?: string;
}

/** Activity status for the TUI status bar. */
export type ActivityStatus =
  | 'idle'
  | 'sending'
  | 'waiting'
  | 'streaming'
  | 'running';

/** Session metadata shown in the TUI footer. */
export interface SessionInfo {
  model?: string;
  modelProvider?: string;
  thinkingLevel?: string;
  contextTokens?: number | null;
  totalTokens?: number | null;
  displayName?: string;
}

/** Mutable state bag for the TUI runtime. */
export interface TuiState {
  currentSessionKey: string;
  activeRunId: string | null;
  isConnected: boolean;
  activityStatus: ActivityStatus;
  connectionStatus: string;
  sessionInfo: SessionInfo;
  autoMessageSent: boolean;
  historyLoaded: boolean;
  toolsExpanded: boolean;
  showThinking: boolean;
  /** Last Ctrl+C timestamp for double-press exit (see `resolveCtrlCAction`). */
  lastCtrlCAt: number;
  exitRequested: boolean;
  /** Queued via Alt+Enter while a run is active; flushed FIFO when the run ends. */
  messageFollowUpQueue: string[];
}

export function createInitialState(sessionKey: string): TuiState {
  return {
    currentSessionKey: sessionKey,
    activeRunId: null,
    isConnected: false,
    activityStatus: 'idle',
    connectionStatus: 'connecting',
    sessionInfo: {},
    autoMessageSent: false,
    historyLoaded: false,
    toolsExpanded: false,
    showThinking: false,
    lastCtrlCAt: 0,
    exitRequested: false,
    messageFollowUpQueue: [],
  };
}
