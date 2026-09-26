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
  ['scenes', 'scene.created', 'scene', 'A Scene was created.'],
  ['scenes', 'scene.changed', 'scene', 'A Scene changed.'],
  ['scenes', 'scene.deleted', 'scene', 'A Scene was deleted.'],
  ['discussions', 'discussion.completed', 'discussion', 'A Discussion completed.'],
  ['sessions', 'session.transcript.updated', 'session', 'A Session transcript changed.'],
  ['workflows', 'workflow.run.completed', 'workflow_run', 'A Workflow run completed.'],
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
