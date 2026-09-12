import { getSqliteDatabase } from '../storage/sqlite/transaction.js';

export function proactiveMetrics(workspace: string, now = Date.now()) {
  const db = getSqliteDatabase();
  const since = new Date(now - 30 * 86400000).toISOString();
  const cards = db.prepare(`SELECT COUNT(*) AS total, SUM(CASE WHEN i.status = 'resolved' THEN 1 ELSE 0 END) AS resolved,
    SUM(CASE WHEN i.withdrawn_at IS NOT NULL THEN 1 ELSE 0 END) AS withdrawn FROM proactive_inbox_items i
    JOIN proactive_insights x USING(insight_id) JOIN proactive_scenario_subscriptions s USING(subscription_id) WHERE s.workspace_id = ? AND i.created_at >= ?`).get(workspace, since);
  const feedback = db.prepare(`SELECT f.rating, COUNT(*) AS count FROM proactive_feedback f JOIN proactive_inbox_items i USING(inbox_item_id)
    JOIN proactive_insights x USING(insight_id) JOIN proactive_scenario_subscriptions s USING(subscription_id) WHERE s.workspace_id = ? AND f.created_at >= ? AND NOT EXISTS (SELECT 1 FROM proactive_feedback newer WHERE newer.inbox_item_id = f.inbox_item_id AND (newer.created_at > f.created_at OR (newer.created_at = f.created_at AND newer.rowid > f.rowid))) GROUP BY f.rating`).all(workspace, since);
  const interruptions = db.prepare('SELECT local_day AS day, COUNT(*) AS count FROM proactive_notification_budget WHERE workspace_id = ? AND created_at >= ? GROUP BY local_day ORDER BY local_day DESC').all(workspace, since);
  const runs = db.prepare(`SELECT r.status, r.outcome_reason AS reason, COUNT(*) AS count FROM proactive_runs r JOIN proactive_scenario_subscriptions s USING(subscription_id) WHERE s.workspace_id = ? AND r.started_at >= ? GROUP BY r.status, r.outcome_reason`).all(workspace, since);
  const browser = db.prepare(`SELECT d.status, COUNT(*) AS count FROM proactive_web_push_deliveries d JOIN proactive_web_push_subscriptions s ON s.id = d.subscription_id WHERE s.workspace_id = ? GROUP BY d.status`).all(workspace);
  const telegram = db.prepare('SELECT status, COUNT(*) AS count FROM proactive_channel_deliveries WHERE workspace_id = ? GROUP BY status').all(workspace);
  const usage = db.prepare(`SELECT SUM(r.input_tokens) AS inputTokens, SUM(r.output_tokens) AS outputTokens, SUM(r.estimated_cost_usd) AS estimatedCostUsd, COUNT(r.estimated_cost_usd) AS pricedRuns, COUNT(*) AS totalRuns FROM proactive_runs r JOIN proactive_scenario_subscriptions s USING(subscription_id) WHERE s.workspace_id = ? AND r.started_at >= ?`).get(workspace, since);
  return { usage, since, cards, feedback, interruptions, runs, browser, telegram };
}
