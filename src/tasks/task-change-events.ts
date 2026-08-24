import { randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';

import type { ActorRef, TaskChangedField } from '@xopcai/gateway-contract';

import { runSqliteWriteTransaction } from '../storage/sqlite/transaction.js';

export type TaskChangeInput = {
  taskId: string;
  projectId?: string;
  version: number;
  changedFields: TaskChangedField[];
  actor?: ActorRef;
  source?: 'user' | 'agent' | 'runtime';
  occurredAt?: number;
};

function eventSource(input: TaskChangeInput): 'user' | 'agent' | 'runtime' {
  if (input.source) return input.source;
  return input.actor?.kind === 'user' || input.actor?.kind === 'agent'
    ? input.actor.kind
    : 'runtime';
}

export function enqueueTaskChangedEvent(db: DatabaseSync, input: TaskChangeInput): void {
  const occurredAt = input.occurredAt ?? Date.now();
  const changedFields = [...new Set(input.changedFields)];
  if (changedFields.length === 0) return;
  db.prepare(
    `INSERT INTO domain_outbox (
      event_id, event_type, subject_kind, subject_id, correlation_id,
      payload_json, created_at
    ) VALUES (?, 'task.changed.v2', 'task', ?, ?, ?, ?)`,
  ).run(
    randomUUID(),
    input.taskId,
    randomUUID(),
    JSON.stringify({
      taskId: input.taskId,
      ...(input.projectId ? { projectId: input.projectId } : {}),
      version: input.version,
      changedFields,
      source: eventSource(input),
      ...(input.actor?.id ? { actorId: input.actor.id } : {}),
      occurredAt,
    }),
    occurredAt,
  );
}

export function enqueueTaskChanged(input: TaskChangeInput): void {
  runSqliteWriteTransaction((db) => enqueueTaskChangedEvent(db, input));
}
