import type { AutomationEvent } from '../../automations/domain/types.js';

import type { PublishEventInput } from './types.js';

const SUPPORTED_EVENT_TYPES = new Set([
  'goal.created',
  'goal.status_changed',
  'note.created',
  'note.updated',
  'workflow.run.completed',
  'session.transcript.updated',
  'discussion.completed',
]);

function stringValue(payload: Record<string, unknown>, key: string): string | undefined {
  const value = payload[key];
  return typeof value === 'string' && value.trim() ? value : undefined;
}

function subjectFor(event: AutomationEvent): { kind: string; id: string } | null {
  const payload = event.payload ?? {};
  if (event.type.startsWith('goal.')) {
    const id = stringValue(payload, 'goalId');
    return id ? { kind: 'goal', id } : null;
  }
  if (event.type.startsWith('note.')) {
    const id = stringValue(payload, 'noteId');
    return id ? { kind: 'note', id } : null;
  }
  if (event.type === 'workflow.run.completed') {
    const id = stringValue(payload, 'runId');
    return id ? { kind: 'workflow_run', id } : null;
  }
  if (event.type === 'session.transcript.updated') {
    const id = stringValue(payload, 'sessionKey');
    return id ? { kind: 'session', id } : null;
  }
  if (event.type === 'discussion.completed') {
    const id = stringValue(payload, 'discussionId');
    return id ? { kind: 'discussion', id } : null;
  }
  return null;
}

export function mapProductEventToProactive(input: {
  event: AutomationEvent;
  workspaceId: string;
  defaultAgentId: string;
}): PublishEventInput | null {
  if (!SUPPORTED_EVENT_TYPES.has(input.event.type)) return null;
  const subject = subjectFor(input.event);
  if (!subject) return null;
  const payload = input.event.payload ?? {};
  const occurredAtMs = Number.isFinite(input.event.occurredAtMs)
    ? input.event.occurredAtMs!
    : Date.now();
  const versionId = stringValue(payload, 'messageId')
    ?? stringValue(payload, 'runId')
    ?? String(occurredAtMs);
  const agentId = stringValue(payload, 'agentId') ?? input.defaultAgentId;
  const projectId = stringValue(payload, 'projectId');
  return {
    type: `${input.event.type}.v1`,
    schemaVersion: 1,
    source: { kind: 'internal', id: input.event.source ?? 'xopc' },
    subject,
    actor: { kind: 'system' },
    scope: {
      workspaceId: input.workspaceId,
      agentId,
      ...(projectId ? { projectId } : {}),
    },
    occurredAt: new Date(occurredAtMs).toISOString(),
    dedupeKey: `product-event:${input.event.type}:${subject.id}:${versionId}`,
    sensitivity: 'personal',
    payload,
  };
}
