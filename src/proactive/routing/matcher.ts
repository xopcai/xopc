import type { EventEnvelope } from '../events/types.js';
import type { EventCondition, EventField, Scalar, ScenarioRoute } from './types.js';

function nestedValue(value: unknown, path: string[]): unknown {
  let current = value;
  for (const segment of path) {
    if (!current || typeof current !== 'object' || Array.isArray(current)) return undefined;
    current = (current as Record<string, unknown>)[segment];
  }
  return current;
}

function fieldValue(event: EventEnvelope, field: EventField): unknown {
  if (field.startsWith('payload.')) return nestedValue(event.payload, field.slice(8).split('.'));
  return nestedValue(event, field.slice(9).split('.'));
}

function compare(left: unknown, right: Scalar, op: 'gt' | 'gte' | 'lt' | 'lte'): boolean {
  if ((typeof left !== 'number' && typeof left !== 'string') || typeof left !== typeof right) return false;
  if (op === 'gt') return left > right!;
  if (op === 'gte') return left >= right!;
  if (op === 'lt') return left < right!;
  return left <= right!;
}

function conditionWithinLimits(condition: EventCondition, depth = 0): boolean {
  if (depth >= 8) return false;
  if (condition.op === 'all' || condition.op === 'any') {
    return condition.conditions.length <= 50
      && condition.conditions.every((item) => conditionWithinLimits(item, depth + 1));
  }
  return condition.op !== 'not' || conditionWithinLimits(condition.condition, depth + 1);
}

function evaluateCondition(event: EventEnvelope, condition: EventCondition): boolean {
  if (condition.op === 'all') return condition.conditions.every((item) => evaluateCondition(event, item));
  if (condition.op === 'any') return condition.conditions.some((item) => evaluateCondition(event, item));
  if (condition.op === 'not') return !evaluateCondition(event, condition.condition);
  if (condition.op === 'changed') {
    const path = condition.field.slice(8).split('.');
    return nestedValue(event.payload, ['before', ...path]) !== nestedValue(event.payload, ['after', ...path]);
  }
  const value = fieldValue(event, condition.field);
  if (condition.op === 'eq') return value === condition.value;
  if (condition.op === 'neq') return value !== condition.value;
  if (condition.op === 'in') return condition.values.includes(value as Scalar);
  return compare(value, condition.value, condition.op);
}

export function matchesCondition(event: EventEnvelope, condition: EventCondition): boolean {
  return conditionWithinLimits(condition) && evaluateCondition(event, condition);
}

export function aggregationKey(event: EventEnvelope, route: ScenarioRoute): string | null {
  if (route.aggregation === 'workspace') return `workspace:${event.scope.workspaceId}`;
  if (route.aggregation === 'project') return event.scope.projectId ? `project:${event.scope.projectId}` : null;
  return `${event.subject.kind}:${event.subject.id}`;
}

export function matchScenario(event: EventEnvelope, route: ScenarioRoute): string | null {
  if (!route.enabled || !route.eventTypes.includes(event.type)) return null;
  if (route.scope?.workspaceId && route.scope.workspaceId !== event.scope.workspaceId) return null;
  if (route.scope?.projectId && route.scope.projectId !== event.scope.projectId) return null;
  if (route.condition && !matchesCondition(event, route.condition)) return null;
  return aggregationKey(event, route);
}
