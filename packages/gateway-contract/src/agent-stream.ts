export interface AgentStreamProgressState {
  stage: string;
  message: string;
  detail?: string;
  toolName?: string;
  timestamp: number;
  petFeedback?: PetFeedback;
}

export type PetFeedbackTaskState = 'working' | 'waiting' | 'success' | 'error';
export type PetFeedbackSensitivity = 'public' | 'private';
export type PetFeedbackReassurance = 'making_progress' | 'waiting_safely' | 'completed' | 'work_preserved' | 'details_available';
export type PetFeedbackActionType = 'open_session' | 'confirm' | 'review_error';

export type PetFeedback = {
  version: 2;
  taskState: PetFeedbackTaskState;
  publicSummary?: string;
  reassurance?: PetFeedbackReassurance;
  nextAction?: { type: PetFeedbackActionType; label: PetFeedbackActionType };
  sensitivity: PetFeedbackSensitivity;
  progress?: { completed: number; total: number };
};

export type AgentStreamUserTranscriptAttachment = {
  uri?: string;
  workspaceRelativePath?: string;
  mimeType?: string;
  name?: string;
  durationSeconds?: number;
};

export type AgentStreamUserTranscriptPayload = {
  text: string;
  attachments?: AgentStreamUserTranscriptAttachment[];
};

export type AgentStreamCommandStartedPayload = {
  toolCallId: string;
  command: string;
  cwd?: string;
};

export type AgentStreamCommandOutputDeltaPayload = {
  toolCallId: string;
  stream: 'stdout' | 'stderr';
  delta: string;
};

export type AgentStreamCommandCompletedPayload = {
  toolCallId: string;
  command: string;
  cwd?: string;
  exitCode: number | null;
  durationMs?: number;
  timedOut?: boolean;
  truncated?: boolean;
};

export type AgentStreamPatchAppliedPayload = {
  toolCallId: string;
  changes: unknown[];
  diff: string;
  added: number;
  removed: number;
};

export type AgentStreamTurnDiffPayload = {
  files: string[];
  diff: string;
  added: number;
  removed: number;
};

export type AgentStreamTurnOutcomePayload = import('./turn-outcome.js').TurnOutcome;

export type AgentStreamTurnPlanUpdatedPayload = {
  explanation?: string;
  plan: { step: string; status: 'pending' | 'in_progress' | 'completed' }[];
};

export type AgentStreamReviewPayload = {
  review: unknown;
};

export type AgentStreamTtsAudioPayload = {
  uri: string;
  mimeType: string;
  name: string;
  attachTo?: 'last_assistant';
  messageId?: string;
};

export type AgentStreamClarifyRequestPayload = {
  requestId: string;
  question: string;
  choices?: string[];
  default?: string;
  petFeedback?: PetFeedback;
};

export type AgentStreamRunStatus = 'success' | 'error' | 'cancelled';

export type AgentStreamRunEndPayload = {
  runId: string;
  sessionKey: string;
  status: AgentStreamRunStatus;
  summary?: string;
};

/** Global gateway event emitted once after a webchat run reaches a terminal state. */
export type AgentRunEndedEvent = {
  schemaVersion: 1;
  runId: string;
  sessionKey: string;
  status: AgentStreamRunStatus;
  completedAtMs: number;
  target: import('./notifications.js').NotificationTarget;
  source: 'webchat';
  sessionTitle?: string;
};
