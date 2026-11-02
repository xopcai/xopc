import { AsyncLocalStorage } from 'node:async_hooks';
import { connectorArgumentsHash } from '../../connectors/approval.js';

export type PreparedActionApproval = {
  toolRef: string;
  arguments: Record<string, unknown>;
  binding: Record<string, unknown>;
  readOnly: boolean;
  confirmationRequired: boolean;
};
type PreparedApprover = (action: PreparedActionApproval) => Promise<boolean>;
type EmbeddedExecutionContext = { conversationId: string; runId?: string; actionApprovers?: Map<string, PreparedApprover>; reviewedArguments?: Map<string, string>; dispatchGuards?: Map<string, () => void> };

const executionSessionStorage = new AsyncLocalStorage<EmbeddedExecutionContext>();

export function withoutEmbeddedExecutionSession<T>(run: () => T): T {
  return executionSessionStorage.exit(run);
}

export function runWithEmbeddedExecutionSession<T>(
  conversationId: string,
  run: () => T,
  runId?: string,
): T {
  return executionSessionStorage.run({ conversationId, runId }, run);
}

export function getEmbeddedExecutionSession(): string | undefined {
  return executionSessionStorage.getStore()?.conversationId;
}

export function getEmbeddedExecutionRunId(): string | undefined {
  return executionSessionStorage.getStore()?.runId;
}

/** Preparation adapters share the current host gate without owning approval state. */
export function setPreparedActionApprover(toolCallId: string, approve: PreparedApprover): boolean {
  const execution = executionSessionStorage.getStore();
  if (!execution?.runId) return false;
  (execution.actionApprovers ??= new Map()).set(toolCallId, approve);
  return true;
}

export function requestPreparedActionApproval(toolCallId: string, action: PreparedActionApproval): Promise<boolean> | undefined {
  return executionSessionStorage.getStore()?.actionApprovers?.get(toolCallId)?.(action);
}

export function bindReviewedToolArguments(toolCallId: string, args: Record<string, unknown>): void {
  const execution = executionSessionStorage.getStore();
  if (execution) (execution.reviewedArguments ??= new Map()).set(toolCallId, connectorArgumentsHash(args));
}

export function assertReviewedToolArguments(toolCallId: string, args: Record<string, unknown>): void {
  const accepted = executionSessionStorage.getStore()?.reviewedArguments?.get(toolCallId);
  if (accepted && accepted !== connectorArgumentsHash(args)) throw new Error('Tool arguments changed after approval. Prepare a new tool call.');
}

export function bindActionDispatchGuard(toolCallId: string, guard: () => void): void {
  const execution = executionSessionStorage.getStore();
  if (execution) (execution.dispatchGuards ??= new Map()).set(toolCallId, guard);
}

export function getActionDispatchGuard(toolCallId: string): (() => void) | undefined {
  return executionSessionStorage.getStore()?.dispatchGuards?.get(toolCallId);
}
