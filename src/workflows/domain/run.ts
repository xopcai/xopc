import type { WorkflowArtifactRef, WorkflowResultEnvelope } from './result.js';

export type WorkflowRunStatus =
  | 'queued'
  | 'running'
  | 'succeeded'
  | 'failed'
  | 'cancelled'
  | 'timeout';

const TERMINAL_WORKFLOW_RUN_STATUSES = new Set<WorkflowRunStatus>([
  'succeeded',
  'failed',
  'cancelled',
  'timeout',
]);

export function isTerminalWorkflowRunStatus(status: WorkflowRunStatus): boolean {
  return TERMINAL_WORKFLOW_RUN_STATUSES.has(status);
}

export interface WorkflowRun {
  id: string;
  definitionId: string;
  definitionVersion: string;
  title: string;
  goal: string;
  input: unknown;
  status: WorkflowRunStatus;
  source: WorkflowRunSource;
  result?: WorkflowResultEnvelope;
  error?: WorkflowRunError;
  metrics: WorkflowRunMetrics;
  createdAtMs: number;
  startedAtMs?: number;
  completedAtMs?: number;
}

export type WorkflowRunSource =
  | { kind: 'chat'; sessionKey: string; messageId?: string }
  | { kind: 'webui' }
  | { kind: 'cron'; scheduleId: string }
  | { kind: 'api'; requestId?: string }
  | { kind: 'im'; channel: string; chatId: string };

export interface WorkflowRunMetrics {
  agentCount: number;
  doneAgentCount: number;
  errorAgentCount: number;
  skippedAgentCount: number;
  artifactCount: number;
  durationMs?: number;
}

export interface WorkflowRunError {
  code: WorkflowRunErrorCode;
  message: string;
  detail?: string;
  recoverable: boolean;
}

export type WorkflowRunErrorCode =
  | 'definition_not_found'
  | 'invalid_input'
  | 'runtime_error'
  | 'timeout'
  | 'cancelled'
  | 'result_validation_failed'
  | 'agent_quota_exceeded';

export interface WorkflowRunControls {
  canCancel: boolean;
  canRetry: boolean;
  canArchive: boolean;
}

export interface WorkflowRunSummary {
  id: string;
  definitionId: string;
  title: string;
  status: WorkflowRunStatus;
  source: WorkflowRunSource;
  createdAtMs: number;
  startedAtMs?: number;
  completedAtMs?: number;
  metrics: WorkflowRunMetrics;
}

export interface WorkflowRunView {
  run: WorkflowRun;
  phases: WorkflowPhaseView[];
  agents: WorkflowAgentView[];
  logs: WorkflowLogEntry[];
  artifacts: WorkflowArtifactRef[];
  timeline: WorkflowTimelineItem[];
  controls: WorkflowRunControls;
}

export type WorkflowPhaseStatus = 'pending' | 'running' | 'completed' | 'failed';

export interface WorkflowPhaseView {
  id: string;
  title: string;
  status: WorkflowPhaseStatus;
  startedAtMs?: number;
  completedAtMs?: number;
  agentIds: string[];
}

export type WorkflowAgentStatus = 'queued' | 'running' | 'done' | 'error' | 'skipped';

export interface WorkflowAgentView {
  id: string;
  label: string;
  phaseId?: string;
  status: WorkflowAgentStatus;
  prompt?: string;
  currentStep?: string;
  resultPreview?: string;
  error?: string;
  startedAtMs?: number;
  completedAtMs?: number;
  steps: WorkflowAgentStepView[];
}

export type WorkflowAgentStepStatus = 'running' | 'done' | 'error';

export interface WorkflowAgentStepView {
  id: string;
  label: string;
  kind: 'tool' | 'llm' | 'thinking';
  detail?: string;
  status: WorkflowAgentStepStatus;
  startedAtMs?: number;
  completedAtMs?: number;
}

export interface WorkflowLogEntry {
  sequence: number;
  message: string;
  createdAtMs: number;
}

export interface WorkflowTimelineItem {
  sequence: number;
  type: string;
  title: string;
  createdAtMs: number;
}
