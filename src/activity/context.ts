import { AsyncLocalStorage } from 'node:async_hooks';

import { getAsyncLogContext } from '../utils/logger/context.js';
import type { ActivityPrincipal, ActivitySource } from './types.js';

export interface ActivityContext {
  actor?: ActivityPrincipal;
  initiator?: ActivityPrincipal;
  source?: ActivitySource;
}

const activityContextStorage = new AsyncLocalStorage<ActivityContext>();

export function runWithActivityContext<T>(context: ActivityContext, fn: () => T): T {
  const parent = activityContextStorage.getStore();
  return activityContextStorage.run({ ...parent, ...context }, fn);
}

export function getActivityContext(): ActivityContext | undefined {
  return activityContextStorage.getStore();
}

export function currentActivityActor(fallback: ActivityPrincipal = { kind: 'system' }): ActivityPrincipal {
  return getActivityContext()?.actor ?? fallback;
}

export function currentActivityInitiator(): ActivityPrincipal | undefined {
  return getActivityContext()?.initiator;
}

export function currentActivitySource(fallback: ActivitySource = { kind: 'system' }): ActivitySource {
  const source = getActivityContext()?.source ?? fallback;
  const requestId = source.requestId ?? stringValue(getAsyncLogContext()?.requestId);
  return requestId ? { ...source, requestId } : source;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}
