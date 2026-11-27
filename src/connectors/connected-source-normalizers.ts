import type { KnowledgeSynthesisStatus } from '../knowledge/types.js';

export type ConnectedSourceEntity = {
  externalId: string;
  itemType: string;
  occurredAt?: string;
  sourceUpdatedAt?: string;
  deletedAt?: string;
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

const MAX_EMAIL_CONTENT_CHARS = 24_000;

function gmailHeaders(message: JsonRecord): Map<string, string> {
  const messagePayload = record(message.payload);
  const values = Array.isArray(messagePayload?.headers) ? messagePayload.headers : [];
  const headers = new Map<string, string>();
  for (const value of values) {
    const header = record(value);
    const name = text(header, 'name')?.toLowerCase();
    const headerValue = text(header, 'value');
    if (name && headerValue) headers.set(name, headerValue);
  }
  return headers;
}

function decodeGmailBody(value: unknown): string | undefined {
  if (typeof value !== 'string' || !value.trim() || value.length > 256_000) return undefined;
  try {
    const decoded = Buffer.from(value.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8').trim();
    return decoded || undefined;
  } catch {
    return undefined;
  }
}

function stripHtml(value: string): string {
  return value
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/\s+/g, ' ')
    .trim();
}

function gmailContent(message: JsonRecord): string | undefined {
  const direct = text(message, 'plainText', 'plain_text', 'text', 'content', 'body');
  if (direct) return direct.slice(0, MAX_EMAIL_CONTENT_CHARS);
  const plain: string[] = [];
  const html: string[] = [];
  const visit = (value: unknown, depth = 0): void => {
    if (depth > 10 || plain.join('').length >= MAX_EMAIL_CONTENT_CHARS) return;
    const part = record(value);
    if (!part) return;
    const mimeType = text(part, 'mimeType', 'mime_type')?.toLowerCase();
    const body = record(part.body);
    const decoded = decodeGmailBody(body?.data);
    if (decoded) {
      if (mimeType === 'text/html') html.push(stripHtml(decoded));
      else if (!mimeType || mimeType === 'text/plain') plain.push(decoded);
    }
    if (Array.isArray(part.parts)) {
      for (const nested of part.parts) visit(nested, depth + 1);
    }
  };
  visit(message.payload);
  const content = (plain.length ? plain : html).filter(Boolean).join('\n\n').trim();
  return content ? content.slice(0, MAX_EMAIL_CONTENT_CHARS) : undefined;
}

const AUTOMATED_SENDER_RE = /(?:^|[<.\s_-])(no-?reply|donotreply|do-not-reply|mailer-daemon|notifications?|newsletter|updates?|digest|alerts?|bounces?|automated)@/i;

function stringNames(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const names = value.flatMap((entry) => {
    if (typeof entry === 'string' && entry.trim()) return [entry.trim()];
    const row = record(entry);
    const label = text(row, 'name', 'title', 'label');
    return label ? [label] : [];
  });
  return names.length ? [...new Set(names)].slice(0, 20) : undefined;
}

function normalizeGmail(result: unknown): ConnectedSourceEntity[] {
  return rows(payload(result), 'messages').flatMap((message) => {
    const externalId = text(message, 'id', 'messageId', 'message_id');
    if (!externalId) return [];
    const occurredAt = time(message.internalDate ?? message.internal_date ?? message.date ?? message.timestamp);
    const headers = gmailHeaders(message);
    const sender = message.sender ?? message.from ?? headers.get('from');
    const senderText = typeof sender === 'string' ? sender : text(record(sender), 'email', 'name') ?? '';
    const rawLabels = message.labelIds ?? message.label_ids ?? message.labels;
    const labels = Array.isArray(rawLabels) ? rawLabels.filter((entry): entry is string => typeof entry === 'string') : [];
    const isSent = labels.some((label) => label.toUpperCase() === 'SENT');
    const autoSubmitted = headers.get('auto-submitted')?.toLowerCase();
    const automated = !isSent && (
      Boolean(headers.get('list-unsubscribe'))
      || Boolean(autoSubmitted && autoSubmitted !== 'no')
      || AUTOMATED_SENDER_RE.test(senderText)
    );
    return [{
      externalId,
      itemType: 'email',
      occurredAt,
      sourceUpdatedAt: occurredAt,
      value: compact({
        id: externalId,
        threadId: text(message, 'threadId', 'thread_id'),
        subject: text(message, 'subject') ?? headers.get('subject'),
        sender,
        recipients: message.recipients ?? message.to ?? headers.get('to'),
        date: occurredAt,
        labels: rawLabels,
        snippet: text(message, 'snippet', 'preview'),
        content: gmailContent(message),
      }),
      metadata: {
        observationKind: 'message',
        logicalEventKey: `gmail:message:${externalId}`,
        ...(isSent ? { isSent: true } : {}),
        ...(automated ? { automated: true } : {}),
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
    const sourceUpdatedAt = time(event.updated ?? event.updatedAt ?? event.updated_at);
    const organizer = record(event.organizer);
    const creator = record(event.creator);
    const attendees = Array.isArray(event.attendees)
      ? event.attendees.map(record).filter((entry): entry is JsonRecord => Boolean(entry))
      : [];
    const selfAttendee = attendees.find((attendee) => attendee.self === true);
    const selfResponseStatus = text(selfAttendee, 'responseStatus', 'response_status');
    const declined = selfResponseStatus === 'declined';
    const organizerSelf = organizer?.self === true;
    const creatorSelf = creator?.self === true;
    const selfEmail = (organizerSelf ? text(organizer, 'email') : undefined)
      ?? (creatorSelf ? text(creator, 'email') : undefined)
      ?? (selfAttendee ? text(selfAttendee, 'email') : undefined);
    const eventType = text(event, 'eventType', 'event_type');
    const organizerEmail = text(organizer, 'email')?.toLowerCase() ?? '';
    const automated = eventType === 'birthday'
      || organizerEmail.endsWith('@holiday.calendar.google.com')
      || organizerEmail.endsWith('@group.v.calendar.google.com');
    const actorAttributed = !declined && !automated && (organizerSelf || creatorSelf || Boolean(selfAttendee));
    return [{
      externalId,
      itemType: 'calendar_event',
      occurredAt,
      sourceUpdatedAt,
      ...(event.status === 'cancelled' ? { deletedAt: sourceUpdatedAt ?? new Date().toISOString() } : {}),
      value: compact({
        id: externalId,
        title: text(event, 'summary', 'title', 'name'),
        description: text(event, 'description'),
        location: text(event, 'location'),
        allDay: Boolean(event.start && typeof event.start === 'object' && 'date' in event.start),
        start: occurredAt,
        end: time(event.end ?? event.endTime ?? event.end_time),
        organizer: event.organizer,
        creator: event.creator,
        attendees: event.attendees,
        status: event.status,
        eventType,
        recurrence: event.recurrence,
        recurringEventId: text(event, 'recurringEventId', 'recurring_event_id'),
        selfResponseStatus,
      }),
      metadata: {
        observationKind: 'calendar_event',
        logicalEventKey: `googlecalendar:event:${externalId}`,
        ...(actorAttributed ? { actorAttributed: true } : {}),
        ...(declined ? { declined: true } : {}),
        ...(automated ? { automated: true } : {}),
        ...(selfEmail ? { selfEmail } : {}),
        ...(selfResponseStatus ? { selfResponseStatus } : {}),
      },
      synthesisStatus: 'pending' as const,
    }];
  });
}

function normalizeGoogleDrive(result: unknown): ConnectedSourceEntity[] {
  return rows(payload(result), 'files', 'items').flatMap((file) => {
    const externalId = text(file, 'id', 'fileId', 'file_id');
    const name = text(file, 'name', 'title');
    if (!externalId || !name || file.trashed === true) return [];
    const modifiedAt = time(file.modifiedTime ?? file.modified_time ?? file.modifiedDate);
    return [{
      externalId,
      itemType: 'cloud_document',
      occurredAt: modifiedAt ?? time(file.createdTime ?? file.created_time ?? file.createdDate),
      sourceUpdatedAt: modifiedAt,
      value: compact({
        id: externalId,
        title: name,
        description: text(file, 'description')?.slice(0, 600),
        mimeType: text(file, 'mimeType', 'mime_type'),
        modifiedAt,
        owners: file.owners,
        webViewLink: text(file, 'webViewLink', 'web_view_link'),
      }),
      metadata: {
        observationKind: 'document_metadata',
        logicalEventKey: `googledrive:file:${externalId}`,
        mimeType: text(file, 'mimeType', 'mime_type'),
      },
      synthesisStatus: 'ignored' as const,
    }];
  });
}

function repositoryName(row: JsonRecord): string | undefined {
  const repository = record(row.repository) ?? record(row.repo);
  const explicit = text(repository, 'full_name', 'name') ?? text(row, 'repository_full_name', 'full_name', 'repo');
  if (explicit) return explicit;
  const url = text(row, 'repository_url', 'html_url');
  const match = url?.match(/(?:repos\/|github\.com\/)([^/]+\/[^/#]+)(?:\/|$)/);
  return match?.[1];
}

function normalizeGitHub(result: unknown, actionId: string): ConnectedSourceEntity[] {
  const data = payload(result);
  if (actionId === 'GITHUB_LIST_REPOSITORIES_FOR_THE_AUTHENTICATED_USER') {
    return rows(data, 'repositories').flatMap((repository) => {
      const externalId = text(repository, 'id', 'node_id', 'full_name');
      const fullName = text(repository, 'full_name');
      if (!externalId || !fullName) return [];
      const ownerLogin = text(record(repository.owner), 'login') ?? fullName.split('/', 1)[0];
      return [{
        externalId,
        itemType: 'repository',
        occurredAt: time(repository.pushed_at ?? repository.updated_at ?? repository.created_at),
        sourceUpdatedAt: time(repository.updated_at),
        value: compact({
          id: externalId,
          fullName,
          owner: ownerLogin,
          description: text(repository, 'description'),
          visibility: repository.visibility,
          language: repository.language,
          topics: stringNames(repository.topics),
          fork: Boolean(repository.fork),
          archived: repository.archived,
          pushedAt: time(repository.pushed_at),
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
    const rawId = text(activity, 'id', 'node_id', 'sha', 'number');
    if (!rawId) return [];
    const subjectKey = repositoryName(activity);
    const externalId = subjectKey ? `${subjectKey}:${rawId}` : rawId;
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
        body: text(activity, 'body')?.slice(0, 1_500),
        labels: stringNames(activity.labels),
        isPullRequest: Boolean(activity.pull_request),
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

function normalizeExternalTasks(result: unknown, toolkit: string): ConnectedSourceEntity[] {
  return rows(payload(result), 'issues', 'items', 'results').flatMap((item) => {
    const externalId = text(item, 'id', 'identifier', 'key');
    if (!externalId) return [];
    const occurredAt = time(item.createdAt ?? item.created_at);
    const cycle = text(record(item.cycle), 'name') ?? text(item, 'cycle');
    const labels = stringNames(record(item.labels)?.nodes ?? item.labels);
    return [{
      externalId,
      itemType: 'external_task',
      occurredAt,
      sourceUpdatedAt: time(item.updatedAt ?? item.updated_at) ?? occurredAt,
      value: compact({
        id: externalId,
        title: text(item, 'title', 'summary', 'name'),
        description: text(item, 'description')?.slice(0, 1_500),
        project: item.project ?? item.team,
        assignee: item.assignee,
        creator: item.creator ?? item.reporter,
        state: item.state ?? item.status,
        priority: item.priorityLabel ?? item.priority,
        labels,
        cycle,
        dueDate: time(item.dueDate ?? item.due_date),
      }),
      metadata: {
        observationKind: 'external_task',
        logicalEventKey: `${toolkit}:task:${externalId}`,
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
  if (input.toolkit === 'googledrive') return normalizeGoogleDrive(input.result);
  if (input.toolkit === 'github') return normalizeGitHub(input.result, input.actionId);
  if (input.toolkit === 'linear') {
    return normalizeExternalTasks(input.result, input.toolkit);
  }
  return [];
}
