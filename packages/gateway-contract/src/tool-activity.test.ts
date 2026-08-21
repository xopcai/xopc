import { describe, expect, it } from 'vitest';

import { resolveToolActivity, toolActivityId } from './tool-activity.js';

describe('tool activity contract', () => {
  it('resolves explicit built-in and namespaced tool ids', () => {
    expect(toolActivityId('filesystem__read_file')).toBe('read_file');
    expect(resolveToolActivity('memory_search', 'running')).toMatchObject({
      category: 'memory', action: 'search', source: 'memory', sensitivity: 'personal', status: 'running',
    });
    expect(resolveToolActivity('filesystem__read_file', 'completed')).toMatchObject({
      category: 'file', action: 'read', source: 'workspace', status: 'completed',
    });
  });

  it('uses a neutral activity for unregistered tools', () => {
    expect(resolveToolActivity('customer_search_export', 'running')).toEqual({
      category: 'other', action: 'use', source: 'unknown', sensitivity: 'normal', status: 'running',
    });
  });

  it('derives completed result counts and empty status', () => {
    expect(resolveToolActivity('memory_search', 'completed', { details: { results: [] } })).toMatchObject({
      status: 'empty', count: 0,
    });
    expect(resolveToolActivity('memory_search', 'completed', { details: { results: [{ id: '1' }] } })).toMatchObject({
      status: 'completed', count: 1,
    });
    expect(resolveToolActivity('memory_search', 'completed', '{"details":{"results":[]}}')).toMatchObject({
      status: 'empty', count: 0,
    });
  });

  it('resolves dotted catalog ids without fuzzy aliases', () => {
    expect(resolveToolActivity('review.prepare_diff', 'completed')).toMatchObject({
      category: 'file', action: 'read', source: 'workspace', status: 'completed',
    });
  });

  it('surfaces structured tool failures even when transport completion succeeded', () => {
    expect(resolveToolActivity('memory_search', 'completed', { details: { error: 'unavailable' } })).toMatchObject({
      category: 'memory', status: 'failed',
    });
  });
});
