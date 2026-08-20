import type { AutomationEvent } from '../../automations/domain/types.js';

import type { PublishEventInput } from './types.js';

const PROACTIVE_EVENT_TYPE_BY_PRODUCT_EVENT = new Map<string, string>([
  ['task.created.v2', 'task.created.v2'],
  ['task.commanded.v2', 'task.commanded.v2'],
  ['task.phase_changed.v2', 'task.phase_changed.v2'],
  ['task.attention_required.v2', 'task.attention_required.v2'],
  ['note.created', 'note.created.v1'],
  ['note.updated', 'note.updated.v1'],
  ['workflow.run.completed', 'workflow.run.completed.v1'],
  ['session.transcript.updated', 'session.transcript.updated.v1'],
  ['discussion.completed', 'discussion.completed.v1'],
]);

function stringValue(payload: Record<string, unknown>, key: string): string | undefined {
  const value = payload[key];
  return typeof value === 'string' && value.trim() ? value : undefined;
}

function subjectFor(event: AutomationEvent): { kind: string; id: string } | null {
  const payload = event.payload ?? {};
  if (event.type.startsWith('task.')) {
    const id = stringValue(payload, 'taskId');
    return id ? { kind: 'task', id } : null;
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
  const proactiveEventType = PROACTIVE_EVENT_TYPE_BY_PRODUCT_EVENT.get(input.event.type);
  if (!proactiveEventType) return null;
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
    type: proactiveEventType,
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
    dedupeKey: `product-event:${proactiveEventType}:${subject.id}:${versionId}`,
    sensitivity: 'personal',
    payload,
  };
}
