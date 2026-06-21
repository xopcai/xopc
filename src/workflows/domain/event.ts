import type { WorkflowArtifactRef, WorkflowResultEnvelope } from './result.js';
import type { WorkflowAgentInvocationSnapshot, WorkflowRun, WorkflowRunError } from './run.js';

export type WorkflowEventType =
  | 'run_queued'
  | 'run_started'
  | 'phase_started'
  | 'phase_completed'
  | 'agent_queued'
  | 'agent_started'
  | 'agent_step_started'
  | 'agent_step_completed'
  | 'agent_completed'
  | 'log_appended'
  | 'artifact_created'
  | 'run_completed'
  | 'run_failed'
  | 'run_cancelled';

export interface WorkflowEventEnvelope<T = WorkflowEventPayload> {
  id: string;
  runId: string;
  sequence: number;
  type: WorkflowEventType;
  payload: T;
  createdAtMs: number;
}

export type WorkflowEventPayload =
  | RunQueuedPayload
  | RunStartedPayload
  | PhaseStartedPayload
  | PhaseCompletedPayload
  | AgentQueuedPayload
  | AgentStartedPayload
  | AgentStepStartedPayload
  | AgentStepCompletedPayload
  | AgentCompletedPayload
  | LogAppendedPayload
  | ArtifactCreatedPayload
  | RunCompletedPayload
  | RunFailedPayload
  | RunCancelledPayload;

export interface RunQueuedPayload {
  run: WorkflowRun;
}

export interface RunStartedPayload {
  startedAtMs: number;
}

export interface PhaseStartedPayload {
  phaseId: string;
  title: string;
}

export interface PhaseCompletedPayload {
  phaseId: string;
}

export interface AgentQueuedPayload {
  agentId: string;
  label: string;
  phaseId?: string;
  prompt?: string;
  sessionKey: string;
  invocation?: WorkflowAgentInvocationSnapshot;
}


export interface AgentStartedPayload {
  agentId: string;
}

export interface AgentStepStartedPayload {
  agentId: string;
  stepId: string;
  label: string;
  kind: 'tool' | 'llm' | 'thinking';
  toolName?: string;
  detail?: string;
}

export interface AgentStepCompletedPayload {
  agentId: string;
  stepId: string;
  status: 'done' | 'error';
  resultPreview?: string;
  error?: string;
}

export interface AgentCompletedPayload {
  agentId: string;
  status: 'done' | 'error' | 'skipped';
  resultPreview?: string;
  error?: string;
}

export interface LogAppendedPayload {
  message: string;
}

export interface ArtifactCreatedPayload {
  artifact: WorkflowArtifactRef;
}

export interface RunCompletedPayload {
  result: WorkflowResultEnvelope;
}

export interface RunFailedPayload {
  error: WorkflowRunError;
}

export interface RunCancelledPayload {
  reason?: string;
}
