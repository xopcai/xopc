import { listMailFollowUps } from './follow-ups.js';
import { z } from 'zod';

import { getSqliteDatabase, runSqliteWriteTransaction } from '../storage/sqlite/transaction.js';
import { getCard } from './inbox/cards.js';
import { effectiveProactivePolicy, ProactiveConflict } from './policy/service.js';
import { controlledSubscriptions, createControlledSubscription, requireSubscription, updateControlledSubscription } from './scenarios/control.js';
import { ProactiveScenarioService } from './scenarios/service.js';
import { ProactiveEventService } from './service.js';
import { scanDueProjects } from './temporal/schedule.js';

const DelegateSchema = z.object({
  scenarioKey: z.enum(['project_delivery_risk', 'meeting_preparation', 'discussion_follow_up']),
  projectId: z.string().min(1).optional(),
  instructions: z.string().trim().min(1).max(12000),
}).strict();

export function startDelegation(workspace: string, value: unknown) {
  const input = DelegateSchema.parse(value);
  if (input.scenarioKey === 'project_delivery_risk' && !input.projectId) throw new Error('Choose a project');
  if (input.scenarioKey !== 'project_delivery_risk' && input.projectId) throw new Error('This service uses workspace sources');
  const subscription = createControlledSubscription(workspace, {
    scenarioKey: input.scenarioKey, scopeKind: input.projectId ? 'project' : 'workspace',
    scopeId: input.projectId ?? workspace, userInstructions: input.instructions,
  });
  if (input.projectId && effectiveProactivePolicy(subscription.id).enabled) checkDelegation(workspace, subscription.id);
  return subscription;
}

/** Queue work in the existing worker; HTTP and conversation requests do not own model runs. */
export function checkDelegation(workspace: string, id: string) {
  const sub = requireSubscription(id, workspace);
  if (!effectiveProactivePolicy(id).enabled) throw new Error('Resume this service before checking');
  if (sub.scopeKind !== 'project') throw new Error('This service checks when connected sources change');
  return runSqliteWriteTransaction((db) => {
    const running = db.prepare("SELECT 1 FROM proactive_signal_batches WHERE subscription_id = ? AND status IN ('collecting', 'ready', 'processing')").get(id);
    if (running) return { status: 'queued' as const };
    const last = db.prepare('SELECT MAX(started_at) AS at FROM proactive_runs WHERE subscription_id = ?').get(id) as { at: string | null };
    if (last.at && Date.parse(last.at) > Date.now() - 60000) throw new ProactiveConflict('A check just finished; try again in a minute');
    db.prepare(`INSERT INTO proactive_schedule_state(subscription_id, next_due_at) VALUES (?, ?)
      ON CONFLICT(subscription_id) DO UPDATE SET next_due_at = excluded.next_due_at, last_fingerprint = NULL`).run(id, new Date().toISOString());
    scanDueProjects(new ProactiveEventService(() => new ProactiveScenarioService().routes()));
    db.prepare("UPDATE proactive_signal_batches SET ready_at = ?, status = 'ready' WHERE subscription_id = ? AND status = 'collecting'").run(new Date().toISOString(), id);
    return { status: 'queued' as const };
  });
}

export function delegationOverview(workspace: string) {
  const db = getSqliteDatabase();
  const now = new Date().toISOString();
  const rows = db.prepare(`SELECT i.inbox_item_id FROM proactive_inbox_items i
    JOIN proactive_insights x USING(insight_id) JOIN proactive_scenario_subscriptions s USING(subscription_id)
    WHERE s.workspace_id = ? AND i.withdrawn_at IS NULL AND i.status IN ('unread', 'read')
    AND (i.expires_at IS NULL OR i.expires_at > ?)
    ORDER BY CASE WHEN x.action_status = 'approval_required' THEN 0 WHEN x.artifact_json IS NOT NULL THEN 1 ELSE 2 END,
    x.value_score DESC, i.updated_at DESC LIMIT 100`).all(workspace, now) as Array<{ inbox_item_id: string }>;
  const cards = rows.map(row => getCard(row.inbox_item_id, workspace)).filter(card => !['withdrawn', 'expired'].includes(card.status));
  return {
    followUps: listMailFollowUps(workspace),
    needsDecision: cards.filter(card => card.decision && card.actionStatus !== 'completed'),
    prepared: cards.filter(card => card.artifact && !card.decision),
    updates: cards.filter(card => !card.artifact && !card.decision),
    delegations: controlledSubscriptions(workspace).map(sub => ({
      ...sub,
      effectiveEnabled: effectiveProactivePolicy(sub.id).enabled,
      project: sub.scopeKind === 'project' ? db.prepare('SELECT name, status FROM projects WHERE project_id = ?').get(sub.scopeId) ?? null : null,
      latestRun: db.prepare(`SELECT status, outcome_reason AS reason, completed_at AS completedAt, started_at AS startedAt, error_message AS error
        FROM proactive_runs WHERE subscription_id = ? ORDER BY started_at DESC LIMIT 1`).get(sub.id) ?? null,
      pending: Boolean(db.prepare("SELECT 1 FROM proactive_signal_batches WHERE subscription_id = ? AND status IN ('collecting', 'ready', 'processing')").get(sub.id)),
    })),
  };
}

export function completeDeliveredProjects(now = new Date()) {
  const db = getSqliteDatabase();
  const rows = db.prepare(`SELECT s.subscription_id, s.workspace_id FROM proactive_scenario_subscriptions s
    JOIN projects p ON p.project_id = s.scope_id WHERE s.scope_kind = 'project' AND s.enabled = 1
    AND p.status IN ('completed', 'cancelled', 'archived')`).all() as Array<{ subscription_id: string; workspace_id: string }>;
  for (const row of rows) {
    const current = controlledSubscriptions(row.workspace_id).find(sub => sub.id === row.subscription_id)!;
    updateControlledSubscription(row.workspace_id, row.subscription_id, { expectedRevision: current.revision, enabled: false, completedAt: now.toISOString() });
    db.prepare(`UPDATE proactive_inbox_items SET status = 'resolved', resolution = 'project_ended', updated_at = ?
      WHERE insight_id IN (SELECT insight_id FROM proactive_insights WHERE subscription_id = ?) AND status <> 'resolved'`).run(now.toISOString(), row.subscription_id);
  }
}
