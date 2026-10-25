import { randomUUID } from 'node:crypto';

import { DurableState } from '../storage/sqlite/durable-state.js';
import { isXopcDatabaseOpen } from '../storage/sqlite/connection.js';
import { getSqliteDatabase, runSqliteWriteTransaction } from '../storage/sqlite/transaction.js';
import { readCurrentTranscriptId } from '../storage/sqlite/session-instance-repository.js';
import { findSessionInputByRunId, getSessionInputById, insertSessionInput, type SessionInput } from '../storage/sqlite/session-input-repository.js';
import { PhoneError, type PhoneReport, type PhoneTaskContract } from './contracts.js';
import { TaskRunRepository } from '../tasks/task-run-repository.js';

export type PhoneCheckpoint = {
  report: Pick<PhoneReport, 'sessionId' | 'deviceId' | 'deviceName' | 'owner' | 'agentId' | 'modelRef' | 'executionMode'>;
  deviceRevision: number;
  task: PhoneTaskContract;
  usage: { actions: number; modelRequests: number; activeDurationMs: number };
};
export type PhoneAssistance = {
  id: string; conversationId: string; transcriptId: string; originRunId: string; toolCallId: string;
  checkpoint: PhoneCheckpoint; version: number; createdAt: number;
  status: 'open' | 'queued' | 'resuming' | 'completed' | 'cancelled';
  queuedInputId?: string;
  taskRunId?: string;
  objectiveInputId?: string;
};
const waits = new DurableState<PhoneAssistance>('phone.assistance');

function markTaskWaiting(wait: PhoneAssistance): void {
  if (!wait.taskRunId) return;
  const runs = new TaskRunRepository(); const run = runs.get(wait.taskRunId);
  if (run?.status !== 'running') return;
  if (!runs.listActiveWaits(run.taskId).some(item => item.taskRunId === run.id && item.condition.phoneTaskId === wait.checkpoint.task.taskId))
    runs.createWait({ taskId: run.taskId, taskRunId: run.id, kind: 'user_input', reason: 'Phone requires manual operation',
      condition: { phoneAssistanceId: wait.id, phoneTaskId: wait.checkpoint.task.taskId } });
  runs.setStatus({ runId: run.id, expectedVersion: run.version, from: ['running'], to: 'waiting', actor: { kind: 'system' } });
}

export function phoneAssistance(conversationId: string): PhoneAssistance | undefined {
  if (!isXopcDatabaseOpen()) return undefined;
  const wait = waits.get(conversationId);
  if (wait && readCurrentTranscriptId(getSqliteDatabase(), conversationId) !== wait.transcriptId) { waits.delete(conversationId); return undefined; }
  return wait;
}
export function pendingPhoneAssistance(): PhoneAssistance[] {
  return isXopcDatabaseOpen() ? waits.values().filter(wait => ['open', 'queued'].includes(wait.status)
    && phoneAssistance(wait.conversationId)?.id === wait.id) : [];
}
export function isPhoneAssistanceSuspended(conversationId: string, runId: string): boolean {
  return phoneAssistance(conversationId)?.originRunId === runId;
}
export function requirePhoneAssistance(conversationId: string, runId: string, toolCallId: string, checkpoint: PhoneCheckpoint): PhoneAssistance {
  return runSqliteWriteTransaction(db => {
    const transcriptId = readCurrentTranscriptId(db, conversationId);
    if (!transcriptId) throw new PhoneError('PHONE_CONVERSATION_NOT_FOUND', 'Phone assistance requires a saved conversation', 409);
    const current = phoneAssistance(conversationId);
    if (current?.originRunId === runId && current.toolCallId === toolCallId) return current;
    const origin = findSessionInputByRunId(conversationId, runId);
    const wait: PhoneAssistance = { id: randomUUID(), conversationId, transcriptId, originRunId: runId,
      toolCallId, checkpoint, status: 'open', version: 1, createdAt: Date.now(), taskRunId: origin?.taskRunId,
      objectiveInputId: current?.queuedInputId === origin?.id ? current?.objectiveInputId : origin?.id };
    markTaskWaiting(wait);
    waits.set(conversationId, wait); return wait;
  });
}
export function cancelPhoneAssistance(conversationId: string): void {
  if (!isXopcDatabaseOpen()) return;
  runSqliteWriteTransaction(() => {
    const wait = isXopcDatabaseOpen() ? waits.get(conversationId) : undefined;
    if (!wait) return;
    if (wait.taskRunId && ['open', 'queued', 'resuming'].includes(wait.status)) {
      const runs = new TaskRunRepository(); const run = runs.get(wait.taskRunId);
      if (run && ['queued', 'running', 'waiting', 'verifying'].includes(run.status)) {
        for (const item of runs.listActiveWaits(run.taskId)) {
          if (item.condition.phoneTaskId === wait.checkpoint.task.taskId) runs.resolveWait({ waitId: item.id, actor: { kind: 'user' }, resolution: { cancelled: true } });
        }
        runs.finalize({ runId: run.id, expectedVersion: run.version, actor: { kind: 'user' }, terminalCode: 'cancelled_by_user',
          receipt: { status: 'cancelled', summary: 'Phone task cancelled', changes: [], evidence: [], verification: { status: 'unverified', checks: [] }, remainingWork: [], needsUser: false, completionVerdict: 'not_achieved' } });
      }
    }
    waits.set(conversationId, { ...wait, status: 'cancelled', version: wait.version + 1 });
  });
}
/** The wait and its deduplicated continuation commit together, even while the old run is closing. */
export function queuePhoneAssistance(conversationId: string, waitId: string): PhoneAssistance {
  return runSqliteWriteTransaction(() => {
    const wait = phoneAssistance(conversationId);
    if (!wait || wait.id !== waitId || wait.status === 'cancelled') throw new PhoneError('PHONE_ASSISTANCE_CHANGED', 'The phone task changed. Refresh before continuing.', 409);
    if (wait.status !== 'open') return wait;
    const original = (wait.objectiveInputId ? getSessionInputById(conversationId, wait.objectiveInputId) : undefined)
      ?? findSessionInputByRunId(conversationId, wait.originRunId);
    const input = insertSessionInput({ id: randomUUID(), conversationId, expectedTranscriptId: wait.transcriptId,
      clientMessageId: `phone-assistance:${wait.id}`, requestedDelivery: 'next', effectiveDelivery: 'next', status: 'queued',
      content: `用户已完成手机上的人工操作，请继续原任务。原请求时间：${new Date(original?.createdAtMs ?? wait.createdAt).toISOString()}；原目标：${original?.content ?? wait.checkpoint.task.goal}。相对日期沿用原请求时间。先观察当前页面，不重复已完成操作，沿用 taskId 和剩余预算。手机片段：${JSON.stringify(wait.checkpoint.task)}`,
      origin: { type: 'system', source: 'internal' }, thinking: original?.thinking, taskRunId: original?.taskRunId,
      contextRefs: original?.contextRefs, contextSnapshots: original?.contextSnapshots });
    if (input.origin.type !== 'system' || input.origin.source !== 'internal' || input.status !== 'queued')
      throw new PhoneError('PHONE_ASSISTANCE_CHANGED', 'The continuation request changed. Refresh before continuing.', 409);
    const next: PhoneAssistance = { ...wait, status: 'queued', queuedInputId: input.id, version: wait.version + 1 };
    waits.set(conversationId, next); return next;
  });
}
export function consumePhoneAssistance(input: SessionInput): boolean {
  if (!input.clientMessageId.startsWith('phone-assistance:')) return true;
  return runSqliteWriteTransaction(() => {
    const wait = phoneAssistance(input.conversationId);
    if (!wait || wait.queuedInputId !== input.id || wait.status !== 'queued'
      || input.origin.type !== 'system' || input.origin.source !== 'internal') return false;
    if (wait.taskRunId) {
      const runs = new TaskRunRepository(); const run = runs.get(wait.taskRunId);
      if (!run || run.status !== 'waiting') return false;
      const active = runs.listActiveWaits(run.taskId).filter(item => item.taskRunId === run.id);
      if (active.some(item => item.condition.phoneTaskId !== wait.checkpoint.task.taskId)) return false;
      for (const item of active) runs.resolveWait({ waitId: item.id, actor: { kind: 'system' }, resolution: { phoneAssistanceId: wait.id } });
      runs.setStatus({ runId: run.id, expectedVersion: run.version, from: ['waiting'], to: 'running', actor: { kind: 'system' } });
    }
    waits.set(input.conversationId, { ...wait, status: 'resuming', version: wait.version + 1 }); return true;
  });
}
export function updatePhoneCheckpoint(conversationId: string, checkpoint: PhoneCheckpoint): void {
  const wait = phoneAssistance(conversationId);
  if (wait?.status === 'resuming' && wait.checkpoint.task.taskId === checkpoint.task.taskId)
    waits.set(conversationId, { ...wait, checkpoint });
}
export function phoneResumeForRun(conversationId: string, runId: string): PhoneAssistance | undefined {
  const wait = phoneAssistance(conversationId);
  if (!wait?.queuedInputId || wait.status !== 'resuming') return undefined;
  return getSessionInputById(conversationId, wait.queuedInputId)?.runId === runId ? wait : undefined;
}
/** Interrupted continuations require another explicit handback, never automatic replay after restart. */
export function reconcilePhoneAssistance(): string[] {
  if (!isXopcDatabaseOpen()) return [];
  const conversations: string[] = [];
  for (const wait of waits.values()) {
    if (phoneAssistance(wait.conversationId)?.id !== wait.id) continue;
    const input = wait.queuedInputId ? getSessionInputById(wait.conversationId, wait.queuedInputId) : undefined;
    if (wait.status === 'resuming' || wait.status === 'queued' && input?.status !== 'queued') {
      const next: PhoneAssistance = { ...wait, status: 'open', queuedInputId: undefined, id: randomUUID(), version: wait.version + 1 };
      markTaskWaiting(next); waits.set(wait.conversationId, next);
    } else if (wait.status === 'queued') conversations.push(wait.conversationId);
  }
  return conversations;
}
export function finishPhoneAssistance(input: SessionInput, succeeded: boolean): void {
  if (!isXopcDatabaseOpen()) return;
  runSqliteWriteTransaction(() => {
    const wait = phoneAssistance(input.conversationId);
    if (wait?.queuedInputId !== input.id || !['queued', 'resuming'].includes(wait.status)) return;
    const next: PhoneAssistance = { ...wait, status: succeeded ? 'completed' : 'open', ...(succeeded ? {} : { id: randomUUID(), queuedInputId: undefined }), version: wait.version + 1 };
    if (!succeeded) markTaskWaiting(next);
    waits.set(input.conversationId, next);
  });
}

export function phoneAssistanceReport(wait: PhoneAssistance): PhoneReport {
  return { ...wait.checkpoint.report, assistanceId: wait.id, reconnectRequired: true, mock: false, mode: 'control', status: wait.status === 'completed' ? 'completed' : 'needs_user',
    controlOwner: 'none', controlEpoch: 1, handoff: 'idle', actions: wait.checkpoint.usage.actions,
    modelRequests: wait.checkpoint.usage.modelRequests, createdAt: wait.createdAt, updatedAt: wait.createdAt,
    verified: false, verificationLevel: 'none', steps: [], stopReason: 'user_takeover',
    message: '任务进度已保留。请接管手机完成操作，然后继续任务。' };
}
