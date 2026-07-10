import { isXopcDatabaseOpen } from '../storage/sqlite/index.js';
import { createLogger } from '../utils/logger.js';
import { currentActivityActor, currentActivityInitiator, currentActivitySource } from './context.js';
import { ActivityService } from './service.js';
import type { ActivityPrincipal, ActivitySource, RecordActivityInput } from './types.js';

const log = createLogger('ActivityEmitter');

const activityService = new ActivityService();

export function systemActivityActor(): ActivityPrincipal {
  return currentActivityActor({ kind: 'system' });
}

export function systemActivitySource(): ActivitySource {
  return currentActivitySource({ kind: 'system' });
}

export function previewText(value: string | undefined, maxLength = 180): string | undefined {
  const normalized = value?.trim().replace(/\s+/g, ' ');
  if (!normalized) return undefined;
  return normalized.length > maxLength ? `${normalized.slice(0, maxLength)}...` : normalized;
}

export function changedFieldsFromPatch(
  patch: Record<string, unknown>,
  ignoredKeys: readonly string[] = [],
): string[] {
  const ignored = new Set(ignoredKeys);
  return Object.keys(patch).filter((key) => !ignored.has(key) && patch[key] !== undefined).sort();
}

export function emitActivity(input: RecordActivityInput): void {
  if (!isXopcDatabaseOpen()) {
    log.debug({ type: input.type, object: input.primaryObject }, 'Skipped activity event because SQLite is not open');
    return;
  }
  activityService.record({
    ...input,
    initiator: input.initiator ?? currentActivityInitiator(),
    source: currentActivitySource(input.source),
  });
}
