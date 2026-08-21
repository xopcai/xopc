import { describe, expect, it } from 'vitest';

import { buildMemoryActivityView, type MemoryActivityLabels } from '@/features/chat/messages/memory-activity';
import type { ToolUseContent } from '@/features/chat/messages/messages.types';

const labels: MemoryActivityLabels = {
  running: 'running',
  found_one: 'found {{count}}',
  found_other: 'found {{count}}',
  empty: 'empty',
  failed: 'failed',
  purpose: 'purpose',
  why: 'why',
  explanation: 'explanation',
  manage: 'manage',
  privacy: 'privacy',
};

function block(status: ToolUseContent['status'], result?: unknown): ToolUseContent {
  return { type: 'tool_use', id: 'memory', name: 'memory_search', status, result };
}

describe('buildMemoryActivityView', () => {
  it('counts structured memory results without exposing their content', () => {
    const view = buildMemoryActivityView(block('done', JSON.stringify({
      details: { results: [{ id: 'one', content: 'private' }, { id: 'two', content: 'private' }] },
    })), labels);
    expect(view).toEqual({ title: 'found 2', purpose: 'purpose' });
  });

  it('distinguishes running, empty, and failed states', () => {
    expect(buildMemoryActivityView(block('running'), labels).title).toBe('running');
    expect(buildMemoryActivityView(block('done', { details: { results: [] } }), labels).title).toBe('empty');
    expect(buildMemoryActivityView(block('error'), labels).title).toBe('failed');
    expect(buildMemoryActivityView({
      ...block('done'),
      activity: {
        category: 'memory', action: 'search', status: 'failed', source: 'memory', sensitivity: 'personal',
      },
    }, labels).title).toBe('failed');
  });
});
