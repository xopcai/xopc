import { describe, expect, it } from 'vitest';

import { executionStepPreview, groupExecutionSteps } from '../entry/src/main/ets/common/executionTimeline.ets';

describe('mobile execution timeline', () => {
  it('combines repeated tools without losing narration or failure order', () => {
    const groups = groupExecutionSteps([
      { id: 'think', kind: 'thinking' },
      { id: 'n', kind: 'progress', text: 'Checking sources' },
      { id: 'a', kind: 'tool', category: 'search', status: 'done' },
      { id: 'b', kind: 'tool', category: 'search', status: 'done' },
      { id: 'c', kind: 'tool', category: 'search', status: 'error', failure: 'Unavailable' },
      { id: 'd', kind: 'tool', category: 'fetch', status: 'running' },
    ], false);
    expect(groups.map((group) => [group.kind, group.steps.length, group.status])).toEqual([
      ['progress', 1, 'done'], ['tool', 2, 'done'], ['tool', 1, 'error'], ['tool', 1, 'stopped'],
    ]);
  });

  it('only surfaces search terms and URL paths from historical inputs', () => {
    expect(executionStepPreview({ id: 'a', kind: 'tool', category: 'search' }, [
      { id: 'a', name: 'web__run', input: { search_query: [{ q: 'Qwen launch' }] } },
    ])).toBe('Qwen launch');
    expect(executionStepPreview({ id: 'b', kind: 'tool', category: 'fetch' }, [
      { id: 'b', name: 'web__run', input: { open: [{ ref_id: 'https://example.com/page?token=secret' }] } },
    ])).toBe('https://example.com/page');
    expect(executionStepPreview({ id: 'c', kind: 'tool', category: 'command' }, [
      { id: 'c', name: 'exec_command', input: { command: 'private command' } },
    ])).toBe('');
  });
});
