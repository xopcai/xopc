import { runWorkflowScript } from './script-runtime.js';
import type {
  WorkflowRuntime,
  WorkflowRuntimeDeps,
  WorkflowRuntimeRunOptions,
  WorkflowRuntimeRunResult,
} from './workflow-runtime-port.js';

export class ScriptWorkflowRuntime implements WorkflowRuntime {
  run<T = unknown>(
    script: string,
    deps: WorkflowRuntimeDeps,
    options: WorkflowRuntimeRunOptions,
  ): Promise<WorkflowRuntimeRunResult<T>> {
    return runWorkflowScript<T>(script, deps, options);
  }
}

export function createScriptWorkflowRuntime(): WorkflowRuntime {
  return new ScriptWorkflowRuntime();
}
