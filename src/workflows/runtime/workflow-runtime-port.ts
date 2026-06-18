import type { Api, Model } from '@earendil-works/pi-ai';

import type {
  SubagentRunner,
  WorkflowRunOptions as ScriptWorkflowRunOptions,
  WorkflowRunResult as ScriptWorkflowRunResult,
} from '../../agent/workflow/types.js';

export type WorkflowRuntimeSubagentRunner = SubagentRunner;
export type WorkflowRuntimeRunOptions = ScriptWorkflowRunOptions;
export type WorkflowRuntimeRunResult<T = unknown> = ScriptWorkflowRunResult<T>;

export interface WorkflowRuntimeDeps {
  runner: WorkflowRuntimeSubagentRunner;
  resolveModelId?: (modelId: string) => Model<Api>;
}

/**
 * Stable workflow execution port. Product services depend on this interface,
 * not on a concrete script/vm implementation.
 */
export interface WorkflowRuntime {
  run<T = unknown>(
    script: string,
    deps: WorkflowRuntimeDeps,
    options: WorkflowRuntimeRunOptions,
  ): Promise<WorkflowRuntimeRunResult<T>>;
}
