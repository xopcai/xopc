export interface AgentSseProgressState {
  stage: string;
  message: string;
  detail?: string;
  toolName?: string;
  timestamp: number;
}

export type AgentSseUserTranscriptAttachment = {
  uri?: string;
  workspaceRelativePath?: string;
  mimeType?: string;
  name?: string;
  durationSeconds?: number;
};

export type AgentSseUserTranscriptPayload = {
  text: string;
  attachments?: AgentSseUserTranscriptAttachment[];
};

export type AgentSseCommandStartedPayload = {
  toolCallId: string;
  command: string;
  cwd?: string;
};

export type AgentSseCommandOutputDeltaPayload = {
  toolCallId: string;
  stream: 'stdout' | 'stderr';
  delta: string;
};

export type AgentSseCommandCompletedPayload = {
  toolCallId: string;
  command: string;
  cwd?: string;
  exitCode: number | null;
  durationMs?: number;
  timedOut?: boolean;
  truncated?: boolean;
};

export type AgentSsePatchAppliedPayload = {
  toolCallId: string;
  changes: unknown[];
  diff: string;
  added: number;
  removed: number;
};

export type AgentSseTurnDiffPayload = {
  files: string[];
  diff: string;
  added: number;
  removed: number;
};

export type AgentSseTurnPlanUpdatedPayload = {
  explanation?: string;
  plan: { step: string; status: 'pending' | 'in_progress' | 'completed' }[];
};

export type AgentSseReviewPayload = {
  review: unknown;
};

export type AgentSseTtsAudioPayload = {
  uri: string;
  mimeType: string;
  name: string;
  attachTo?: 'last_assistant';
  messageId?: string;
};

export type AgentSseClarifyRequestPayload = {
  requestId: string;
  question: string;
  choices?: string[];
  default?: string;
};
