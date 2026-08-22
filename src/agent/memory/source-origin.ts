import type { MemoryRecord } from './types.js';

export type MemoryContextOrigin = 'told_by_user' | 'observed' | 'inferred' | 'connected_source';

const INTERNAL_MEMORY_PROVIDERS = new Set([
  'local',
  'builtin',
  'workflow-run',
]);

export function classifyMemoryContextOrigin(record: MemoryRecord): MemoryContextOrigin {
  const provider = record.source.provider?.trim().toLowerCase();
  if (provider && !INTERNAL_MEMORY_PROVIDERS.has(provider)) return 'connected_source';
  if (record.explicitness === 'explicit') return 'told_by_user';
  if (record.explicitness === 'observed') return 'observed';
  return 'inferred';
}
