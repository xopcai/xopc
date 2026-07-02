import type { WorkflowDefinitionDefaults, WorkflowDefinitionEstimatedAgents, WorkflowPermissionPolicy, WorkflowResourceRefs } from './definition.js';
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
  metadata?: WorkflowRunMetadata;
  result?: WorkflowResultEnvelope;
  error?: WorkflowRunError;
  metrics: WorkflowRunMetrics;
  createdAtMs: number;
  startedAtMs?: number;
  completedAtMs?: number;
}

export interface WorkflowRunMetadata {
  sessionKey: string;
  triggerSource: WorkflowRunSource['kind'];
  agentId?: string;
  retryOfRunId?: string;
  replay?: WorkflowRunReplayMetadata;
  definition: WorkflowRunDefinitionSnapshot;
  input?: WorkflowRunInputEnvelope;
  correlation?: WorkflowRunCorrelation;
  origin?: WorkflowRunOrigin;
  schedule?: WorkflowRunScheduleMetadata;
  goalId?: string;
}

export type WorkflowRunReplayScope = 'failed_agents' | 'failed_phases';

export interface WorkflowRunReplayMetadata {
  sourceRunId: string;
  scope: WorkflowRunReplayScope;
  phaseIds?: string[];
  agentIds: string[];
  targetCount: number;
  createdAtMs: number;
}

export interface WorkflowRunInputEnvelope {
  payload: unknown;
  goal?: string;
  variables?: Record<string, unknown>;
  context?: Record<string, unknown>;
}

export interface WorkflowRunCorrelation {
  idempotencyKey?: string;
  requestId?: string;
  traceId?: string;
  parentRunId?: string;
}

export interface WorkflowRunOrigin {
  channel: string;
  sessionKey?: string;
  chatId?: string;
  messageId?: string;
  automationId?: string;
  runId?: string;
  requestId?: string;
}

export interface WorkflowRunScheduleMetadata {
  automationId: string;
  runId?: string;
  scheduledAtMs?: number;
}

export interface WorkflowRunDefinitionSnapshot {
  id: string;
  name: string;
  title: string;
  version: string;
  contentHash?: string;
  runtimeHash?: string;
  source: 'builtin' | 'user';
  tags: string[];
  phaseCount: number;
  defaults?: WorkflowDefinitionDefaults;
  permissions?: WorkflowPermissionPolicy;
  resources?: WorkflowResourceRefs;
  estimatedAgents?: WorkflowDefinitionEstimatedAgents;
}

export type WorkflowRunSource =
  | { kind: 'chat'; sessionKey: string; messageId?: string }
  | { kind: 'webui'; sessionKey?: string; requestId?: string }
  | { kind: 'automation'; automationId: string; runId?: string; scheduledAtMs?: number }
  | { kind: 'api'; requestId?: string; idempotencyKey?: string }
  | { kind: 'im'; channel: string; chatId: string; messageId?: string; userId?: string };

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
  metadata?: WorkflowRunMetadata;
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
  invocation?: WorkflowAgentInvocationSnapshot;
  sessionKey: string;
  transcriptMessageCount: number;
  currentStep?: string;
  resultPreview?: string;
  error?: string;
  startedAtMs?: number;
  completedAtMs?: number;
  steps: WorkflowAgentStepView[];
}

export interface WorkflowAgentInvocationSnapshot {
  prompt: string;
  label: string;
  phase?: string;
  modelRef?: string;
  resolvedModelRef?: string;
  schema?: unknown;
  toolset?: string[];
  maxIterations?: number;
}

export type WorkflowAgentStepStatus = 'running' | 'done' | 'error';

export interface WorkflowAgentStepView {
  id: string;
  label: string;
  kind: 'tool' | 'llm' | 'thinking';
  toolName?: string;
  detail?: string;
  status: WorkflowAgentStepStatus;
  resultPreview?: string;
  error?: string;
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
