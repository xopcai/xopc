import type { WorkflowRunSource } from './run.js';

export type WorkflowCommand =
  | StartWorkflowRunCommand
  | CancelWorkflowRunCommand
  | ArchiveWorkflowRunCommand;

export interface StartWorkflowRunCommand {
  type: 'start_run';
  definitionId: string;
  input?: unknown;
  source: WorkflowRunSource;
  goal?: string;
}

export interface CancelWorkflowRunCommand {
  type: 'cancel_run';
  runId: string;
  reason?: string;
}

export interface ArchiveWorkflowRunCommand {
  type: 'archive_run';
  runId: string;
}
