import { randomUUID } from 'node:crypto';

import type { Config } from '../../config/schema.js';
import { requireXopcDatabase } from '../../storage/sqlite/connection.js';
import { runSqliteWriteTransaction } from '../../storage/sqlite/transaction.js';
import type { WorkflowEventEnvelope, WorkflowEventPayload, WorkflowEventType } from '../domain/event.js';

export interface AppendWorkflowEventInput<T extends WorkflowEventPayload = WorkflowEventPayload> {
  runId: string;
  type: WorkflowEventType;
  payload: T;
  createdAtMs?: number;
}

export class WorkflowEventStore {
  constructor(_config: Config, private readonly agentId: string) {}

  async append<T extends WorkflowEventPayload>(input: AppendWorkflowEventInput<T>): Promise<WorkflowEventEnvelope<T>> {
    requireXopcDatabase();
    return runSqliteWriteTransaction(db => {
      const row = db.prepare('SELECT COALESCE(MAX(sequence), 0) AS sequence FROM workflow_events WHERE agent_id = ? AND run_id = ?')
        .get(this.agentId, input.runId) as { sequence: number };
      const event: WorkflowEventEnvelope<T> = {
        id: randomUUID(), runId: input.runId, sequence: row.sequence + 1,
        type: input.type, payload: input.payload, createdAtMs: input.createdAtMs ?? Date.now(),
      };
      db.prepare('INSERT INTO workflow_events(agent_id, run_id, sequence, id, payload) VALUES (?, ?, ?, ?, ?)')
        .run(this.agentId, input.runId, event.sequence, event.id, JSON.stringify(event));
      return event;
    });
  }

  async readRunEvents(runId: string): Promise<WorkflowEventEnvelope[]> {
    return (requireXopcDatabase().db.prepare('SELECT payload FROM workflow_events WHERE agent_id = ? AND run_id = ? ORDER BY sequence')
      .all(this.agentId, runId) as Array<{ payload: string }>).map(row => JSON.parse(row.payload) as WorkflowEventEnvelope);
  }

  async listRunIds(): Promise<string[]> {
    return (requireXopcDatabase().db.prepare('SELECT DISTINCT run_id FROM workflow_events WHERE agent_id = ? ORDER BY run_id')
      .all(this.agentId) as Array<{ run_id: string }>).map(row => row.run_id);
  }
}

export function createWorkflowEventStore(config: Config, agentId: string): WorkflowEventStore {
  return new WorkflowEventStore(config, agentId);
}
