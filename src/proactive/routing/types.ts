import type { EventEnvelope } from '../events/types.js';

export type EventField =
  | `envelope.${'type' | 'source.kind' | 'subject.kind' | 'actor.kind' | 'scope.workspaceId' | 'scope.projectId' | 'scope.agentId' | 'sensitivity'}`
  | `payload.${string}`;

export type Scalar = string | number | boolean | null;

export type EventCondition =
  | { op: 'eq' | 'neq' | 'gt' | 'gte' | 'lt' | 'lte'; field: EventField; value: Scalar }
  | { op: 'in'; field: EventField; values: Scalar[] }
  | { op: 'changed'; field: `payload.${string}` }
  | { op: 'all'; conditions: EventCondition[] }
  | { op: 'any'; conditions: EventCondition[] }
  | { op: 'not'; condition: EventCondition };

export interface ScenarioRoute {
  subscriptionId?: string;
  key: string;
  version: number;
  enabled: boolean;
  eventTypes: string[];
  condition?: EventCondition;
  aggregation: 'subject' | 'project' | 'workspace';
  debounceSeconds: number;
  maxWindowSeconds: number;
  scope?: { workspaceId: string; projectId?: string };
}

export interface RoutedEvent {
  event: EventEnvelope;
  scenario: ScenarioRoute;
  aggregationKey: string;
}
