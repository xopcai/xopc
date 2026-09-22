import { describe, expect, it, vi } from 'vitest';
import { createResourceChangeConsumer, isResourceCacheKey } from './resource-change';

describe('resource cache invalidation', () => {
  it('rejects malformed and cross-topic events and deduplicates event identities', () => {
    const notify = vi.fn();
    const consume = createResourceChangeConsumer(notify);
    const change = { eventId: 'a', kind: 'note', id: 'n', revision: 3, operation: 'updated' };
    consume('resources:tasks', change);
    consume('resources:notes', { ...change, revision: -1 });
    consume('resources:notes', change);
    consume('resources:notes', change);
    consume('resources:notes', { ...change, eventId: 'b', revision: 2 });
    expect(notify).toHaveBeenCalledTimes(2);
  });
  it('selects domain reads without invalidating unrelated caches', () => {
    expect(isResourceCacheKey(['note', 'n'], 'note')).toBe(true);
    expect(isResourceCacheKey(['notes-home', 'token'], 'note')).toBe(true);
    expect(isResourceCacheKey(['task-detail', 't'], 'task')).toBe(true);
    expect(isResourceCacheKey(['projects'], 'task')).toBe(false);
    expect(isResourceCacheKey(['project-understanding', 'p'], 'project')).toBe(true);
    expect(isResourceCacheKey(['projects'], 'project')).toBe(true);
    expect(isResourceCacheKey(['task-detail', 't'], 'project')).toBe(false);
  });
  it('invalidates project reads once per event without applying out-of-order payloads', () => {
    const notify = vi.fn();
    const consume = createResourceChangeConsumer(notify);
    const event = { eventId: 'p1', kind: 'project', id: 'project', revision: 3, operation: 'updated' };
    consume('resources:projects', event);
    consume('resources:projects', event);
    consume('resources:projects', { ...event, eventId: 'p2', revision: 2 });
    consume('resources:tasks', event);
    expect(notify).toHaveBeenCalledTimes(2);
  });
});
