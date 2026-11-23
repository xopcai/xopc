import { z, type ZodType } from 'zod';

import type { AutomationEventEnvelope } from '../domain/types.js';

export interface BusinessEventDefinition<TPayload extends Record<string, unknown> = Record<string, unknown>> {
  type: string;
  source: string;
  schemaVersion: number;
  payloadSchema: ZodType<TPayload>;
  defaultTrust: Extract<AutomationEventEnvelope['trust'], 'system' | 'user' | 'connector'>;
  description: string;
  subjectKind: string;
}

const definitions = new Map<string, BusinessEventDefinition>();

function catalogKey(type: string, source: string, schemaVersion: number): string {
  return `${source}\0${type}\0${schemaVersion}`;
}

export function registerBusinessEvent<TPayload extends Record<string, unknown>>(
  definition: BusinessEventDefinition<TPayload>,
): void {
  const key = catalogKey(definition.type, definition.source, definition.schemaVersion);
  if (definitions.has(key)) {
    throw new Error(`Business event is already registered: ${definition.source}/${definition.type}@${definition.schemaVersion}`);
  }
  definitions.set(key, definition as BusinessEventDefinition);
}

export function validateCatalogedBusinessEvent(event: AutomationEventEnvelope): void {
  const definition = definitions.get(catalogKey(event.type, event.source, event.schemaVersion));
  if (!definition) return;
  if (event.subject?.kind !== definition.subjectKind) {
    throw new Error(`Business event subject must be ${definition.subjectKind}: ${event.type}`);
  }
  definition.payloadSchema.parse(event.payload);
}

export function listBusinessEventDefinitions(): BusinessEventDefinition[] {
  return [...definitions.values()].toSorted((left, right) =>
    `${left.source}/${left.type}`.localeCompare(`${right.source}/${right.type}`));
}

const objectPayload = z.record(z.string(), z.unknown());

for (const definition of [
  ['tasks', 'task.changed.v2', 'task', 'A Task changed.'],
  ['tasks', 'task.deleted.v1', 'task', 'A Task was deleted.'],
  ['notes', 'note.created', 'note', 'A Note was created.'],
  ['notes', 'note.updated', 'note', 'A Note changed.'],
  ['notes', 'note.deleted', 'note', 'A Note was deleted.'],
  ['projects', 'project.created', 'project', 'A Project was created.'],
  ['projects', 'project.changed', 'project', 'A Project changed.'],
  ['projects', 'project.deleted', 'project', 'A Project was deleted.'],
  ['discussions', 'discussion.completed', 'discussion', 'A Discussion completed.'],
  ['sessions', 'session.transcript.updated', 'session', 'A Session transcript changed.'],
  ['local:folder', 'local.folder.batch_changed', 'folder', 'Authorized local folder files changed.'],
  ['local:git', 'local.git.repo_state_changed', 'repository', 'Bound Git repository workspace state changed.'],
  ['endpoint:desktop', 'endpoint.desktop.context_shift', 'device', 'Authorized desktop context shifted.'],
  ['endpoint:desktop', 'endpoint.desktop.idle_window', 'device', 'Desktop entered an idle window suitable for background work.'],
  ['endpoint:browser', 'endpoint.browser.saved_item', 'bookmark', 'User saved or shared a browser resource.'],
  ['temporal:calendar', 'temporal.meeting.upcoming', 'meeting', 'An authorized calendar event is approaching.'],
  ['temporal:pulse', 'temporal.pulse.window', 'digest', 'A scheduled morning or evening Pulse digest window opened.'],
] as const) {
  registerBusinessEvent({
    source: definition[0],
    type: definition[1],
    subjectKind: definition[2],
    description: definition[3],
    schemaVersion: 1,
    payloadSchema: objectPayload,
    defaultTrust: 'system',
  });
}

for (const definition of [
  ['composio:gmail', 'connector.mail.received', 'mail_thread', 'An inbound email arrived on a connected mailbox.'],
  ['composio:googlecalendar', 'connector.calendar.changed', 'calendar_event', 'A connected calendar event was created or updated.'],
  ['composio:github', 'connector.github.pr_review_requested', 'pull_request', 'A pull request review was requested.'],
  ['composio:github', 'connector.github.ci_failed', 'pull_request', 'A continuous integration check failed on a pull request or branch.'],
  ['composio:linear', 'connector.linear.issue_assigned', 'issue', 'A Linear issue was assigned or updated.'],
] as const) {
  registerBusinessEvent({
    source: definition[0],
    type: definition[1],
    subjectKind: definition[2],
    description: definition[3],
    schemaVersion: 1,
    payloadSchema: objectPayload,
    defaultTrust: 'connector',
  });
}
