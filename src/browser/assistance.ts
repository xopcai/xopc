import { randomUUID } from 'node:crypto';

import { DurableState } from '../storage/sqlite/durable-state.js';
import { isXopcDatabaseOpen } from '../storage/sqlite/connection.js';
import { getSqliteDatabase, runSqliteWriteTransaction } from '../storage/sqlite/transaction.js';
import { readCurrentTranscriptId } from '../storage/sqlite/session-instance-repository.js';
import { findSessionInputByRunId, getSessionInputById, insertSessionInput, type SessionInput } from '../storage/sqlite/session-input-repository.js';
import { TaskRunRepository } from '../tasks/task-run-repository.js';

export interface BrowserAssistanceCheckpoint {
  browserSessionId: string;
  reason: string;
  url: string;
  title: string;
}

export interface BrowserAssistance {
  id: string;
  conversationId: string;
  transcriptId: string;
  originRunId: string;
  toolCallId: string;
  checkpoint: BrowserAssistanceCheckpoint;
  version: number;
  createdAt: number;
  status: 'open' | 'queued' | 'resuming' | 'completed' | 'cancelled';
  queuedInputId?: string;
  taskRunId?: string;
  objectiveInputId?: string;
}

export class BrowserAssistanceError extends Error {
  constructor(readonly code: string, message: string, readonly status = 409) {
    super(message);
    this.name = 'BrowserAssistanceError';
  }
}

const waits = new DurableState<BrowserAssistance>('browser.assistance');

function markTaskWaiting(wait: BrowserAssistance): void {
  if (!wait.taskRunId) return;
  const runs = new TaskRunRepository();
  const run = runs.get(wait.taskRunId);
  if (run?.status !== 'running') return;
  if (!runs.listActiveWaits(run.taskId).some(item => item.taskRunId === run.id && item.condition.browserAssistanceId === wait.id)) {
    runs.createWait({
      taskId: run.taskId,
      taskRunId: run.id,
      kind: 'user_input',
      reason: wait.checkpoint.reason || 'Browser requires manual operation',
      condition: { browserAssistanceId: wait.id, browserSessionId: wait.checkpoint.browserSessionId },
    });
  }
  runs.setStatus({ runId: run.id, expectedVersion: run.version, from: ['running'], to: 'waiting', actor: { kind: 'system' } });
}

export function browserAssistance(conversationId: string): BrowserAssistance | undefined {
  if (!isXopcDatabaseOpen()) return undefined;
  const wait = waits.get(conversationId);
  if (wait && readCurrentTranscriptId(getSqliteDatabase(), conversationId) !== wait.transcriptId) {
    waits.delete(conversationId);
    return undefined;
  }
  return wait;
}

export function isBrowserAssistanceSuspended(conversationId: string, runId: string): boolean {
  const wait = browserAssistance(conversationId);
  return Boolean(wait && wait.originRunId === runId && wait.status === 'open');
}

export function requireBrowserAssistance(
  conversationId: string,
  runId: string,
  toolCallId: string,
  checkpoint: BrowserAssistanceCheckpoint,
): BrowserAssistance {
  if (!isXopcDatabaseOpen()) {
    throw new BrowserAssistanceError('BROWSER_ASSISTANCE_UNAVAILABLE', 'Database is unavailable for browser assistance.', 503);
  }
  return runSqliteWriteTransaction(db => {
    const transcriptId = readCurrentTranscriptId(db, conversationId);
    if (!transcriptId) {
      throw new BrowserAssistanceError('BROWSER_CONVERSATION_NOT_FOUND', 'Browser assistance requires a saved conversation.', 409);
    }
    const current = browserAssistance(conversationId);
    if (current?.originRunId === runId && current.toolCallId === toolCallId && current.status === 'open') return current;
    const origin = findSessionInputByRunId(conversationId, runId);
    const wait: BrowserAssistance = {
      id: randomUUID(),
      conversationId,
      transcriptId,
      originRunId: runId,
      toolCallId,
      checkpoint,
      status: 'open',
      version: (current?.version ?? 0) + 1,
      createdAt: Date.now(),
      taskRunId: origin?.taskRunId,
      objectiveInputId: current?.queuedInputId === origin?.id ? current?.objectiveInputId : origin?.id,
    };
    markTaskWaiting(wait);
    waits.set(conversationId, wait);
    return wait;
  });
}

export function cancelBrowserAssistance(conversationId: string): void {
  if (!isXopcDatabaseOpen()) return;
  runSqliteWriteTransaction(() => {
    const wait = isXopcDatabaseOpen() ? waits.get(conversationId) : undefined;
    if (!wait || ['completed', 'cancelled'].includes(wait.status)) return;
    if (wait.taskRunId && ['open', 'queued', 'resuming'].includes(wait.status)) {
      const runs = new TaskRunRepository();
      const run = runs.get(wait.taskRunId);
      if (run && ['queued', 'running', 'waiting', 'verifying'].includes(run.status)) {
        for (const item of runs.listActiveWaits(run.taskId)) {
          if (item.condition.browserAssistanceId === wait.id) {
            runs.resolveWait({ waitId: item.id, actor: { kind: 'user' }, resolution: { cancelled: true } });
          }
        }
        runs.finalize({
          runId: run.id,
          expectedVersion: run.version,
          actor: { kind: 'user' },
          terminalCode: 'cancelled_by_user',
          receipt: {
            status: 'cancelled',
            summary: 'Browser task cancelled',
            changes: [],
            evidence: [],
            verification: { status: 'unverified', checks: [] },
            remainingWork: [],
            needsUser: false,
            completionVerdict: 'not_achieved',
          },
        });
      }
    }
    waits.set(conversationId, { ...wait, status: 'cancelled', version: wait.version + 1 });
  });
}

export function queueBrowserAssistance(conversationId: string, waitId: string): BrowserAssistance {
  return runSqliteWriteTransaction(() => {
    const wait = browserAssistance(conversationId);
    if (!wait || wait.id !== waitId || wait.status === 'cancelled') {
      throw new BrowserAssistanceError('BROWSER_ASSISTANCE_CHANGED', 'The browser task changed. Refresh before continuing.', 409);
    }
    if (wait.status !== 'open') return wait;
    const original = (wait.objectiveInputId ? getSessionInputById(conversationId, wait.objectiveInputId) : undefined)
      ?? findSessionInputByRunId(conversationId, wait.originRunId);
    const input = insertSessionInput({
      id: randomUUID(),
      conversationId,
      expectedTranscriptId: wait.transcriptId,
      clientMessageId: `browser-assistance:${wait.id}`,
      requestedDelivery: 'next',
      effectiveDelivery: 'next',
      status: 'queued',
      content: `用户已完成浏览器上的人工操作并交还控制权，请继续原任务。原请求时间：${new Date(original?.createdAtMs ?? wait.createdAt).toISOString()}；原目标：${original?.content ?? wait.checkpoint.reason}。请先调用 browser_use 的 observe（sessionId: "${wait.checkpoint.browserSessionId}"）读取当前最新页面状态，不要重复用户已经完成的登录或表单操作，然后继续完成原任务。`,
      origin: { type: 'system', source: 'internal' },
      thinking: original?.thinking,
      taskRunId: original?.taskRunId,
      contextRefs: original?.contextRefs,
      contextSnapshots: original?.contextSnapshots,
    });
    if (input.origin.type !== 'system' || input.origin.source !== 'internal' || input.status !== 'queued') {
      throw new BrowserAssistanceError('BROWSER_ASSISTANCE_CHANGED', 'The continuation request changed. Refresh before continuing.', 409);
    }
    const next: BrowserAssistance = { ...wait, status: 'queued', queuedInputId: input.id, version: wait.version + 1 };
    waits.set(conversationId, next);
    return next;
  });
}

export function consumeBrowserAssistance(input: SessionInput): boolean {
  if (!input.clientMessageId.startsWith('browser-assistance:')) return true;
  return runSqliteWriteTransaction(() => {
    const wait = browserAssistance(input.conversationId);
    if (!wait || wait.queuedInputId !== input.id || wait.status !== 'queued'
      || input.origin.type !== 'system' || input.origin.source !== 'internal') return false;
    if (wait.taskRunId) {
      const runs = new TaskRunRepository();
      const run = runs.get(wait.taskRunId);
      if (!run || run.status !== 'waiting') return false;
      const active = runs.listActiveWaits(run.taskId).filter(item => item.taskRunId === run.id);
      if (active.some(item => item.condition.browserAssistanceId !== wait.id)) return false;
      for (const item of active) {
        runs.resolveWait({ waitId: item.id, actor: { kind: 'system' }, resolution: { browserAssistanceId: wait.id } });
      }
      runs.setStatus({ runId: run.id, expectedVersion: run.version, from: ['waiting'], to: 'running', actor: { kind: 'system' } });
    }
    waits.set(input.conversationId, { ...wait, status: 'resuming', version: wait.version + 1 });
    return true;
  });
}

export function finishBrowserAssistance(input: SessionInput, succeeded: boolean): void {
  if (!isXopcDatabaseOpen()) return;
  runSqliteWriteTransaction(() => {
    const wait = browserAssistance(input.conversationId);
    if (!wait || wait.queuedInputId !== input.id || !['queued', 'resuming'].includes(wait.status)) return;
    const next: BrowserAssistance = {
      ...wait,
      status: succeeded ? 'completed' : 'open',
      ...(succeeded ? {} : { id: randomUUID(), queuedInputId: undefined }),
      version: wait.version + 1,
    };
    if (!succeeded) markTaskWaiting(next);
    waits.set(input.conversationId, next);
  });
}

export function reconcileBrowserAssistance(): string[] {
  if (!isXopcDatabaseOpen()) return [];
  const conversations: string[] = [];
  for (const wait of waits.values()) {
    if (browserAssistance(wait.conversationId)?.id !== wait.id) continue;
    const input = wait.queuedInputId ? getSessionInputById(wait.conversationId, wait.queuedInputId) : undefined;
    if (wait.status === 'resuming' || (wait.status === 'queued' && input?.status !== 'queued')) {
      const next: BrowserAssistance = { ...wait, status: 'open', queuedInputId: undefined, id: randomUUID(), version: wait.version + 1 };
      markTaskWaiting(next);
      waits.set(wait.conversationId, next);
    } else if (wait.status === 'queued') {
      conversations.push(wait.conversationId);
    }
  }
  return conversations;
}
