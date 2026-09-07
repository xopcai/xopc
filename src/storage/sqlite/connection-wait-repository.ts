import { randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';
import type { ConnectionCheckpoint, ConnectionNeed, ConnectionWait } from '@xopcai/gateway-contract';

import { createLogger } from '../../utils/logger.js';
import { TaskRunRepository } from '../../tasks/task-run-repository.js';
import { isXopcDatabaseOpen } from './connection.js';
import { getSqliteDatabase, runSqliteWriteTransaction } from './transaction.js';
import { readCurrentSessionId } from './session-repository.js';
import { bumpSessionInputRevision, getSessionInputById, getSessionInputState, insertSessionInput, setSessionInputStatus, type SessionInput } from './session-input-repository.js';

const log = createLogger('Connectors:Wait');
const events = new EventEmitter();
export function onConnectionWaitChanged(listener: (sessionKey: string) => void): () => void {
  events.on('changed', listener);
  return () => { events.off('changed', listener); };
}
export function publishConnectionWait(sessionKey: string): void { events.emit('changed', sessionKey); }

export function getConnectionWait(id: string): ConnectionWait | undefined {
  if (!isXopcDatabaseOpen()) return undefined;
  const row = getSqliteDatabase().prepare('SELECT data_json FROM session_connection_waits WHERE id = ?').get(id) as { data_json: string } | undefined;
  return row ? JSON.parse(row.data_json) : undefined;
}
export function getActiveConnectionWait(sessionKey: string): ConnectionWait | undefined {
  if (!isXopcDatabaseOpen()) return undefined;
  const db = getSqliteDatabase();
  const row = db.prepare(`SELECT data_json FROM session_connection_waits WHERE session_key = ? AND session_id = ?
    AND status IN ('open','queued')`).get(sessionKey, readCurrentSessionId(db, sessionKey) ?? '') as { data_json: string } | undefined;
  return row ? JSON.parse(row.data_json) : undefined;
}
export function isConnectionSuspended(sessionKey: string, runId: string): boolean {
  const wait = getActiveConnectionWait(sessionKey);
  return Boolean(wait && wait.originRunId === runId);
}
export function updateConnectionWait(wait: ConnectionWait, expectedVersion: number): ConnectionWait {
  return runSqliteWriteTransaction(db => {
    if (readCurrentSessionId(db, wait.sessionKey) !== wait.sessionId) throw new Error('SESSION_CHANGED');
    const next = { ...wait, version: expectedVersion + 1, updatedAt: Date.now() };
    const result = db.prepare(`UPDATE session_connection_waits SET status = ?, version = ?, data_json = ? WHERE id = ? AND version = ?`)
      .run(next.status, next.version, JSON.stringify(next), next.id, expectedVersion);
    if (!result.changes) throw new Error('WAIT_CHANGED');
    bumpSessionInputRevision(db, wait.sessionKey);
    return next;
  });
}
export function requireSessionConnection(input: {
  sessionKey: string; principalId: string; agentId: string; summary: string; needs: ConnectionNeed[]; checkpoint?: Omit<ConnectionCheckpoint, 'entryId'>;
}): { status: 'connection_required' | 'skipped' | 'objective_conflict'; waitId?: string } {
  return runSqliteWriteTransaction(db => {
    const sessionId = readCurrentSessionId(db, input.sessionKey);
    const runtime = getSessionInputState(input.sessionKey);
    const origin = runtime.activeInputId ? getSessionInputById(input.sessionKey, runtime.activeInputId) : undefined;
    if (!sessionId || !origin || !runtime.activeRunId) throw new Error('Connection recovery requires a queued chat execution.');
    const resumed = origin.payload ? getConnectionWait(origin.payload.waitId) : undefined;
    if (resumed?.resolution === 'skipped') return { status: 'skipped' };
    const active = getActiveConnectionWait(input.sessionKey);
    if (active) {
      if (active.originInputId !== origin.id && active.objectiveId !== resumed?.objectiveId) return { status: 'objective_conflict', waitId: active.id };
      const needs = new Map(active.needs.map(need => [need.key, need]));
      for (const need of input.needs) {
        const previous = needs.get(need.key);
        needs.set(need.key, previous ? { ...previous, capabilities: [...new Set([...previous.capabilities, ...need.capabilities])] } : need);
      }
      if (JSON.stringify([...needs.values()]) !== JSON.stringify(active.needs)) updateConnectionWait({ ...active, needs: [...needs.values()] }, active.version);
      return { status: 'connection_required', waitId: active.id };
    }
    const lastEntry = db.prepare('SELECT entry_id FROM transcript_entries WHERE session_id = ? ORDER BY seq DESC LIMIT 1').get(sessionId) as { entry_id: string } | undefined;
    const wait: ConnectionWait = {
      ...input, needs: [...new Map(input.needs.map(need => [need.key, need])).values()], id: randomUUID(), sessionId, objectiveId: resumed?.objectiveId ?? origin.id,
      objectiveRevision: (resumed?.objectiveRevision ?? 0) + 1,
      objectiveUpdatedAt: resumed?.objectiveUpdatedAt ?? origin.createdAtMs,
      originInputId: origin.id, originRunId: runtime.activeRunId,
      taskRunId: origin.taskRunId,
      checkpoint: { entryId: lastEntry?.entry_id, completedSteps: input.checkpoint?.completedSteps ?? [],
        pendingSteps: input.checkpoint?.pendingSteps ?? [input.summary], timeRange: input.checkpoint?.timeRange ?? resumed?.checkpoint.timeRange },
      summary: resumed?.summary ?? origin.content, status: 'open', version: 1, createdAt: Date.now(), updatedAt: Date.now(),
    };
    db.prepare(`INSERT INTO session_connection_waits(id,principal_id,session_key,session_id,status,version,data_json) VALUES (?,?,?,?,?,?,?)`)
      .run(wait.id, wait.principalId, wait.sessionKey, wait.sessionId, wait.status, wait.version, JSON.stringify(wait));
    if (wait.taskRunId) {
      const runs = new TaskRunRepository();
      const run = runs.get(wait.taskRunId);
      if (run) {
        runs.createWait({ taskId: run.taskId, taskRunId: run.id, kind: 'user_input', reason: input.summary,
          condition: { type: 'connection', connectionWaitId: wait.id } });
        runs.setStatus({ runId: run.id, expectedVersion: run.version, from: [run.status], to: 'waiting', actor: { kind: 'system' } });
      }
    }
    bumpSessionInputRevision(db, wait.sessionKey);
    log.info({ sessionKey: wait.sessionKey, waitId: wait.id, objectiveRevision: wait.objectiveRevision, runId: wait.originRunId, phase: 'waiting' }, 'Connection requirement saved');
    return { status: 'connection_required', waitId: wait.id };
  });
}

/** The input and the wait transition commit together, using the existing queue's unique key. */
export function queueConnectionResolution(wait: ConnectionWait, resolution: 'continued' | 'skipped'): ConnectionWait {
  return runSqliteWriteTransaction(() => {
    const current = getConnectionWait(wait.id);
    if (!current || current.version !== wait.version || current.status !== 'open') throw new Error('WAIT_CHANGED');
    const origin = getSessionInputById(wait.sessionKey, wait.originInputId);
    if (!origin) throw new Error('Original input is unavailable.');
    const id = randomUUID();
    const input = insertSessionInput({
      id, sessionKey: wait.sessionKey, expectedSessionId: wait.sessionId,
      clientMessageId: `connection:${wait.id}:${wait.objectiveRevision}:${resolution}`,
      requestedDelivery: 'next', effectiveDelivery: 'next', status: 'queued',
      content: resolution === 'skipped'
        ? `The user skipped the requested connection. Continue this objective using only available information: ${wait.summary}. Do not request these connections again or claim to have read their data.`
        : `Recovery checkpoint: ${JSON.stringify(wait.checkpoint)}. The user chose to continue the request originally made at ${new Date(wait.objectiveUpdatedAt).toISOString()}: ${wait.summary}. Interpret relative dates against that original request time, unless the user explicitly changed them. The connection requirement has been checked. Search and describe tools again before using them. Use the explicitly selected account. Do not repeat already completed actions.`,
      origin: { type: 'system', source: 'internal' }, thinking: origin.thinking,
      contextRefs: origin.contextRefs, contextSnapshots: origin.contextSnapshots,
      kind: 'connection_resume', taskRunId: wait.taskRunId, payload: { waitId: wait.id, objectiveRevision: wait.objectiveRevision, resolution },
    });
    return updateConnectionWait({ ...wait, status: 'queued', resolution, queuedInputId: input.id }, wait.version);
  });
}

export function consumeConnectionResume(input: SessionInput): boolean {
  if (input.kind !== 'connection_resume') return true;
  return runSqliteWriteTransaction(() => {
    const wait = input.payload ? getConnectionWait(input.payload.waitId) : undefined;
    if (!wait || wait.status !== 'queued' || wait.queuedInputId !== input.id || wait.objectiveRevision !== input.payload?.objectiveRevision) return false;
    if (readCurrentSessionId(getSqliteDatabase(), input.sessionKey) !== wait.sessionId) return false;
    if (wait.taskRunId) {
      const runs = new TaskRunRepository();
      const run = runs.get(wait.taskRunId);
      if (!run || run.status !== 'waiting') return false;
      const taskWaits = runs.listActiveWaits(run.taskId);
      if (taskWaits.some(item => item.taskRunId === run.id && item.condition.connectionWaitId !== wait.id)) {
        updateConnectionWait({ ...wait, status: 'open', intent: undefined, queuedInputId: undefined, objectiveRevision: wait.objectiveRevision + 1 }, wait.version);
        return false;
      }
      for (const taskWait of taskWaits) {
        if (taskWait.condition.connectionWaitId === wait.id) runs.resolveWait({ waitId: taskWait.id, actor: { kind: 'system' }, resolution: { connectionWaitId: wait.id } });
      }
      runs.setStatus({ runId: run.id, expectedVersion: run.version, from: ['waiting'], to: 'running', actor: { kind: 'system' } });
    }
    updateConnectionWait({ ...wait, status: 'closed' }, wait.version);
    return true;
  });
}

export function connectionBindings(sessionKey: string): ConnectionNeed[] {
  if (!isXopcDatabaseOpen()) return [];
  const state = getSessionInputState(sessionKey);
  const input = state.activeInputId ? getSessionInputById(sessionKey, state.activeInputId) : undefined;
  return input?.payload ? getConnectionWait(input.payload.waitId)?.needs ?? [] : [];
}
export function connectionBinding(sessionKey: string, connectorId: string): string | undefined {
  const matches = connectionBindings(sessionKey).filter(need => need.connectorId === connectorId);
  return matches.length === 1 ? matches[0].connectionId : undefined;
}

/** New input wins over an outstanding auto-resume intent, including an already queued resume. */
export function invalidateConnectionResumeIntent(sessionKey: string): void {
  const wait = getActiveConnectionWait(sessionKey);
  if (!wait) return;
  runSqliteWriteTransaction(() => {
    if (wait.queuedInputId) setSessionInputStatus(wait.queuedInputId, 'cancelled');
    updateConnectionWait({ ...wait, status: 'open', intent: undefined, queuedInputId: undefined,
      objectiveRevision: wait.objectiveRevision + 1, scopeConfirmedAt: undefined, reviewRequired: true,
    }, wait.version);
  });
  publishConnectionWait(sessionKey);
}

export function reviseCurrentConnectionObjective(sessionKey: string, summary: string | undefined): void {
  const wait = getActiveConnectionWait(sessionKey);
  if (!wait) throw new Error('No connection objective is waiting.');
  if (!summary) { cancelConnectionObjective(sessionKey); return; }
  runSqliteWriteTransaction(() => {
    if (wait.queuedInputId) setSessionInputStatus(wait.queuedInputId, 'cancelled');
    updateConnectionWait({ ...wait, summary, objectiveUpdatedAt: Date.now(),
      checkpoint: { ...wait.checkpoint, pendingSteps: [summary], timeRange: undefined },
      status: 'open', resolution: undefined,
      intent: undefined, queuedInputId: undefined, scopeConfirmedAt: undefined, reviewRequired: true,
      objectiveRevision: wait.objectiveRevision + 1,
    }, wait.version);
  });
  publishConnectionWait(sessionKey);
}

export function cancelConnectionObjective(sessionKey: string): void {
  const wait = getActiveConnectionWait(sessionKey);
  if (!wait) return;
  runSqliteWriteTransaction(() => {
    if (wait.queuedInputId) setSessionInputStatus(wait.queuedInputId, 'cancelled');
    if (wait.taskRunId) {
      const runs = new TaskRunRepository();
      const run = runs.get(wait.taskRunId);
      if (run?.status === 'waiting') {
        for (const taskWait of runs.listActiveWaits(run.taskId)) {
          if (taskWait.condition.connectionWaitId === wait.id) runs.resolveWait({ waitId: taskWait.id, actor: { kind: 'system' }, resolution: { cancelled: true } });
        }
        runs.finalize({ runId: run.id, expectedVersion: run.version, receipt: {
          status: 'cancelled', summary: 'Connection objective cancelled', changes: [], evidence: [],
          verification: { status: 'unverified', checks: [] }, remainingWork: [], needsUser: false, completionVerdict: 'not_achieved',
        } });
      }
    }
    updateConnectionWait({ ...wait, status: 'closed', resolution: 'cancelled', intent: undefined }, wait.version);
  });
  publishConnectionWait(sessionKey);
}

export function getConnectionResumeInput(sessionKey: string, runId: string): SessionInput | undefined {
  if (!isXopcDatabaseOpen()) return undefined;
  const state = getSessionInputState(sessionKey);
  if (state.activeRunId !== runId || !state.activeInputId) return undefined;
  const input = getSessionInputById(sessionKey, state.activeInputId);
  return input?.kind === 'connection_resume' ? input : undefined;
}

export function listConnectionWaitsToCheck(): ConnectionWait[] {
  if (!isXopcDatabaseOpen()) return [];
  const rows = getSqliteDatabase().prepare(`SELECT wait.data_json FROM session_connection_waits wait
    JOIN sessions session ON session.session_id = wait.session_id
    WHERE wait.status = 'open'`).all() as Array<{ data_json: string }>;
  return rows.map(row => JSON.parse(row.data_json) as ConnectionWait)
    .filter(wait => wait.principalId === 'local-owner' && wait.intent && wait.intent.validUntil > Date.now());
}
