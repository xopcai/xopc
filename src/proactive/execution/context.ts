import { listMemoryRecords } from '../../storage/sqlite/memory-records-repository.js';
import { getConnectorSyncPolicy } from '../../storage/sqlite/connector-sync-policy-repository.js';
import { getKnowledgeSourceItem } from '../../storage/sqlite/knowledge-repository.js';
import { getSqliteDatabase } from '../../storage/sqlite/transaction.js';
import { wrapExternalContent } from '../../gateway/security/external-content.js';

import type { ContextProvider, ResolvedContext } from './types.js';

type EventRow = {
  event_id: string;
  type: string;
  subject_kind: string;
  subject_id: string;
  payload_json: string;
  workspace_id: string;
  project_id: string | null;
  agent_id: string | null;
  occurred_at: string;
};

type ContextInput = Parameters<ContextProvider['collect']>[0];
const MAX_EVENT_COUNT = 50;

function boundedText(value: unknown, limit: number): string | undefined {
  if (typeof value !== 'string') return undefined;
  const normalized = value.trim();
  if (!normalized) return undefined;
  return normalized.length > limit ? `${normalized.slice(0, limit)}…` : normalized;
}

function eventRows(eventIds: string[]): EventRow[] {
  const ids = [...new Set(eventIds)].slice(0, MAX_EVENT_COUNT);
  if (ids.length === 0) return [];
  return getSqliteDatabase().prepare(`SELECT event_id, type, subject_kind, subject_id, payload_json,
      workspace_id, project_id, agent_id, occurred_at FROM proactive_events
      WHERE event_id IN (${ids.map(() => '?').join(',')}) ORDER BY occurred_at`)
    .all(...ids) as unknown as EventRow[];
}

function emptyContext(): ResolvedContext {
  return { content: {}, snapshotContent: {}, evidenceIds: [] };
}

function authorizedConnectedSourceItem(event: EventRow, scenarioKey: string) {
  const item = getKnowledgeSourceItem(event.subject_id);
  const connectionId = typeof item?.metadata.connectionId === 'string'
    ? item.metadata.connectionId
    : undefined;
  if (!item || item.deletedAt || !connectionId) return null;
  if (item.sensitivity === 'secret' || item.sensitivity === 'regulated') return null;
  if (item.metadata.workspaceId !== event.workspace_id) return null;
  if (event.agent_id && item.metadata.agentId && item.metadata.agentId !== event.agent_id) return null;
  const policy = getConnectorSyncPolicy(connectionId);
  const scenarioAllowed = !policy?.allowedScenarioKeys.length
    || policy.allowedScenarioKeys.includes(scenarioKey);
  return policy?.scanEnabled && policy.proactiveEnabled && scenarioAllowed ? item : null;
}

export class EventBatchContextProvider implements ContextProvider {
  readonly id = 'event_batch';
  supports(): boolean { return true; }

  async collect(input: ContextInput): Promise<ResolvedContext> {
    const rows = eventRows(input.eventIds).filter((row) => (
      !row.type.startsWith('connected_source.')
      || Boolean(authorizedConnectedSourceItem(row, input.scenarioKey))
    ));
    return {
      content: { events: rows.map((row) => ({
        evidenceId: row.event_id,
        type: row.type,
        subject: { kind: row.subject_kind, id: row.subject_id },
        payload: JSON.parse(row.payload_json),
        occurredAt: row.occurred_at,
      })) },
      evidenceIds: rows.map((row) => row.event_id),
    };
  }
}

export class ConnectedSourceContextProvider implements ContextProvider {
  readonly id = 'connected_source';
  supports(): boolean { return true; }

  async collect(input: ContextInput): Promise<ResolvedContext> {
    const items: Record<string, unknown>[] = [];
    const snapshotItems: Record<string, unknown>[] = [];
    const evidenceIds: string[] = [];
    for (const event of eventRows(input.eventIds)) {
      if (!event.type.startsWith('connected_source.') || event.type.includes('_deleted.')) continue;
      const item = authorizedConnectedSourceItem(event, input.scenarioKey);
      if (!item) continue;
      const evidenceId = `source-item:${item.id}`;
      const common = {
        evidenceId,
        sourceItemId: item.id,
        sourceInstanceId: item.sourceInstanceId,
        collectionScope: item.collectionScope,
        itemType: item.itemType,
        occurredAt: item.occurredAt,
        sourceUpdatedAt: item.sourceUpdatedAt,
      };
      const content = boundedText(item.normalizedText, 6_000);
      items.push({
        ...common,
        ...(content ? {
          content: wrapExternalContent(content, {
            source: item.itemType === 'email' || item.itemType === 'message' ? 'email' : 'api',
          }),
        } : {}),
      });
      snapshotItems.push({
        ...common,
        contentHash: item.contentHash,
        sensitivity: item.sensitivity,
      });
      evidenceIds.push(evidenceId);
      if (items.length >= 20) break;
    }
    return {
      content: { items },
      snapshotContent: { items: snapshotItems },
      evidenceIds,
    };
  }
}

export class InternalObjectContextProvider implements ContextProvider {
  readonly id = 'internal_objects';
  supports(): boolean { return true; }

  async collect(input: ContextInput): Promise<ResolvedContext> {
    const db = getSqliteDatabase();
    const objects: Record<string, unknown>[] = [];
    const evidenceIds: string[] = [];
    for (const event of eventRows(input.eventIds)) {
      if (event.subject_kind === 'goal') {
        const goal = db.prepare(`SELECT goal_id, title, description, status, agent_id, priority,
          deadline_at, updated_at, next_action, blocked_reason FROM goals WHERE goal_id = ?`)
          .get(event.subject_id) as Record<string, unknown> | undefined;
        if (goal) {
          const evidenceId = `goal:${event.subject_id}`;
          objects.push({ evidenceId, kind: 'goal', ...goal });
          evidenceIds.push(evidenceId);
        }
      } else if (event.subject_kind === 'note') {
        const note = db.prepare(`SELECT note_id, title, kind, status, snippet, pinned, tags_json,
          task_done, task_due_at, unchecked_task_count, updated_at FROM notes WHERE note_id = ?`)
          .get(event.subject_id) as Record<string, unknown> | undefined;
        if (note) {
          const evidenceId = `note:${event.subject_id}`;
          objects.push({ ...note, evidenceId, kind: 'note', snippet: boundedText(note.snippet, 1_500) });
          evidenceIds.push(evidenceId);
        }
      }
      if (objects.length >= 20) break;
    }
    return { content: { objects }, evidenceIds };
  }
}

export class UserUnderstandingContextProvider implements ContextProvider {
  readonly id = 'user_understanding';
  supports(): boolean { return true; }

  async collect(input: ContextInput): Promise<ResolvedContext> {
    const scope = eventRows(input.eventIds).at(-1);
    if (!scope) return emptyContext();
    const records = listMemoryRecords({
      workspaceId: scope.workspace_id,
      ...(scope.project_id ? { visibleToProjectId: scope.project_id } : { unscopedProjectOnly: true }),
      status: 'active',
      limit: 20,
    }).filter((record) => {
      const now = Date.now();
      return record.disclosurePolicy === 'referenceable'
        && record.sensitivity !== 'secret'
        && record.sensitivity !== 'regulated'
        && !record.tags?.includes('playbook:disabled')
        && (!record.validFrom || Date.parse(record.validFrom) <= now)
        && (!record.validTo || Date.parse(record.validTo) >= now)
        && (!record.expiresAt || Date.parse(record.expiresAt) >= now)
        && (!record.reviewAfter || Date.parse(record.reviewAfter) >= now)
        && !record.conflictGroupId
        && (record.explicitness === 'explicit' || record.importance >= 0.7);
    });
    return {
      content: {
        records: records.map((record) => ({
          evidenceId: `memory:${record.id}`,
          kind: record.kind,
          content: boundedText(record.content, 1_000),
          confidence: record.confidence,
          importance: record.importance,
          updatedAt: record.updatedAt,
        })),
      },
      evidenceIds: records.map((record) => `memory:${record.id}`),
    };
  }
}

export class MeetingWorkspaceContextProvider implements ContextProvider {
  readonly id = 'meeting_workspace';
  supports(scenarioKey: string): boolean { return scenarioKey === 'meeting_preparation'; }

  async collect(input: ContextInput): Promise<ResolvedContext> {
    const scope = eventRows(input.eventIds).at(-1);
    if (!scope) return emptyContext();
    const calendarItem = authorizedConnectedSourceItem(scope, input.scenarioKey);
    if (!calendarItem?.normalizedText) return emptyContext();
    let title = '';
    try {
      const parsed = JSON.parse(calendarItem.normalizedText) as Record<string, unknown>;
      title = typeof parsed.title === 'string' ? parsed.title : '';
    } catch {
      return emptyContext();
    }
    const terms = [...new Set(title.toLocaleLowerCase().match(/[\p{L}\p{N}]{2,}/gu) ?? [])].slice(0, 6);
    if (terms.length === 0) return emptyContext();
    const db = getSqliteDatabase();
    const goalMatches = terms.map(() => `LOWER(COALESCE(title, '') || ' ' || COALESCE(description, '')
      || ' ' || COALESCE(next_action, '')) LIKE ?`).join(' OR ');
    const goals = db.prepare(`SELECT goal_id, title, description, status, priority, deadline_at,
      next_action, blocked_reason, project_id, updated_at FROM goals
      WHERE status NOT IN ('done', 'archived') AND agent_id = ? AND (${goalMatches})
      ORDER BY updated_at DESC LIMIT 10`)
      .all(scope.agent_id ?? 'main', ...terms.map((term) => `%${term}%`)) as Array<Record<string, unknown>>;
    const noteMatches = terms.map(() => `LOWER(COALESCE(title, '') || ' ' || COALESCE(snippet, '')) LIKE ?`).join(' OR ');
    const notes = db.prepare(`SELECT note_id, title, kind, status, snippet, tags_json, task_due_at,
      unchecked_task_count, updated_at FROM notes WHERE status NOT IN ('archived', 'trashed')
      AND (${noteMatches}) ORDER BY updated_at DESC LIMIT 10`)
      .all(...terms.map((term) => `%${term}%`)) as Array<Record<string, unknown>>;
    const goalEvidenceIds = goals.map((goal) => `goal:${String(goal.goal_id)}`);
    const noteEvidenceIds = notes.map((note) => `note:${String(note.note_id)}`);
    return {
      content: {
        activeGoals: goals.map((goal, index) => ({ evidenceId: goalEvidenceIds[index], ...goal })),
        recentNotes: notes.map((note, index) => ({
          evidenceId: noteEvidenceIds[index],
          ...note,
          snippet: boundedText(note.snippet, 1_500),
        })),
      },
      evidenceIds: [...goalEvidenceIds, ...noteEvidenceIds],
    };
  }
}

export class ProjectStateContextProvider implements ContextProvider {
  readonly id = 'project_state';
  supports(scenarioKey: string): boolean { return scenarioKey === 'project_delivery_risk' || scenarioKey === 'blocked_work'; }

  async collect(input: ContextInput): Promise<ResolvedContext> {
    if (!input.eventIds.length) return emptyContext();
    const project = getSqliteDatabase().prepare(`SELECT p.* FROM proactive_events e JOIN projects p ON p.project_id = e.project_id
      WHERE e.event_id IN (${input.eventIds.map(() => '?').join(',')}) AND e.project_id IS NOT NULL ORDER BY e.occurred_at DESC LIMIT 1`)
      .get(...input.eventIds) as Record<string, unknown> | undefined;
    if (!project) return emptyContext();
    const workItems = getSqliteDatabase().prepare(`SELECT id, title, status, priority, owner_agent_id, next_action,
      blocked_reason, due_at, updated_at FROM work_items WHERE project_id = ? AND archived_at IS NULL
      ORDER BY CASE status WHEN 'blocked' THEN 0 ELSE 1 END, updated_at DESC LIMIT 100`).all(String(project.project_id));
    const projectEvidenceId = `project:${String(project.project_id)}`;
    const workItemEvidenceIds = (workItems as Array<Record<string, unknown>>)
      .map((item) => `work-item:${String(item.id)}`);
    return {
      content: {
        project: { evidenceId: projectEvidenceId, ...project },
        workItems: (workItems as Array<Record<string, unknown>>).map((item, index) => ({
          evidenceId: workItemEvidenceIds[index], ...item,
        })),
      },
      evidenceIds: [projectEvidenceId, ...workItemEvidenceIds],
    };
  }
}

export class AutomationStateContextProvider implements ContextProvider {
  readonly id = 'automation_state';
  supports(scenarioKey: string): boolean { return scenarioKey === 'automation_failure_impact'; }

  async collect(input: ContextInput): Promise<ResolvedContext> {
    if (!input.eventIds.length) return emptyContext();
    const run = getSqliteDatabase().prepare(`SELECT r.* FROM proactive_events e JOIN automation_runs r ON r.run_id = e.subject_id
      WHERE e.event_id IN (${input.eventIds.map(() => '?').join(',')}) ORDER BY e.occurred_at DESC LIMIT 1`)
      .get(...input.eventIds) as Record<string, unknown> | undefined;
    if (!run) return emptyContext();
    const automation = getSqliteDatabase().prepare(`SELECT automation_id, name, description, enabled, reliability_json, state_json, project_id
      FROM automations WHERE automation_id = ?`).get(String(run.automation_id));
    const runEvidenceId = `automation-run:${String(run.run_id)}`;
    return {
      content: { automation, failedRun: { evidenceId: runEvidenceId, ...run } },
      evidenceIds: [runEvidenceId],
    };
  }
}

export class ContextProviderRegistry {
  constructor(private readonly providers: ContextProvider[] = [
    new EventBatchContextProvider(),
    new ConnectedSourceContextProvider(),
    new InternalObjectContextProvider(),
    new UserUnderstandingContextProvider(),
    new MeetingWorkspaceContextProvider(),
    new ProjectStateContextProvider(),
    new AutomationStateContextProvider(),
  ]) {}

  async collect(
    scenarioKey: string,
    input: { batchId: string; eventIds: string[]; subscriptionId: string },
  ): Promise<ResolvedContext> {
    const entries = await Promise.all(this.providers.filter((provider) => provider.supports(scenarioKey))
      .map(async (provider) => [provider.id, await provider.collect({ ...input, scenarioKey })] as const));
    return {
      content: Object.fromEntries(entries.map(([id, result]) => [id, result.content])),
      snapshotContent: Object.fromEntries(entries.map(([id, result]) => [
        id,
        result.snapshotContent ?? result.content,
      ])),
      evidenceIds: [...new Set(entries.flatMap(([, result]) => result.evidenceIds))],
    };
  }
}
