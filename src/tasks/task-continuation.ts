import { isXopcDatabaseOpen } from '../storage/sqlite/connection.js';
import { findSessionInputByRunId } from '../storage/sqlite/session-input-repository.js';
import { TaskRunRepository } from './task-run-repository.js';
import { getSessionMetadata } from '../storage/sqlite/session-repository.js';

export function getTaskExecutionDeadline(conversationId: string, runId: string): number | undefined {
  if (!isXopcDatabaseOpen()) return undefined;
  const input = findSessionInputByRunId(conversationId, runId);
  if (!input?.taskRunId) return undefined;
  const run = new TaskRunRepository().get(input.taskRunId);
  return run?.status === 'running' && run.conversationId === conversationId ? run.timeoutAt : undefined;
}

export function getTaskContinuation(conversationId: string, runId: string): { message: string; deadlineAtMs?: number } | undefined {
  if (!isXopcDatabaseOpen()) return undefined;
  const input = findSessionInputByRunId(conversationId, runId);
  if (!input?.taskRunId) return undefined;
  const run = new TaskRunRepository().get(input.taskRunId);
  const continuation = run?.policySnapshot.continuation as { message?: unknown; transcriptId?: string } | undefined;
  if (run?.status !== 'running' || run.conversationId !== conversationId || typeof continuation?.message !== 'string') return undefined;
  if (continuation.transcriptId && getSessionMetadata(conversationId)?.transcriptId !== continuation.transcriptId) {
    throw new Error('Cannot resume task because its execution transcript changed');
  }
  return { message: continuation.message, deadlineAtMs: run.timeoutAt };
}
