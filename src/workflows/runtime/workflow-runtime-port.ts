import type { Api, Model } from '@earendil-works/pi-ai';

import type { SubagentRunner, WorkflowRunOptions, WorkflowRunResult } from '../../agent/workflow/types.js';
import type { WorkflowGraph } from '../domain/definition.js';

export type WorkflowRuntimeSubagentRunner = SubagentRunner;
export type WorkflowRuntimeRunOptions = WorkflowRunOptions;
export type WorkflowRuntimeRunResult<T = unknown> = WorkflowRunResult<T>;

export interface WorkflowRuntimeDeps {
  runner: WorkflowRuntimeSubagentRunner;
  resolveModelId?: (modelId: string) => Model<Api>;
}

export interface WorkflowRuntime {
  run<T = unknown>(
    graph: WorkflowGraph,
    deps: WorkflowRuntimeDeps,
    options: WorkflowRuntimeRunOptions,
  ): Promise<WorkflowRuntimeRunResult<T>>;
}
