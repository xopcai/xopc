import { randomUUID } from 'node:crypto';

import {
  EVENT_ACTOR_KINDS,
  EVENT_SENSITIVITIES,
  type EventEnvelope,
  type PublishEventInput,
} from './types.js';

const EVENT_TYPE_PATTERN = /^[a-z][a-z0-9_]*(?:\.[a-z][a-z0-9_]*)+\.v[1-9][0-9]*$/;

function required(value: string, field: string): string {
  const normalized = value.trim();
  if (!normalized) throw new Error(`${field} is required`);
  if (normalized.length > 300) throw new Error(`${field} is too long`);
  return normalized;
}

function timestamp(value: string, field: string): string {
  const time = Date.parse(value);
  if (!Number.isFinite(time)) throw new Error(`${field} must be an ISO timestamp`);
  return new Date(time).toISOString();
}

export function normalizeEventEnvelope(input: PublishEventInput, now = new Date()): EventEnvelope {
  if (!EVENT_TYPE_PATTERN.test(input.type)) {
    throw new Error('type must use the domain.event.vN convention');
  }
  if (!Number.isInteger(input.schemaVersion) || input.schemaVersion < 1) {
    throw new Error('schemaVersion must be a positive integer');
  }
  if (!EVENT_ACTOR_KINDS.includes(input.actor.kind)) throw new Error('actor.kind is invalid');
  if (!EVENT_SENSITIVITIES.includes(input.sensitivity)) throw new Error('sensitivity is invalid');
  if (!input.payload || Array.isArray(input.payload) || typeof input.payload !== 'object') {
    throw new Error('payload must be an object');
  }

  return {
    id: required(input.id ?? randomUUID(), 'id'),
    type: input.type,
    schemaVersion: input.schemaVersion,
    source: {
      kind: required(input.source.kind, 'source.kind'),
      id: required(input.source.id, 'source.id'),
      ...(input.source.deviceId ? { deviceId: required(input.source.deviceId, 'source.deviceId') } : {}),
    },
    subject: {
      kind: required(input.subject.kind, 'subject.kind'),
      id: required(input.subject.id, 'subject.id'),
    },
    actor: {
      kind: input.actor.kind,
      ...(input.actor.id ? { id: required(input.actor.id, 'actor.id') } : {}),
    },
    scope: {
      workspaceId: required(input.scope.workspaceId, 'scope.workspaceId'),
      ...(input.scope.projectId ? { projectId: required(input.scope.projectId, 'scope.projectId') } : {}),
      ...(input.scope.agentId ? { agentId: required(input.scope.agentId, 'scope.agentId') } : {}),
    },
    occurredAt: timestamp(input.occurredAt, 'occurredAt'),
    observedAt: timestamp(input.observedAt ?? now.toISOString(), 'observedAt'),
    correlationId: required(input.correlationId ?? randomUUID(), 'correlationId'),
    ...(input.causationId ? { causationId: required(input.causationId, 'causationId') } : {}),
    dedupeKey: required(input.dedupeKey, 'dedupeKey'),
    sensitivity: input.sensitivity,
    payload: input.payload,
  };
}
