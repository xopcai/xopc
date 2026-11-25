import { TASK_RESULT_DELIVERY_TYPE } from '@xopcai/gateway-contract';
import type { TaskAllocation, TaskOperationalState, TaskPresentation, TaskResolution } from '@xopcai/gateway-contract';

import { getClarification } from '../storage/sqlite/clarification-wait-repository.js';
import { getSqliteDatabase } from '../storage/sqlite/transaction.js';
import { isPersonalConversation } from '../personal-agent/repository.js';
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
  createdAt: number;
  updatedAt: number;
}

const DELEGATED_WORK = `FROM task_origin_links origin JOIN tasks task ON task.task_id = origin.task_id
  LEFT JOIN task_runs latest ON latest.run_id = (SELECT run.run_id FROM task_runs run
    WHERE run.task_id = task.task_id AND run.parent_run_id IS NULL ORDER BY run.queued_at DESC, run.rowid DESC LIMIT 1)
  WHERE origin.conversation_id = ?`;
const ACTIVE_WAIT = `EXISTS (SELECT 1 FROM task_waits wait WHERE wait.task_id = task.task_id AND wait.status = 'active')`;
const CLOSED_WORK = `task.phase = 'closed' AND (task.resolution IS NOT 'done' OR NOT ${ACTIVE_WAIT})`;
const PERSONAL_BACKGROUND_OUTCOME = `task.phase <> 'closed' AND NOT ${ACTIVE_WAIT}
  AND NOT EXISTS (SELECT 1 FROM task_runs run WHERE run.task_id = task.task_id AND run.parent_run_id IS NULL
    AND run.status IN ('queued', 'running', 'waiting', 'verifying'))
  AND NOT EXISTS (SELECT 1 FROM task_allocations allocation WHERE allocation.task_id = task.task_id
    AND (allocation.status IN ('pending', 'selecting') OR allocation.reason_code = 'needs_input'))
  AND (COALESCE(latest.contract_version = task.latest_contract_version AND (
    (latest.status = 'failed' AND NOT EXISTS (SELECT 1 FROM task_run_receipts receipt WHERE receipt.run_id = latest.run_id
      AND json_extract(receipt.failure_json, '$.phase') = 'preflight'))
    OR (task.phase = 'review' AND latest.status = 'succeeded' AND latest.manual_phase_revision = task.manual_phase_revision AND EXISTS (
      SELECT 1 FROM task_contracts contract WHERE contract.task_id = task.task_id AND contract.version = task.latest_contract_version
        AND contract.acceptance_policy = 'verified_auto'))
  ), 0) OR EXISTS (SELECT 1 FROM task_allocations allocation WHERE allocation.task_id = task.task_id
    AND allocation.status IN ('failed', 'blocked')))`;

export class TaskOriginRepository {
  listCurrent(conversationId: string) {
    const ended = this.endedWork(conversationId);
    const rows = getSqliteDatabase().prepare(`SELECT task.task_id AS id
      ${DELEGATED_WORK} AND NOT (${ended})
      ORDER BY task.updated_at DESC, task.task_id DESC`).all(conversationId) as { id: string }[];
    const projector = new TaskReadModelProjector();
    const runs = new TaskRunRepository();
    const deliveries = new TaskResultDeliveryRepository();
    return rows.flatMap(({ id }) => {
      const model = projector.get(id);
      if (!model) return [];
      const { task, operationalState } = model;
      const attention = model.personalAttention === undefined
        ? model.attention.find(item => item.kind === 'approval_required' || item.kind === 'input_required')
        : model.personalAttention === 'review' ? undefined : model.personalAttention ?? undefined;
      const clarificationId = attention?.sourceId && ['input_required', 'approval_required'].includes(attention.kind)
        ? runs.getWait(attention.sourceId)?.condition.clarificationId : undefined;
      const clarification = typeof clarificationId === 'string' ? getClarification(clarificationId) : undefined;
      const prompt = clarification?.status === 'open' && (!clarification.expiresAt || clarification.expiresAt > Date.now())
        ? { id: clarification.id, conversationId: clarification.conversationId } : undefined;
      const presentation = model.personalAttention === null && ['review', 'blocked', 'failed', 'needsUser'].includes(model.presentation.status)
        ? { ...model.presentation, status: 'waiting' as const } : model.presentation;
      return [{ id, title: task.title, phase: task.phase, operationalState,
        resolution: task.resolution, updatedAt: task.updatedAt, presentation,
        attention: clarification && !prompt ? undefined : attention, prompt,
        artifact: task.phase === 'review' ? deliveries.fileDeliveryState(id, conversationId, true).artifact : undefined }];
    });
  }

  owns(taskId: string, conversationId: string): boolean {
    return Boolean(getSqliteDatabase().prepare(`SELECT 1 FROM task_origin_links
      WHERE task_id = ? AND conversation_id = ?`).get(taskId, conversationId));
  }

  /** The most recent result shown after the preceding human input is the implicit continuation anchor. */
  recentResultTask(conversationId: string, inputId: string, before: number): string | undefined {
    const row = getSqliteDatabase().prepare(`SELECT json_extract(entry.payload_json, '$.details.taskId') AS taskId
      FROM sessions session JOIN transcript_entries entry ON entry.transcript_id = session.active_transcript_id
      WHERE session.conversation_id = ? AND entry.role = 'custom'
        AND json_extract(entry.payload_json, '$.customType') = ?
        AND json_extract(entry.payload_json, '$.display') = 1 AND entry.created_at < ?
        AND entry.created_at >= COALESCE((SELECT MAX(input.created_at_ms) FROM session_inputs input
          WHERE input.conversation_id = session.conversation_id AND input.id <> ?
            AND input.created_at_ms <= ? AND input.kind = 'message'
            AND (json_extract(input.origin_json, '$.type') <> 'system'
              OR json_extract(input.origin_json, '$.source') = 'cli')), 0)
      ORDER BY entry.seq DESC LIMIT 1`).get(conversationId, TASK_RESULT_DELIVERY_TYPE, before, inputId, before) as
        { taskId: string | null } | undefined;
    return row?.taskId ?? undefined;
  }

  getConversationId(taskId: string): string | undefined {
    const row = getSqliteDatabase().prepare('SELECT conversation_id FROM task_origin_links WHERE task_id = ?')
      .get(taskId) as { conversation_id: string } | undefined;
    return row?.conversation_id;
  }

  list(conversationId: string, limit = 20, options: { offset?: number; order?: 'active-first' | 'recent'; query?: string; excludeClosed?: boolean } = {}): { items: DelegatedTaskSummary[]; total: number } {
    const db = getSqliteDatabase();
    const query = options.query?.trim() ?? '';
    const selection = `FROM task_origin_links origin JOIN tasks task ON task.task_id = origin.task_id
      LEFT JOIN task_contracts contract ON contract.task_id = task.task_id AND contract.version = task.latest_contract_version
      WHERE origin.conversation_id = ? AND (? = '' OR instr(lower(task.title), lower(?)) > 0
        OR instr(lower(coalesce(contract.objective, '')), lower(?)) > 0)
      ${options.excludeClosed ? "AND task.phase <> 'closed'" : ''}`;
    const bindings = [conversationId, query, query, query];
    const total = (db.prepare(`SELECT count(*) AS count ${selection}`).get(...bindings) as { count: number }).count;
    const rows = db.prepare(`SELECT task.task_id AS id, task.title, contract.objective, task.phase, task.created_at AS createdAt,
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
    const ended = `${DELEGATED_WORK} AND (${this.endedWork(conversationId)})`;
    const { total } = db.prepare(`SELECT count(*) AS total ${ended}`).get(conversationId) as { total: number };
    const items = db.prepare(`SELECT task.task_id AS id, task.title, task.phase, task.resolution,
      CASE WHEN task.phase = 'closed' THEN task.updated_at
        ELSE MAX(task.updated_at, COALESCE(latest.completed_at, task.updated_at)) END AS updatedAt
      ${ended} ORDER BY updatedAt DESC, task.task_id DESC LIMIT ? OFFSET ?`)
      .all(conversationId, limit, offset) as { id: string; title: string; phase: string; resolution: TaskResolution | null; updatedAt: number }[];
    const deliveries = new TaskResultDeliveryRepository();
    return { total, items: items.map(item => ({
      ...item,
      presentation: { status: item.resolution === 'done' ? 'completed' as const : item.phase === 'closed' ? 'ended' as const : 'failed' as const,
        primaryAction: { type: 'view_results' as const } },
      artifact: item.resolution === 'done' || item.phase !== 'closed' ? deliveries.fileDeliveryState(item.id, conversationId, true).artifact : undefined,
    })) };
  }

  private endedWork(conversationId: string): string {
    return isPersonalConversation(conversationId) ? `(${CLOSED_WORK}) OR (${PERSONAL_BACKGROUND_OUTCOME})` : CLOSED_WORK;
  }
}
