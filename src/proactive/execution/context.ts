import { getAssertionSlot, listUserAssertions } from '../../user-model/index.js';
import { getDiscussionCapture, getLatestDiscussionOrganization } from '../../discussions/repository.js';
import { getConnectorSyncPolicyForConnection } from '../../storage/sqlite/connector-sync-policy-repository.js';
import { getKnowledgeSourceItem } from '../../storage/sqlite/knowledge-repository.js';
import { getSqliteDatabase } from '../../storage/sqlite/transaction.js';
import { wrapExternalContent } from '../../gateway/security/external-content.js';

import type { ContextProvider, ResolvedContext } from './types.js';
import type { ScenarioDefinition } from '../scenarios/types.js';

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
  const policy = getConnectorSyncPolicyForConnection(connectionId);
  const scenarioAllowed = !policy?.allowedScenarioKeys.length
    || policy.allowedScenarioKeys.includes(scenarioKey);
  return policy?.scanEnabled && policy.proactiveEnabled && scenarioAllowed ? item : null;
}

export class EventBatchContextProvider implements ContextProvider {
  readonly id = 'event_batch';

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

  async collect(input: ContextInput): Promise<ResolvedContext> {
    const db = getSqliteDatabase();
    const objects: Record<string, unknown>[] = [];
    const evidenceIds: string[] = [];
    for (const event of eventRows(input.eventIds)) {
      if (event.subject_kind === 'task') {
        const task = db.prepare(`SELECT tasks.task_id, tasks.title, tasks.body,
          tasks.phase, tasks.resolution, tasks.priority,
          tasks.due_at, tasks.updated_at, tasks.delegate_agent_id,
          (SELECT kind FROM task_waits
            WHERE task_waits.task_id = tasks.task_id AND task_waits.status = 'active'
            ORDER BY task_waits.created_at DESC LIMIT 1) AS wait_kind,
          (SELECT reason FROM task_waits
            WHERE task_waits.task_id = tasks.task_id AND task_waits.status = 'active'
            ORDER BY task_waits.created_at DESC LIMIT 1) AS wait_reason
          FROM tasks
          WHERE tasks.task_id = ?`)
          .get(event.subject_id) as Record<string, unknown> | undefined;
        if (task) {
          const evidenceId = `task:${event.subject_id}`;
          objects.push({ evidenceId, kind: 'task', ...task });
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

export class UserModelContextProvider implements ContextProvider {
  readonly id = 'user_model';

  async collect(input: ContextInput): Promise<ResolvedContext> {
    const scope = eventRows(input.eventIds).at(-1);
    if (!scope) return emptyContext();
    const records = listUserAssertions({ statuses: ['active'], limit: 500 }).filter((record) => {
      const now = Date.now();
      const assertionScope = getAssertionSlot(record.slotId)?.scope;
      const scopeMatches = assertionScope?.type === 'global'
        || (assertionScope?.type === 'workspace' && assertionScope.id === scope.workspace_id)
        || (assertionScope?.type === 'project' && assertionScope.id === scope.project_id)
        || (assertionScope?.type === 'agent' && assertionScope.id === scope.agent_id);
      return record.disclosurePolicy === 'referenceable'
        && record.sensitivity !== 'secret'
        && record.sensitivity !== 'regulated'
        && scopeMatches
        && (!record.validFrom || record.validFrom <= now)
        && (!record.validTo || record.validTo >= now)
        && (record.authority === 'user_explicit' || record.confidence >= 0.7);
    }).slice(0, 20);
    return {
      content: {
        records: records.map((record) => ({
          evidenceId: `assertion:${record.id}`,
          kind: record.kind,
          content: boundedText(record.statement, 1_000),
          confidence: record.confidence,
          recordedAt: record.recordedAt,
        })),
      },
      evidenceIds: records.map((record) => `assertion:${record.id}`),
    };
  }
}

export class MeetingWorkspaceContextProvider implements ContextProvider {
  readonly id = 'meeting_workspace';

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
    const taskMatches = terms.map(() => `LOWER(COALESCE(tasks.title, '') || ' '
      || COALESCE(tasks.body, '')) LIKE ?`).join(' OR ');
    const tasks = db.prepare(`SELECT tasks.task_id, tasks.title, tasks.body,
      tasks.phase, tasks.resolution, tasks.priority, tasks.due_at,
      tasks.updated_at, tasks.project_id
      FROM tasks
      WHERE tasks.phase <> 'closed'
      AND COALESCE(tasks.delegate_agent_id, ?) = ? AND (${taskMatches})
      ORDER BY tasks.updated_at DESC LIMIT 10`)
      .all(scope.agent_id ?? 'main', scope.agent_id ?? 'main', ...terms.map((term) => `%${term}%`)) as Array<Record<string, unknown>>;
    const noteMatches = terms.map(() => `LOWER(COALESCE(title, '') || ' ' || COALESCE(snippet, '')) LIKE ?`).join(' OR ');
    const notes = db.prepare(`SELECT note_id, title, kind, status, snippet, tags_json, task_due_at,
      unchecked_task_count, updated_at FROM notes WHERE status NOT IN ('archived', 'trashed')
      AND (${noteMatches}) ORDER BY updated_at DESC LIMIT 10`)
      .all(...terms.map((term) => `%${term}%`)) as Array<Record<string, unknown>>;
    const taskEvidenceIds = tasks.map((task) => `task:${String(task.task_id)}`);
    const noteEvidenceIds = notes.map((note) => `note:${String(note.note_id)}`);
    return {
      content: {
        activeTasks: tasks.map((task, index) => ({ evidenceId: taskEvidenceIds[index], ...task })),
        recentNotes: notes.map((note, index) => ({
          evidenceId: noteEvidenceIds[index],
          ...note,
          snippet: boundedText(note.snippet, 1_500),
        })),
      },
      evidenceIds: [...taskEvidenceIds, ...noteEvidenceIds],
    };
  }
}

export class ProjectStateContextProvider implements ContextProvider {
  readonly id = 'project_state';

  async collect(input: ContextInput): Promise<ResolvedContext> {
    if (!input.eventIds.length) return emptyContext();
    const project = getSqliteDatabase().prepare(`SELECT p.* FROM proactive_events e JOIN projects p ON p.project_id = e.project_id
      WHERE e.event_id IN (${input.eventIds.map(() => '?').join(',')}) AND e.project_id IS NOT NULL ORDER BY e.occurred_at DESC LIMIT 1`)
      .get(...input.eventIds) as Record<string, unknown> | undefined;
    if (!project) return emptyContext();
    const tasks = getSqliteDatabase().prepare(`SELECT task.task_id, task.title, task.body,
      task.phase, task.resolution, task.priority, task.due_at, task.updated_at,
      (SELECT wait.kind FROM task_waits wait
        WHERE wait.task_id = task.task_id AND wait.status = 'active'
        ORDER BY wait.created_at DESC LIMIT 1) AS wait_kind,
      (SELECT wait.reason FROM task_waits wait
        WHERE wait.task_id = task.task_id AND wait.status = 'active'
        ORDER BY wait.created_at DESC LIMIT 1) AS wait_reason,
      (SELECT json_group_array(json_object(
        'taskId', dependency.depends_on_task_id,
        'title', upstream.title,
        'phase', upstream.phase,
        'resolution', upstream.resolution
      )) FROM task_dependencies dependency
        JOIN tasks upstream ON upstream.task_id = dependency.depends_on_task_id
        WHERE dependency.task_id = task.task_id) AS dependencies_json
      FROM tasks task
      WHERE task.project_id = ? AND task.phase <> 'closed'
      ORDER BY CASE WHEN EXISTS (
        SELECT 1 FROM task_waits wait WHERE wait.task_id = task.task_id AND wait.status = 'active'
      ) THEN 0 ELSE 1 END,
        task.updated_at DESC LIMIT 100`).all(String(project.project_id));
    const projectEvidenceId = `project:${String(project.project_id)}`;
    const taskEvidenceIds = (tasks as Array<Record<string, unknown>>)
      .map((task) => `task:${String(task.task_id)}`);
    return {
      content: {
        project: { evidenceId: projectEvidenceId, ...project },
        activeTasks: (tasks as Array<Record<string, unknown>>).map((task, index) => {
          const { dependencies_json: dependenciesJson, ...fields } = task;
          return {
            evidenceId: taskEvidenceIds[index],
            ...fields,
            dependencies: dependenciesJson ? JSON.parse(String(dependenciesJson)) : [],
          };
        }),
      },
      evidenceIds: [projectEvidenceId, ...taskEvidenceIds],
    };
  }
}

export class AutomationStateContextProvider implements ContextProvider {
  readonly id = 'automation_state';

  async collect(input: ContextInput): Promise<ResolvedContext> {
    if (!input.eventIds.length) return emptyContext();
    const run = getSqliteDatabase().prepare(`SELECT r.* FROM proactive_events e JOIN automation_runs r ON r.run_id = e.subject_id
      WHERE e.event_id IN (${input.eventIds.map(() => '?').join(',')}) ORDER BY e.occurred_at DESC LIMIT 1`)
      .get(...input.eventIds) as Record<string, unknown> | undefined;
    if (!run) return emptyContext();
    const automation = getSqliteDatabase().prepare(`SELECT automation_id, name, description, enabled, reliability_json, state_json, project_id
      FROM automations WHERE automation_id = ?`).get(String(run.automation_id));
    const recentRuns = getSqliteDatabase().prepare(`SELECT run_id, status, summary, error, duration_ms, started_at, ended_at
      FROM automation_runs WHERE automation_id = ? AND run_id <> ?
      ORDER BY started_at DESC LIMIT 5`).all(String(run.automation_id), String(run.run_id));
    const runEvidenceId = `automation-run:${String(run.run_id)}`;
    return {
      content: { automation, failedRun: { evidenceId: runEvidenceId, ...run }, recentRuns },
      evidenceIds: [runEvidenceId],
    };
  }
}

export class DiscussionContextProvider implements ContextProvider {
  readonly id = 'discussion';

  async collect(input: ContextInput): Promise<ResolvedContext> {
    const event = eventRows(input.eventIds)
      .findLast((row) => row.subject_kind === 'discussion');
    if (!event) return emptyContext();
    const discussion = getDiscussionCapture(event.subject_id);
    if (!discussion || discussion.status !== 'completed') return emptyContext();
    const organization = getLatestDiscussionOrganization(discussion.id);
    const discussionEvidenceId = `discussion:${discussion.id}`;
    const noteEvidenceId = `note:${discussion.noteId}`;
    return {
      content: {
        discussion: {
          evidenceId: discussionEvidenceId,
          id: discussion.id,
          noteId: discussion.noteId,
          noteEvidenceId,
          projectId: discussion.projectId,
          title: discussion.generatedTitle,
          transcript: boundedText(discussion.canonicalTranscript, 6_000),
          organization: organization?.organization,
          completedAt: discussion.completedAt,
        },
      },
      snapshotContent: {
        discussion: {
          evidenceId: discussionEvidenceId,
          id: discussion.id,
          noteId: discussion.noteId,
          noteEvidenceId,
          projectId: discussion.projectId,
          transcriptSha256: discussion.canonicalTranscriptSha256,
          organizationRevision: organization?.revision,
          organization: organization?.organization,
          completedAt: discussion.completedAt,
        },
      },
      evidenceIds: [discussionEvidenceId, noteEvidenceId],
    };
  }
}

export class ContextProviderRegistry {
  constructor(private readonly providers: ContextProvider[] = [
    new EventBatchContextProvider(),
    new ConnectedSourceContextProvider(),
    new InternalObjectContextProvider(),
    new UserModelContextProvider(),
    new MeetingWorkspaceContextProvider(),
    new ProjectStateContextProvider(),
    new AutomationStateContextProvider(),
    new DiscussionContextProvider(),
  ]) {}

  async collect(
    scenario: ScenarioDefinition,
    input: { batchId: string; eventIds: string[]; subscriptionId: string },
  ): Promise<ResolvedContext> {
    const providers = new Map(this.providers.map((provider) => [provider.id, provider]));
    const selected = scenario.contextProviderIds.map((id) => {
      const provider = providers.get(id);
      if (!provider) throw new Error(`Unknown context provider: ${id}`);
      return provider;
    });
    const entries = await Promise.all(selected
      .map(async (provider) => [provider.id, await provider.collect({ ...input, scenarioKey: scenario.key })] as const));
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
