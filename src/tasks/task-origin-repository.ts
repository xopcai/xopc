import type { TaskAllocation, TaskOperationalState, TaskPresentation, TaskResolution } from '@xopcai/gateway-contract';

import { getClarification } from '../storage/sqlite/clarification-wait-repository.js';
import { getSqliteDatabase } from '../storage/sqlite/transaction.js';
import { TaskReadModelProjector } from './task-read-model-projector.js';
import { TaskResultDeliveryRepository } from './task-result-delivery-repository.js';
import { TaskRunRepository } from './task-run-repository.js';

export interface DelegatedTaskSummary {
  id: string;
  title: string;
  objective?: string;
  phase: string;
  operationalState: TaskOperationalState;
  presentation: TaskPresentation;
  runStatus?: string;
  allocation?: TaskAllocation;
  updatedAt: number;
}

export class TaskOriginRepository {
  listCurrent(conversationId: string) {
    const rows = getSqliteDatabase().prepare(`SELECT task.task_id AS id
      FROM task_origin_links origin JOIN tasks task ON task.task_id = origin.task_id
      WHERE origin.conversation_id = ? AND (task.phase <> 'closed' OR (task.resolution = 'done' AND EXISTS (
        SELECT 1 FROM task_waits wait WHERE wait.task_id = task.task_id AND wait.status = 'active'
      )))
      ORDER BY task.updated_at DESC, task.task_id DESC`).all(conversationId) as { id: string }[];
    const projector = new TaskReadModelProjector();
    const runs = new TaskRunRepository();
    const deliveries = new TaskResultDeliveryRepository();
    return rows.flatMap(({ id }) => {
      const model = projector.get(id);
      if (!model) return [];
      const { task, operationalState } = model;
      const attention = model.attention.find(item => item.kind === 'approval_required' || item.kind === 'input_required');
      const clarificationId = attention?.sourceId ? runs.getWait(attention.sourceId)?.condition.clarificationId : undefined;
      const clarification = typeof clarificationId === 'string' ? getClarification(clarificationId) : undefined;
      const prompt = clarification?.status === 'open' && (!clarification.expiresAt || clarification.expiresAt > Date.now())
        ? { id: clarification.id, conversationId: clarification.conversationId } : undefined;
      return [{ id, title: task.title, phase: task.phase, operationalState,
        resolution: task.resolution, updatedAt: task.updatedAt, presentation: model.presentation,
        attention: clarification && !prompt ? undefined : attention, prompt,
        artifact: task.phase === 'review' ? deliveries.fileDeliveryState(id, conversationId, true).artifact : undefined }];
    });
  }

  owns(taskId: string, conversationId: string): boolean {
    return Boolean(getSqliteDatabase().prepare(`SELECT 1 FROM task_origin_links
      WHERE task_id = ? AND conversation_id = ?`).get(taskId, conversationId));
  }

  getConversationId(taskId: string): string | undefined {
    const row = getSqliteDatabase().prepare('SELECT conversation_id FROM task_origin_links WHERE task_id = ?')
      .get(taskId) as { conversation_id: string } | undefined;
    return row?.conversation_id;
  }

  list(conversationId: string, limit = 20, options: { offset?: number; order?: 'active-first' | 'recent'; query?: string } = {}): { items: DelegatedTaskSummary[]; total: number } {
    const db = getSqliteDatabase();
    const query = options.query?.trim() ?? '';
    const selection = `FROM task_origin_links origin JOIN tasks task ON task.task_id = origin.task_id
      LEFT JOIN task_contracts contract ON contract.task_id = task.task_id AND contract.version = task.latest_contract_version
      WHERE origin.conversation_id = ? AND (? = '' OR instr(lower(task.title), lower(?)) > 0
        OR instr(lower(coalesce(contract.objective, '')), lower(?)) > 0)`;
    const bindings = [conversationId, query, query, query];
    const total = (db.prepare(`SELECT count(*) AS count ${selection}`).get(...bindings) as { count: number }).count;
    const rows = db.prepare(`SELECT task.task_id AS id, task.title, contract.objective, task.phase,
        MAX(task.updated_at, COALESCE((SELECT COALESCE(run.completed_at, run.started_at, run.queued_at)
          FROM task_runs run WHERE run.task_id = task.task_id AND run.parent_run_id IS NULL
          ORDER BY run.queued_at DESC LIMIT 1), task.updated_at)) AS updatedAt,
        (SELECT run.status FROM task_runs run WHERE run.task_id = task.task_id
          AND run.parent_run_id IS NULL ORDER BY run.queued_at DESC LIMIT 1) AS runStatus
      ${selection}
      ORDER BY ${options.order === 'recent' ? '' : "CASE WHEN task.phase = 'closed' THEN 1 ELSE 0 END,"}
        updatedAt DESC, task.task_id DESC LIMIT ? OFFSET ?`).all(...bindings,
      Math.max(1, Math.min(100, Math.floor(limit))), Math.max(0, Math.floor(options.offset ?? 0))) as unknown as Array<Omit<DelegatedTaskSummary, 'operationalState' | 'presentation' | 'runStatus'> & { runStatus: string | null }>;
    const projector = new TaskReadModelProjector();
    return { total, items: rows.flatMap(({ runStatus, ...row }) => {
      const model = projector.get(row.id);
      return model ? [{ ...row, allocation: model.allocation, operationalState: model.operationalState,
        presentation: model.presentation, ...(runStatus ? { runStatus } : {}) }] : [];
    }) };
  }

  listRecentEnded(conversationId: string, limit: number, offset: number) {
    const db = getSqliteDatabase();
    const ended = `FROM task_origin_links origin JOIN tasks task ON task.task_id = origin.task_id
      WHERE origin.conversation_id = ? AND task.phase = 'closed' AND (task.resolution IS NOT 'done' OR NOT EXISTS (
        SELECT 1 FROM task_waits wait WHERE wait.task_id = task.task_id AND wait.status = 'active'
      ))`;
    const { total } = db.prepare(`SELECT count(*) AS total ${ended}`).get(conversationId) as { total: number };
    const items = db.prepare(`SELECT task.task_id AS id, task.title, task.phase, task.resolution,
      task.updated_at AS updatedAt ${ended} ORDER BY task.updated_at DESC, task.task_id DESC LIMIT ? OFFSET ?`)
      .all(conversationId, limit, offset) as { id: string; title: string; phase: 'closed'; resolution: TaskResolution | null; updatedAt: number }[];
    const deliveries = new TaskResultDeliveryRepository();
    return { total, items: items.map(item => ({
      ...item,
      presentation: { status: item.resolution === 'done' ? 'completed' as const : 'ended' as const,
        primaryAction: { type: 'view_results' as const } },
      artifact: item.resolution === 'done' ? deliveries.fileDeliveryState(item.id, conversationId, true).artifact : undefined,
    })) };
  }
}
