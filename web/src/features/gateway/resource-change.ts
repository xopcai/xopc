import { ResourceChangedSchema, type ResourceChanged } from '@xopcai/gateway-contract';

/** Events invalidate cached reads; they never replace newer resource state. */
export function createResourceChangeConsumer(notify: (change: ResourceChanged) => void) {
  const seen = new Set<string>();
  return (topic: string, data: unknown) => {
    const parsed = ResourceChangedSchema.safeParse(data);
    if (!parsed.success) return;
    const change = parsed.data;
    if (topic !== `resources:${change.kind}s` || seen.has(change.eventId)) return;
    seen.add(change.eventId);
    if (seen.size > 1024) seen.delete(seen.values().next().value!);
    notify(change);
  };
}

export function isResourceCacheKey(key: unknown, kind: 'note' | 'task' | 'project'): boolean {
  const tag = Array.isArray(key) ? key[0] : key;
  return typeof tag === 'string' && (tag === kind || tag.startsWith(`${kind}-`) || tag.startsWith(`${kind}s`));
}
