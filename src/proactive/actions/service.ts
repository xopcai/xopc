import { insightCorrelation } from '../inbox/lifecycle.js';
import { insightSourcesAuthorized } from '../execution/authorization.js';
import { effectiveProactivePolicy } from '../policy/service.js';
import type { InsightCandidate } from '../execution/types.js';
import { getSqliteDatabase, runSqliteWriteTransaction } from '../../storage/sqlite/transaction.js';
import { TaskApplicationService } from '../../tasks/task-application-service.js';

type ActionRow = {
  insight_id: string;
  subscription_id: string;
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
    if (getSqliteDatabase().prepare('SELECT 1 FROM proactive_inbox_items WHERE insight_id = ? AND withdrawn_at IS NOT NULL').get(row.insight_id)) throw new Error('Card was withdrawn');
    if (!insightSourcesAuthorized(row.insight_id)) throw new Error('Source permission is no longer available');
    if (!effectiveProactivePolicy(row.subscription_id).enabled) throw new Error('Proactive subscription paused');
    const permission = getSqliteDatabase().prepare(`SELECT mode, allowed_actions_json FROM project_monitoring_policies WHERE project_id = ?`).get(projectIdFromAggregationKey(row.aggregation_key)) as { mode: string; allowed_actions_json: string } | undefined;
    const approved = getSqliteDatabase().prepare(`SELECT 1 FROM proactive_decisions d JOIN proactive_inbox_items i USING(inbox_item_id) WHERE i.insight_id = ? AND d.choice = 'approve'`).get(row.insight_id);
    if (!approved && !(permission?.mode === 'auto_low_risk' && (JSON.parse(permission.allowed_actions_json) as string[]).includes(action.id))) throw new Error('Action permission is no longer available');
    if (action.id !== 'create_project_task') throw new Error(`Unsupported proactive action: ${action.id}`);
    const result = new TaskApplicationService().create({
      idempotencyKey: `proactive:${insightCorrelation(row.insight_id)}:${action.id}`,
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
      const candidate = db.prepare(`SELECT x.insight_id, x.subscription_id, b.aggregation_key, x.proposed_action_json
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
