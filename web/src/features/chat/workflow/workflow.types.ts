/**
 * Workflow snapshot types — mirrors `src/agent/workflow/types.ts` on the server.
 *
 * Kept as a separate literal copy on the web side so the chat package does not
 * have to import server-only modules. The server-side snapshot is the
 * authoritative shape; if a field is added there it should be added here.
 */

export type WorkflowAgentStatus = 'queued' | 'running' | 'done' | 'error' | 'skipped';

export type WorkflowAgentStepStatus = 'running' | 'done' | 'error';

export interface WorkflowAgentStep {
  id: string;
  kind: 'tool' | 'llm' | 'thinking';
  toolName?: string;
  label: string;
  detail?: string;
  status: WorkflowAgentStepStatus;
  startedAtMs?: number;
  durationMs?: number;
}

export interface WorkflowAgentSnapshot {
  id: number;
  label: string;
  phase?: string;
  prompt: string;
  status: WorkflowAgentStatus;
  resultPreview?: string;
  error?: string;
  startedAtMs?: number;
  durationMs?: number;
  steps?: WorkflowAgentStep[];
  currentStep?: string;
  iteration?: number;
  maxIterations?: number;
  streamText?: string;
}

export interface WorkflowSnapshot {
  name: string;
  description?: string;
  phases: string[];
  currentPhase?: string;
  logs: string[];
  agents: WorkflowAgentSnapshot[];
  agentCount: number;
  runningCount: number;
  doneCount: number;
  errorCount: number;
  skippedCount: number;
  durationMs?: number;
  result?: unknown;
}

/** Mirror of `src/agent/workflow/types.ts::WorkflowMeta`, optional fields included. */
export interface WorkflowMeta {
  name: string;
  description: string;
  whenToUse?: string;
  tags?: string[];
  estimatedAgents?: { min: number; max: number };
  examplePrompts?: Array<{ field: string; text: string }>;
  i18n?: Record<string, {
    description?: string;
    whenToUse?: string;
    examplePrompts?: Array<{ field: string; text: string }>;
  }>;
}

/**
 * What the WorkflowCard renders. The card distinguishes:
 *   - `running`: tool_use is still mid-flight; result is undefined. We show a
 *     skeletal "running" header with elapsed time. No tree yet.
 *   - `completed`: tool_use finished without error; the snapshot is filled.
 *   - `failed`: tool_use finished with `isError: true` — could be a parse
 *     error, an abort, a timeout, or a runtime crash. We render the error
 *     card instead of the tree.
 *
 * `failureKind` lets the failure card pick a friendlier title without parsing
 * the error message in the UI layer.
 */
export type WorkflowCardStatus = 'running' | 'completed' | 'failed';

export type WorkflowFailureKind = 'parse_error' | 'aborted' | 'timeout' | 'runtime_error';
