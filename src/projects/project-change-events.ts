import { randomUUID } from 'node:crypto';

import { currentOperationId } from '../infra/operation-context.js';
import { getSqliteDatabase } from '../storage/sqlite/transaction.js';
import type { Project } from './types.js';

export function enqueueProjectChanged(project: Project, changedFields: string[], operation: 'created' | 'updated' | 'deleted' = 'updated', deletedUnderstandingRunIds: string[] = []): void {
  getSqliteDatabase().prepare(`INSERT INTO domain_outbox
    (event_id, event_type, subject_kind, subject_id, correlation_id, payload_json, created_at, operation_id)
    VALUES (?, ?, 'project', ?, ?, ?, ?, ?)`).run(randomUUID(), operation === 'updated' ? 'project.changed' : `project.${operation}`, project.id, project.id,
    JSON.stringify({ projectId: project.id, version: project.version, changedFields,
      ...(deletedUnderstandingRunIds.length ? { deletedUnderstandingRunIds } : {}),
    }), project.updatedAt, currentOperationId() ?? null);
}
