export const EVENT_SENSITIVITIES = ['public', 'personal', 'confidential', 'restricted'] as const;
export type EventSensitivity = (typeof EVENT_SENSITIVITIES)[number];

export const EVENT_ACTOR_KINDS = ['user', 'agent', 'system', 'integration'] as const;
export type EventActorKind = (typeof EVENT_ACTOR_KINDS)[number];

export interface EventEnvelope<TPayload extends Record<string, unknown> = Record<string, unknown>> {
  id: string;
  type: string;
  schemaVersion: number;
  source: { kind: string; id: string; deviceId?: string };
  subject: { kind: string; id: string };
  actor: { kind: EventActorKind; id?: string };
  scope: { workspaceId: string; projectId?: string; agentId?: string };
  occurredAt: string;
  observedAt: string;
  correlationId: string;
  causationId?: string;
  dedupeKey: string;
  sensitivity: EventSensitivity;
  payload: TPayload;
}

export type PublishEventInput<TPayload extends Record<string, unknown> = Record<string, unknown>> =
  Omit<EventEnvelope<TPayload>, 'id' | 'observedAt' | 'correlationId'> & {
    id?: string;
    observedAt?: string;
    correlationId?: string;
  };

export interface PublishedEvent {
  event: EventEnvelope;
  inserted: boolean;
  batchIds: string[];
}
