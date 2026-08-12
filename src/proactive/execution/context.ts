import { getSqliteDatabase } from '../../storage/sqlite/transaction.js';

import type { ContextProvider } from './types.js';

type EventRow = { event_id: string; type: string; subject_kind: string; subject_id: string; payload_json: string; occurred_at: string };

export class EventBatchContextProvider implements ContextProvider {
  readonly id = 'event_batch';
  supports(): boolean { return true; }

  async collect(input: { eventIds: string[] }): Promise<Record<string, unknown>> {
    if (input.eventIds.length === 0) return { events: [] };
    const rows = getSqliteDatabase().prepare(`SELECT event_id, type, subject_kind, subject_id, payload_json, occurred_at
      FROM proactive_events WHERE event_id IN (${input.eventIds.map(() => '?').join(',')}) ORDER BY occurred_at`)
      .all(...input.eventIds) as unknown as EventRow[];
    return { events: rows.map((row) => ({
      evidenceId: row.event_id,
      type: row.type,
      subject: { kind: row.subject_kind, id: row.subject_id },
      payload: JSON.parse(row.payload_json),
      occurredAt: row.occurred_at,
    })) };
  }
}

export class ProjectStateContextProvider implements ContextProvider {
  readonly id = 'project_state';
  supports(scenarioKey: string): boolean { return scenarioKey === 'project_delivery_risk' || scenarioKey === 'blocked_work'; }

  async collect(input: { eventIds: string[] }): Promise<Record<string, unknown>> {
    if (!input.eventIds.length) return {};
    const project = getSqliteDatabase().prepare(`SELECT p.* FROM proactive_events e JOIN projects p ON p.project_id = e.project_id
      WHERE e.event_id IN (${input.eventIds.map(() => '?').join(',')}) AND e.project_id IS NOT NULL ORDER BY e.occurred_at DESC LIMIT 1`)
      .get(...input.eventIds) as Record<string, unknown> | undefined;
    if (!project) return {};
    const workItems = getSqliteDatabase().prepare(`SELECT id, title, status, priority, owner_agent_id, next_action,
      blocked_reason, due_at, updated_at FROM work_items WHERE project_id = ? AND archived_at IS NULL
      ORDER BY CASE status WHEN 'blocked' THEN 0 ELSE 1 END, updated_at DESC LIMIT 100`).all(String(project.project_id));
    return { project, workItems };
  }
}

export class AutomationStateContextProvider implements ContextProvider {
  readonly id = 'automation_state';
  supports(scenarioKey: string): boolean { return scenarioKey === 'automation_failure_impact'; }

  async collect(input: { eventIds: string[] }): Promise<Record<string, unknown>> {
    if (!input.eventIds.length) return {};
    const run = getSqliteDatabase().prepare(`SELECT r.* FROM proactive_events e JOIN automation_runs r ON r.run_id = e.subject_id
      WHERE e.event_id IN (${input.eventIds.map(() => '?').join(',')}) ORDER BY e.occurred_at DESC LIMIT 1`)
      .get(...input.eventIds) as Record<string, unknown> | undefined;
    if (!run) return {};
    const automation = getSqliteDatabase().prepare(`SELECT automation_id, name, description, enabled, reliability_json, state_json, project_id
      FROM automations WHERE automation_id = ?`).get(String(run.automation_id));
    return { automation, failedRun: run };
  }
}

export class ContextProviderRegistry {
  constructor(private readonly providers: ContextProvider[] = [
    new EventBatchContextProvider(), new ProjectStateContextProvider(), new AutomationStateContextProvider(),
  ]) {}

  async collect(scenarioKey: string, input: { batchId: string; eventIds: string[]; subscriptionId: string }): Promise<Record<string, unknown>> {
    const entries = await Promise.all(this.providers.filter((provider) => provider.supports(scenarioKey))
      .map(async (provider) => [provider.id, await provider.collect(input)] as const));
    return Object.fromEntries(entries);
  }
}
