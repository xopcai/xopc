import type { DatabaseSync } from 'node:sqlite';

export interface SceneCutoverTable {
  name: string;
  rows: number;
  destination: 'templates' | 'activations' | 'events' | 'runs' | 'outcomes' | 'notifications' | 'preferences' | 'work_items' | 'heartbeat' | 'unmapped';
  states: Record<string, Record<string, number>>;
}

const destinations: Record<SceneCutoverTable['destination'], readonly string[]> = {
  templates: ['proactive_scenarios', 'proactive_scenario_versions'],
  activations: ['proactive_scenario_subscriptions', 'proactive_prompt_revisions', 'proactive_subscription_settings'],
  events: ['proactive_events', 'proactive_signal_batches', 'proactive_batch_events', 'proactive_schedule_state'],
  runs: ['proactive_runs', 'proactive_context_snapshots'],
  outcomes: ['proactive_insights', 'proactive_inbox_items', 'proactive_decisions', 'proactive_feedback', 'proactive_instruction_feedback', 'proactive_card_changes', 'proactive_card_actions', 'proactive_card_review_state'],
  notifications: ['proactive_delivery_outbox', 'proactive_web_push_keys', 'proactive_web_push_subscriptions', 'proactive_web_push_deliveries', 'proactive_notification_budget', 'proactive_digest_queue', 'proactive_digests', 'proactive_digest_members', 'proactive_channel_deliveries', 'proactive_delivery_decisions', 'proactive_push_probes'],
  preferences: ['proactive_preferences', 'proactive_presence'],
  work_items: ['proactive_follow_ups'],
  heartbeat: ['heartbeat_checks'],
  unmapped: [],
};

const quoteIdentifier = (value: string) => `"${value.replaceAll('"', '""')}"`;

// These queues can still cause external writes. They must be drained or explicitly
// reconciled offline, not silently discarded or replayed by the new runtime.
const pendingEffects: Record<string, { column: string; values: readonly string[] }> = {
  proactive_insights: { column: 'action_status', values: ['pending'] },
  proactive_delivery_outbox: { column: 'status', values: ['pending', 'retryable'] },
  proactive_web_push_deliveries: { column: 'status', values: ['pending'] },
  proactive_channel_deliveries: { column: 'status', values: ['pending'] },
  heartbeat_checks: { column: 'delivery_status', values: ['pending'] },
};

/** Read-only inventory. It deliberately exposes counts, not private prompts or credentials. */
export function inspectSceneCutover(db: DatabaseSync): { tables: SceneCutoverTable[]; blockers: string[] } {
  const names = db.prepare(`SELECT name FROM sqlite_master WHERE type = 'table'
    AND (name GLOB 'proactive_*' OR name = 'heartbeat_checks') ORDER BY name`).all() as Array<{ name: string }>;
  const blockers: string[] = [];
  const sharedTables = new Set(db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name IN ('notification_events', 'notification_deliveries')")
    .all().map((row) => row.name));
  if (sharedTables.size === 2) {
    const mobile = db.prepare(`SELECT d.status, d.provider_ticket_id FROM notification_deliveries d
      JOIN notification_events e ON e.event_id = d.event_id WHERE e.event_type = 'proactive.insight'
      AND (d.status = 'pending' OR (d.status = 'accepted' AND (d.provider_ticket_id IS NULL OR trim(d.provider_ticket_id) = '')))
      LIMIT 1`).get();
    if (mobile) blockers.push(mobile.status === 'pending'
      ? 'pending_effect:notification_deliveries:proactive.insight' : 'requires_reconciliation:notification_deliveries:proactive.insight');
  }
  const tables = names.map(({ name }): SceneCutoverTable => {
    const destination = (Object.keys(destinations) as SceneCutoverTable['destination'][])
      .find((key) => destinations[key].includes(name)) ?? 'unmapped';
    const rows = Number(db.prepare(`SELECT count(*) AS n FROM ${quoteIdentifier(name)}`).get()?.n ?? 0);
    if (destination === 'unmapped') blockers.push(`unmapped_table:${name}`);
    const columns = db.prepare(`PRAGMA table_info(${quoteIdentifier(name)})`).all() as Array<{ name: string }>;
    const states: SceneCutoverTable['states'] = {};
    for (const column of ['status', 'delivery_status', 'action_status']) {
      if (!columns.some((item) => item.name === column)) continue;
      const counts = db.prepare(`SELECT ${quoteIdentifier(column)} AS value, count(*) AS n FROM ${quoteIdentifier(name)} GROUP BY ${quoteIdentifier(column)}`).all() as Array<{ value: string | null; n: number }>;
      states[column] = Object.fromEntries(counts.map(({ value, n }) => [value ?? '(null)', Number(n)]));
      if (counts.some(({ value }) => value !== null && ['running', 'processing', 'sending', 'delivering', 'executing'].includes(value))) {
        blockers.push(`in_flight:${name}:${column}`);
      }
      if (counts.some(({ value }) => value === 'unknown')) blockers.push(`requires_reconciliation:${name}:${column}`);
      const pending = pendingEffects[name];
      if (pending?.column === column && counts.some(({ value }) => value !== null && pending.values.includes(value))) {
        blockers.push(`pending_effect:${name}:${column}`);
      }
      // The old heartbeat only recorded a bus handoff, not a channel receipt.
      if (name === 'heartbeat_checks' && column === 'delivery_status' && counts.some(({ value }) => value === 'queued')) {
        blockers.push(`requires_reconciliation:${name}:${column}`);
      }
    }
    return { name, rows, destination, states };
  });
  return { tables, blockers: [...new Set(blockers)] };
}
