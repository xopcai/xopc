import { randomUUID } from 'node:crypto';

import { TaskResultDeliverySchema, TurnOutcomeSchema, type TurnOutcome } from '@xopcai/gateway-contract';

import { afterSqliteCommit, getSqliteDatabase, runSqliteWriteTransaction } from '../storage/sqlite/transaction.js';
import { TaskConversationRepository } from './task-conversation-repository.js';
import { TaskRunRepository } from './task-run-repository.js';
import { TaskCollaborationRepository } from './task-collaboration-repository.js';
import { createLogger } from '../utils/logger.js';
import { personalRequestForTask } from '../personal-agent/request-repository.js';

const log = createLogger('TaskResultDelivery');

const queuedListeners = new Set<() => void>();

export function onTaskResultQueued(listener: () => void): () => void {
  queuedListeners.add(listener);
  return () => { queuedListeners.delete(listener); };
}

export interface TaskResultDeliveryRow {
  delivery_id: string;
  payload_json: string;
  status: 'pending' | 'delivered' | 'stale' | 'failed';
  attempts: number;
  message_entry_id: string | null;
}

export class TaskResultDeliveryRepository {
  capture(runId: string, value: TurnOutcome): void {
    const outcome = TurnOutcomeSchema.parse({ ...value, evidence: [], changeSet: undefined,
      summary: value.summary.slice(0, 2000) });
    if (outcome.deliverables.length > 50 || JSON.stringify(outcome).length > 256_000) {
      throw new Error('Task outcome exceeds delivery limits');
    }
    const run = new TaskRunRepository().get(runId);
    if (!run || !['running', 'waiting', 'verifying'].includes(run.status)) return;
    const state = new TaskConversationRepository().getState(run.taskId);
    if (!state || state.activeConversationId !== run.conversationId) return;
    getSqliteDatabase().prepare(`INSERT INTO task_run_outcomes
      (task_run_id, outcome_id, assignment_epoch, outcome_json, created_at)
      VALUES (?, ?, ?, ?, ?) ON CONFLICT(task_run_id, outcome_id) DO NOTHING`)
      .run(runId, outcome.outcomeId, state.assignmentEpoch, JSON.stringify(outcome), Date.now());
  }

  /** Called inside the run completion transaction, after stale receipts are rejected. */
  enqueue(runId: string, summary: string, status: 'succeeded' | 'failed', resultText?: string): boolean {
    const db = getSqliteDatabase();
    const run = new TaskRunRepository().get(runId);
    if (!run || run.parentRunId) return false;
    const state = new TaskConversationRepository().getState(run.taskId);
    if (!state || state.activeConversationId !== run.conversationId) return false;
    const origin = db.prepare(`SELECT origin.*, task.title FROM task_origin_links origin
      JOIN tasks task ON task.task_id = origin.task_id
      WHERE origin.task_id = ?`).get(run.taskId) as {
        conversation_id: string; origin_transcript_id: string; request_input_id: string | null; title: string;
      } | undefined;
    if (!origin?.origin_transcript_id) return false;
    const rows = db.prepare(`SELECT outcome_json FROM task_run_outcomes
      WHERE task_run_id = ? AND assignment_epoch = ? ORDER BY created_at, rowid LIMIT 100`)
      .all(runId, state.assignmentEpoch) as Array<{ outcome_json: string }>;
    const outcomes = rows.map(row => TurnOutcomeSchema.parse(JSON.parse(row.outcome_json)));
    const latest = outcomes.at(-1);
    if (!latest) return false;
    const artifacts = new Map<string, TurnOutcome['deliverables'][number]>();
    for (const outcome of outcomes) for (const item of outcome.deliverables) {
      artifacts.set(item.sourceFileId ?? item.artifactId, item);
    }
    const deliverables = [...artifacts.values()].slice(-50);
    const text = resultText?.trim() && resultText.trim() !== 'NO_REPLY' ? resultText.trim().slice(0, 8000) : undefined;
    if (!deliverables.length && (!text || status !== 'succeeded')) return false;
    // Connected-app requests have their own structured text delivery.
    if (!deliverables.length && personalRequestForTask(run.taskId)) return false;
    const outcome: TurnOutcome = { ...latest, deliverables, evidence: [], changeSet: undefined,
      summary: summary.slice(0, 2000),
      status: status === 'failed' || deliverables.some(item => item.availability !== 'available') ? 'partial' : 'succeeded' };
    const now = Date.now();
    const delivery = TaskResultDeliverySchema.parse({ version: 1, deliveryId: randomUUID(),
      taskId: run.taskId, taskRunId: runId, taskTitle: origin.title.slice(0, 300),
      conversationId: origin.conversation_id, originTranscriptId: origin.origin_transcript_id,
      ...(origin.request_input_id ? { requestInputId: origin.request_input_id } : {}),
      assignmentEpoch: state.assignmentEpoch, outcome, ...(text ? { text } : {}), createdAt: now });
    db.prepare(`INSERT INTO task_result_deliveries
      (delivery_id, task_run_id, conversation_id, payload_json, status, next_attempt_at, created_at)
      VALUES (?, ?, ?, ?, 'pending', ?, ?) ON CONFLICT(task_run_id, conversation_id) DO NOTHING`)
      .run(delivery.deliveryId, runId, origin.conversation_id, JSON.stringify(delivery), now, now);
    // A final artifact delivery replaces result-only model notifications for this run.
    db.prepare(`UPDATE task_main_update_deliveries SET status = 'delivered', decision = 'silent',
      decision_reason = 'Structured task result delivery', updated_at = ?
      WHERE entry_id IN (SELECT entry_id FROM task_collaboration_entries
        WHERE task_run_id = ? AND kind IN ('result', 'progress'))`)
      .run(now, runId);
    afterSqliteCommit(() => {
      for (const listener of queuedListeners) {
        try { listener(); } catch (err) { log.warn({ err, runId }, 'Task result wake failed; polling will recover'); }
      }
    });
    return true;
  }

  hasForRun(runId: string): boolean {
    return Boolean(getSqliteDatabase().prepare(`SELECT 1 FROM task_result_deliveries
      WHERE task_run_id = ? AND status IN ('pending', 'delivered')`).get(runId));
  }

  hasCapturedOutcome(runId: string): boolean {
    return Boolean(getSqliteDatabase().prepare('SELECT 1 FROM task_run_outcomes WHERE task_run_id = ? LIMIT 1').get(runId));
  }

  pending(limit = 20): TaskResultDeliveryRow[] {
    return getSqliteDatabase().prepare(`SELECT * FROM task_result_deliveries
      WHERE status IN ('pending', 'delivered') AND next_attempt_at <= ? AND notified_at IS NULL
      ORDER BY created_at LIMIT ?`).all(Date.now(), limit) as unknown as TaskResultDeliveryRow[];
  }

  retry(id: string, error: string): void {
    runSqliteWriteTransaction(db => {
      db.prepare(`UPDATE task_result_deliveries SET attempts = attempts + 1,
        status = CASE WHEN status = 'pending' AND attempts >= 7 THEN 'failed' ELSE status END,
        notified_at = CASE WHEN status = 'delivered' AND attempts >= 7 THEN -1 ELSE notified_at END,
        next_attempt_at = ? + MIN(60000, 1000 * (1 << MIN(attempts, 6))), last_error = ?
        WHERE delivery_id = ? AND status IN ('pending', 'delivered')`).run(Date.now(), error.slice(0, 500), id);
      const row = db.prepare("SELECT task_run_id FROM task_result_deliveries WHERE delivery_id = ? AND status = 'failed'")
        .get(id) as { task_run_id: string } | undefined;
      const run = row ? new TaskRunRepository().get(row.task_run_id) : undefined;
      if (run) new TaskCollaborationRepository().append({ taskId: run.taskId, taskRunId: run.id,
        authorKind: 'system', authorId: 'task-result-delivery', kind: 'failure',
        body: 'The task produced results, but delivery to the main chat failed. Inspect the published artifacts and retry delivery; do not regenerate paid outputs just to send them.',
        idempotencyKey: `task-result-delivery-failed:${id}` });
    });
  }
}
