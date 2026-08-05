import type { KnowledgeSynthesisStatus } from '../knowledge/types.js';

export type ConnectedSourceEntity = {
  externalId: string;
  itemType: string;
  occurredAt?: string;
  sourceUpdatedAt?: string;
  value: Record<string, unknown>;
  metadata: Record<string, unknown>;
  synthesisStatus: KnowledgeSynthesisStatus;
};

type JsonRecord = Record<string, unknown>;

function record(value: unknown): JsonRecord | undefined {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as JsonRecord : undefined;
}

function text(row: JsonRecord | undefined, ...keys: string[]): string | undefined {
  for (const key of keys) {
    const value = row?.[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
    if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  }
  return undefined;
}

function time(value: unknown): string | undefined {
  const nested = record(value);
  const candidate = typeof value === 'string' || typeof value === 'number'
    ? value
    : text(nested, 'dateTime', 'date', 'time', 'timestamp');
  if (candidate === undefined) return undefined;
  const numeric = typeof candidate === 'number' ? candidate : Number(candidate);
  const parsed = Number.isFinite(numeric) && String(candidate).length >= 10
    ? new Date(numeric < 10_000_000_000 ? numeric * 1_000 : numeric)
    : new Date(String(candidate));
  return Number.isFinite(parsed.getTime()) ? parsed.toISOString() : undefined;
}

function payload(result: unknown): JsonRecord | undefined {
  const envelope = record(result);
  if (!envelope || envelope.error) return undefined;
  return record(envelope.data) ?? envelope;
}

function rows(data: JsonRecord | undefined, ...keys: string[]): JsonRecord[] {
  for (const key of keys) {
    const value = data?.[key];
    if (Array.isArray(value)) return value.map(record).filter((item): item is JsonRecord => Boolean(item));
  }
  return [];
}

function compact(value: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined && item !== null && item !== ''));
}

function normalizeGmail(result: unknown): ConnectedSourceEntity[] {
  return rows(payload(result), 'messages').flatMap((message) => {
    const externalId = text(message, 'id', 'messageId', 'message_id');
    if (!externalId) return [];
    const occurredAt = time(message.internalDate ?? message.internal_date ?? message.date ?? message.timestamp);
    return [{
      externalId,
      itemType: 'email',
      occurredAt,
      sourceUpdatedAt: occurredAt,
      value: compact({
        id: externalId,
        threadId: text(message, 'threadId', 'thread_id'),
        subject: text(message, 'subject'),
        sender: message.sender ?? message.from,
        recipients: message.recipients ?? message.to,
        date: occurredAt,
        labels: message.labelIds ?? message.label_ids ?? message.labels,
        snippet: text(message, 'snippet', 'preview'),
      }),
      metadata: {
        observationKind: 'message',
        logicalEventKey: `gmail:message:${externalId}`,
      },
      synthesisStatus: 'pending' as const,
    }];
  });
}

function normalizeCalendar(result: unknown): ConnectedSourceEntity[] {
  return rows(payload(result), 'items', 'events').flatMap((event) => {
    const externalId = text(event, 'id', 'eventId', 'event_id');
    if (!externalId) return [];
    const occurredAt = time(event.start ?? event.startTime ?? event.start_time);
    return [{
      externalId,
      itemType: 'calendar_event',
      occurredAt,
      sourceUpdatedAt: time(event.updated ?? event.updatedAt ?? event.updated_at),
      value: compact({
        id: externalId,
        title: text(event, 'summary', 'title', 'name'),
        start: occurredAt,
        end: time(event.end ?? event.endTime ?? event.end_time),
        organizer: event.organizer,
        attendees: event.attendees,
        status: event.status,
        recurrence: event.recurrence,
      }),
      metadata: {
        observationKind: 'calendar_event',
        logicalEventKey: `googlecalendar:event:${externalId}`,
      },
      synthesisStatus: 'pending' as const,
    }];
  });
}

function repositoryName(row: JsonRecord): string | undefined {
  const repository = record(row.repository) ?? record(row.repo);
  return text(repository, 'full_name', 'name') ?? text(row, 'repository_full_name', 'full_name', 'repo');
}

function normalizeGitHub(result: unknown, actionId: string): ConnectedSourceEntity[] {
  const data = payload(result);
  if (actionId === 'GITHUB_LIST_REPOSITORIES_FOR_THE_AUTHENTICATED_USER') {
    return rows(data, 'repositories').flatMap((repository) => {
      const externalId = text(repository, 'id', 'node_id', 'full_name');
      const fullName = text(repository, 'full_name');
      if (!externalId || !fullName) return [];
      return [{
        externalId,
        itemType: 'repository',
        occurredAt: time(repository.created_at),
        sourceUpdatedAt: time(repository.updated_at),
        value: compact({
          id: externalId,
          fullName,
          description: text(repository, 'description'),
          visibility: repository.visibility,
          language: repository.language,
          archived: repository.archived,
        }),
        metadata: {
          observationKind: 'inventory',
          logicalEventKey: `github:repository:${externalId}`,
          subjectKey: fullName.toLowerCase(),
          actorAttributed: false,
        },
        synthesisStatus: 'ignored' as const,
      }];
    });
  }

  return rows(data, 'commits', 'pull_requests', 'issues', 'items').flatMap((activity) => {
    const externalId = text(activity, 'id', 'node_id', 'sha', 'number');
    if (!externalId) return [];
    const subjectKey = repositoryName(activity);
    const occurredAt = time(activity.committed_at ?? activity.created_at ?? activity.updated_at);
    return [{
      externalId: `${actionId}:${externalId}`,
      itemType: 'development_activity',
      occurredAt,
      sourceUpdatedAt: time(activity.updated_at) ?? occurredAt,
      value: compact({
        id: externalId,
        repository: subjectKey,
        title: text(activity, 'title', 'message', 'name'),
        author: activity.author ?? activity.user ?? activity.actor,
        state: activity.state,
        occurredAt,
      }),
      metadata: {
        observationKind: 'activity',
        logicalEventKey: `github:${actionId.toLowerCase()}:${externalId}`,
        subjectKey,
      },
      synthesisStatus: 'pending' as const,
    }];
  });
}

function normalizeWorkItems(result: unknown, toolkit: string): ConnectedSourceEntity[] {
  return rows(payload(result), 'issues', 'items', 'results').flatMap((item) => {
    const externalId = text(item, 'id', 'identifier', 'key');
    if (!externalId) return [];
    const occurredAt = time(item.createdAt ?? item.created_at);
    return [{
      externalId,
      itemType: 'work_item',
      occurredAt,
      sourceUpdatedAt: time(item.updatedAt ?? item.updated_at) ?? occurredAt,
      value: compact({
        id: externalId,
        title: text(item, 'title', 'summary', 'name'),
        project: item.project ?? item.team,
        assignee: item.assignee,
        creator: item.creator ?? item.reporter,
        state: item.state ?? item.status,
      }),
      metadata: {
        observationKind: 'work_item',
        logicalEventKey: `${toolkit}:work-item:${externalId}`,
      },
      synthesisStatus: 'pending' as const,
    }];
  });
}

export function normalizeConnectedSourceResult(input: {
  toolkit: string;
  actionId: string;
  result: unknown;
}): ConnectedSourceEntity[] {
  if (input.toolkit === 'gmail') return normalizeGmail(input.result);
  if (input.toolkit === 'googlecalendar') return normalizeCalendar(input.result);
  if (input.toolkit === 'github') return normalizeGitHub(input.result, input.actionId);
  if (input.toolkit === 'linear' || input.toolkit === 'jira') {
    return normalizeWorkItems(input.result, input.toolkit);
  }
  return [];
}
