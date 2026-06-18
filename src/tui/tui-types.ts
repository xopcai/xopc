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
  /** Theme id: `auto`, `dark`, `light`, or custom name under `~/.xopc/themes/`. */
  theme?: string;
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
  | 'running'
  | 'compacting'
  | 'stalled'
  | 'recovering'
  | 'aborting';

export type TuiEventSource = 'agent-response' | 'agent-resume' | 'broadcast' | 'embedded' | 'unknown';

export type TuiRunPhase =
  | 'idle'
  | 'sending'
  | 'waiting'
  | 'streaming'
  | 'tool'
  | 'progress'
  | 'stalled'
  | 'recovering'
  | 'aborting';

export interface TuiRunStatus {
  phase: TuiRunPhase;
  runId: string | null;
  directStreamRunId: string | null;
  lastCompletedRunId: string | null;
  source: TuiEventSource;
  lastEvent: string | null;
  lastActivityAt: number | null;
  stalledAt: number | null;
  recoveredAt: number | null;
}

/** Session metadata shown in the TUI footer. */
export interface SessionInfo {
  model?: string;
  modelProvider?: string;
  thinkingLevel?: string;
  reasoningLevel?: string;
  verboseLevel?: string;
  contextTokens?: number | null;
  totalTokens?: number | null;
  contextWindow?: number | null;
  contextUsagePercent?: number | null;
  displayName?: string;
}

/** Mutable state bag for the TUI runtime. */
export interface TuiState {
  currentSessionKey: string;
  activeRunId: string | null;
  isConnected: boolean;
  activityStatus: ActivityStatus;
  runStatus: TuiRunStatus;
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
  /** Queued Enter-while-busy steering messages after the first in-flight steer. */
  steeringQueue: string[];
  /** Ctrl+P cycle filter; `null` = all models from catalog. */
  scopedModelRefs: string[] | null;
  /** Last Escape timestamp for double-press actions. */
  lastEscapeAt: number;
  /** Human-readable progress from SSE `progress` events. */
  progressMessage: string | null;
  /** Session compaction in flight (local /compact handler). */
  isCompacting: boolean;
  /** Messages queued while compacting. */
  compactionQueue: string[];
}

export function createInitialState(sessionKey: string): TuiState {
  return {
    currentSessionKey: sessionKey,
    activeRunId: null,
    isConnected: false,
    activityStatus: 'idle',
    runStatus: {
      phase: 'idle',
      runId: null,
      directStreamRunId: null,
      lastCompletedRunId: null,
      source: 'unknown',
      lastEvent: null,
      lastActivityAt: null,
      stalledAt: null,
      recoveredAt: null,
    },
    connectionStatus: 'connecting',
    sessionInfo: {},
    autoMessageSent: false,
    historyLoaded: false,
    toolsExpanded: false,
    showThinking: false,
    lastCtrlCAt: 0,
    exitRequested: false,
    messageFollowUpQueue: [],
    steeringQueue: [],
    scopedModelRefs: null,
    lastEscapeAt: 0,
    progressMessage: null,
    isCompacting: false,
    compactionQueue: [],
  };
}
