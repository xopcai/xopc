import type { GatewayCredential } from '../gateway/credential.js';

/** TUI configuration options passed from CLI. */
export interface TuiOptions {
  /** Connect to a running gateway instead of embedded mode. */
  url?: string;
  /** Gateway shared credential for remote mode. */
  credential?: GatewayCredential;
  /** Session key to resume. */
  session?: string;
  /** Agent id for a fresh TUI session. */
  agentId?: string;
  /** Thinking level override. */
  thinking?: string;
  /** Single message to send on start, then stay open. */
  message?: string;
  /** Workspace directory for the new TUI session. */
  workdir?: string;
  /** Use the launch directory as the new TUI session workspace when no workdir is set. */
  useStartupCwd?: boolean;
  /** Run in embedded (local) mode — no gateway required. */
  local?: boolean;
  /** Theme id: `auto`, `dark`, `light`, or custom name under `~/.xopc/themes/`. */
  theme?: string;
  /** Open the session picker after the TUI connects instead of loading the startup session. */
  openSessionPickerOnStart?: boolean;
}

export type TuiExitReason = 'exit' | 'signal';

export interface TuiResult {
  exitReason: TuiExitReason;
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
  startedAt: number | null;
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
  effectiveWorkspacePath?: string;
  workingDirectoryLocked?: boolean;
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
  pendingInputCount: number;
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
      startedAt: null,
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
    pendingInputCount: 0,
    scopedModelRefs: null,
    lastEscapeAt: 0,
    progressMessage: null,
    isCompacting: false,
    compactionQueue: [],
  };
}
