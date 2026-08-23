import type {
  WorkflowRunInputEnvelope,
  WorkflowRunContextRef,
  WorkflowRunReplayScope,
  WorkflowRunSource,
  WorkflowRunWritebackPolicy,
  WorkflowRunView,
} from '../domain/index.js';

export interface StartWorkflowRunServiceParams {
  agentId: string;
  definitionId: string;
  taskRunId?: string;
  parentSessionKey?: string;
  projectId?: string;
  contextRefs?: WorkflowRunContextRef[];
  writebackPolicy?: WorkflowRunWritebackPolicy;
  input?: unknown;
  inputEnvelope?: WorkflowRunInputEnvelope;
  goal?: string;
  source: WorkflowRunSource;
  concurrency?: number;
  maxSubagents?: number;
  tokenBudget?: number | null;
  retryOfRunId?: string;
  idempotencyKey?: string;
}

export interface StartWorkflowRunServiceResult {
  ok: true;
  runId: string;
  sessionKey: string;
}

export type WorkflowRunServiceErrorCode =
  | 'definition_not_found'
  | 'run_not_found'
  | 'invalid_input'
  | 'policy_denied'
  | 'connector_preflight_failed'
  | 'invalid_state';

export interface WorkflowRunServiceErrorResult {
  ok: false;
  code: WorkflowRunServiceErrorCode;
  message: string;
  httpStatus: 400 | 404 | 409;
  details?: unknown;
}

export type WorkflowRunServiceResult = StartWorkflowRunServiceResult | WorkflowRunServiceErrorResult;

export interface RetryWorkflowRunServiceParams {
  agentId: string;
  runId: string;
  projectId?: string;
}

export interface ReplayWorkflowRunServiceParams {
  agentId: string;
  runId: string;
  scope: WorkflowRunReplayScope;
}

export interface CancelWorkflowRunServiceParams {
  agentId: string;
  runId: string;
  reason?: string;
}

export interface CancelWorkflowRunServiceResult {
  ok: true;
  cancelled: boolean;
  alreadyFinished?: boolean;
}

export type CancelWorkflowRunResult = CancelWorkflowRunServiceResult | WorkflowRunServiceErrorResult;

/** Minimal surface for agent/automation callers (avoids importing the service class). */
export interface WorkflowRunServiceLike {
  startWorkflowRun(params: StartWorkflowRunServiceParams): Promise<WorkflowRunServiceResult>;
  readWorkflowRunView?(agentId: string, runId: string): Promise<WorkflowRunView | null>;
  cancelWorkflowRun?(params: CancelWorkflowRunServiceParams): Promise<CancelWorkflowRunResult>;
}
