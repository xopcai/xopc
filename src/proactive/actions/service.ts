import type { InsightCandidate } from '../execution/types.js';
import { getSqliteDatabase, runSqliteWriteTransaction } from '../../storage/sqlite/transaction.js';
import { TaskApplicationService } from '../../tasks/task-application-service.js';

type ActionRow = {
  insight_id: string;
  aggregation_key: string;
  proposed_action_json: string;
};

function projectIdFromAggregationKey(value: string): string {
  if (!value.startsWith('project:') || value.length === 'project:'.length) throw new Error('Proactive action has no project scope');
  return value.slice('project:'.length);
}

function executeClaimedAction(row: ActionRow, now = new Date()): void {
  const action = JSON.parse(row.proposed_action_json) as NonNullable<InsightCandidate['proposedAction']>;
  try {
    if (action.id !== 'create_project_task') throw new Error(`Unsupported proactive action: ${action.id}`);
    const result = new TaskApplicationService().create({
      idempotencyKey: `proactive:${row.insight_id}:${action.id}`,
      title: action.input.title,
      projectId: projectIdFromAggregationKey(row.aggregation_key),
      priority: 'normal',
      contract: {
        objective: action.input.objective,
        expectedOutputs: [],
        acceptanceCriteria: [],
        constraints: [],
        approvalRequired: [],
        assumptions: [],
        risks: [],
        acceptancePolicy: 'manual',
        outputDestinations: [],
      },
      dependencies: [],
      context: [],
      authorityGrants: [],
      activation: { mode: 'capture', phase: 'backlog' },
    }, { kind: 'system', id: 'proactive' });
    if (!result.ok) throw new Error(`Task creation failed: ${'reason' in result ? result.reason : 'unknown'}`);
    getSqliteDatabase().prepare(`UPDATE proactive_insights
      SET action_status = 'completed', action_result_json = ?, action_error = NULL, action_updated_at = ?
      WHERE insight_id = ? AND action_status = 'executing'`)
      .run(JSON.stringify({ taskId: result.model.task.id }), now.toISOString(), row.insight_id);
  } catch (error) {
    getSqliteDatabase().prepare(`UPDATE proactive_insights
      SET action_status = 'failed', action_error = ?, action_updated_at = ?
      WHERE insight_id = ? AND action_status = 'executing'`)
      .run(String(error instanceof Error ? error.message : error).slice(0, 2000), now.toISOString(), row.insight_id);
  }
}

export function executePendingProactiveActions(now = new Date()): number {
  const expired = new Date(now.getTime() - 5 * 60_000).toISOString();
  getSqliteDatabase().prepare(`UPDATE proactive_insights SET action_status = 'pending', action_updated_at = ?
    WHERE action_status = 'executing' AND action_updated_at <= ?`).run(now.toISOString(), expired);
  let executed = 0;
  while (true) {
    const row = runSqliteWriteTransaction((db) => {
      const candidate = db.prepare(`SELECT x.insight_id, b.aggregation_key, x.proposed_action_json
        FROM proactive_insights x
        JOIN proactive_runs r ON r.run_id = x.run_id
        JOIN proactive_signal_batches b ON b.batch_id = r.batch_id
        WHERE x.action_status = 'pending' ORDER BY x.created_at LIMIT 1`).get() as ActionRow | undefined;
      if (!candidate) return undefined;
      const claimed = db.prepare(`UPDATE proactive_insights SET action_status = 'executing', action_updated_at = ?
        WHERE insight_id = ? AND action_status = 'pending'`).run(now.toISOString(), candidate.insight_id);
      return claimed.changes === 1 ? candidate : undefined;
    });
    if (!row) return executed;
    executeClaimedAction(row, now);
    executed += 1;
  }
}

export function resolveProactiveActionDecision(inboxItemId: string, choice: string, now = new Date()): void {
  const row = getSqliteDatabase().prepare(`SELECT x.insight_id, x.action_status
    FROM proactive_inbox_items i JOIN proactive_insights x ON x.insight_id = i.insight_id
    WHERE i.inbox_item_id = ?`).get(inboxItemId) as { insight_id: string; action_status: string | null } | undefined;
  if (!row || row.action_status !== 'approval_required') return;
  getSqliteDatabase().prepare(`UPDATE proactive_insights SET action_status = ?, action_updated_at = ?
    WHERE insight_id = ? AND action_status = 'approval_required'`)
    .run(choice === 'approve' ? 'pending' : 'rejected', now.toISOString(), row.insight_id);
  if (choice === 'approve') executePendingProactiveActions(now);
}
