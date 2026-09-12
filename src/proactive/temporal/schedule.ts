import { createHash } from 'node:crypto';

import { runSqliteWriteTransaction } from '../../storage/sqlite/transaction.js';
import { effectiveProactivePolicy, localProactiveDay } from '../policy/service.js';
import type { ProactiveEventService } from '../service.js';

/** Local scans publish through the same event pipeline; next_due_at survives restarts. */
export function scanDueProjects(events: ProactiveEventService, now = new Date()): number {
  return runSqliteWriteTransaction((db) => {
    const rows = db.prepare(`SELECT q.*, s.workspace_id, s.scope_id, s.scenario_key FROM proactive_schedule_state q
      JOIN proactive_scenario_subscriptions s USING(subscription_id)
      WHERE q.next_due_at <= ? AND s.enabled = 1 AND s.scope_kind = 'project'
      AND s.scenario_key IN ('project_delivery_risk', 'blocked_work') ORDER BY q.next_due_at LIMIT 20`).all(now.toISOString()) as Array<{ subscription_id: string; scope_id: string; workspace_id: string; scenario_key: string; next_due_at: string; last_fingerprint: string | null }>;
    let published = 0;
    for (const row of rows) {
      const policy = effectiveProactivePolicy(row.subscription_id, now);
      if (!policy.enabled) {
        db.prepare('UPDATE proactive_schedule_state SET next_due_at = ? WHERE subscription_id = ?').run(new Date(now.getTime() + 60000).toISOString(), row.subscription_id);
        continue;
      }
      const project = db.prepare('SELECT * FROM projects WHERE project_id = ?').get(row.scope_id);
      const tasks = db.prepare(`SELECT task_id, phase, due_at, updated_at FROM tasks WHERE project_id = ? AND phase <> 'closed' ORDER BY task_id`).all(row.scope_id);
      const deadlines = (tasks as Array<{ due_at: string | number | null }>).map((task) => {
        const due = typeof task.due_at === 'number' ? task.due_at : task.due_at ? Date.parse(task.due_at) : NaN;
        const remaining = due - now.getTime();
        return !Number.isFinite(remaining) ? null : remaining <= 0 ? 'overdue' : remaining <= 7200000 ? '2h' : remaining <= 86400000 ? '24h' : 'later';
      });
      const waits = db.prepare(`SELECT w.* FROM task_waits w JOIN tasks t ON t.task_id = w.task_id WHERE t.project_id = ? AND w.status = 'active' ORDER BY w.task_id, w.created_at`).all(row.scope_id);
      const fingerprint = createHash('sha256').update(JSON.stringify([project, tasks, waits, deadlines, localProactiveDay(now, policy.preferences.timezone)])).digest('hex');
      if (project && fingerprint !== row.last_fingerprint) {
        events.publish({
          type: 'proactive.scan.v1', schemaVersion: 1,
          source: { kind: 'proactive_scheduler', id: row.subscription_id },
          subject: { kind: 'project', id: row.scope_id }, actor: { kind: 'system' },
          scope: { workspaceId: row.workspace_id, projectId: row.scope_id },
          occurredAt: now.toISOString(), dedupeKey: `scan:${row.subscription_id}:${row.next_due_at}`,
          sensitivity: 'personal', payload: { subscriptionId: row.subscription_id, reason: 'scheduled_check', observedAt: now.toISOString() },
        }, now);
        published++;
      }
      db.prepare(`UPDATE proactive_schedule_state SET next_due_at = ?, last_checked_at = ?, last_fingerprint = ? WHERE subscription_id = ?`)
        .run(new Date(now.getTime() + policy.scanIntervalMinutes * 60000).toISOString(), now.toISOString(), fingerprint, row.subscription_id);
    }
    return published;
  });
}
