import { describe, expect, it } from 'vitest';

import { publicExecutionDetail } from '../execution-detail.js';

describe('public execution detail', () => {
  it('preserves step order while withholding raw reasoning, commands and tool output', () => {
    const detail = publicExecutionDetail([{ id: 'm1', turnId: 'turn-1', role: 'assistant', content: 'Done',
      rawContent: [
        { type: 'thinking', text: 'private reasoning' },
        { type: 'text', presentation: 'narration', text: 'Checking the project' },
        { type: 'tool_use', id: 'call-1', name: 'exec_command', input: { command: 'secret command' } },
        { type: 'tool_use', id: 'call-2', name: 'web_search', input: { query: 'public query' } },
      ],
      toolCalls: [
        { id: 'call-1', name: 'exec_command', args: { command: 'secret command' }, result: 'private output' },
        { id: 'call-2', name: 'web_search', args: { query: 'public query' }, isError: true, result: 'private error',
          details: { errorMessage: 'Access denied' } },
      ],
    }], 'turn-1');
    expect(detail?.steps.map(step => step.kind)).toEqual(['thinking', 'progress', 'tool', 'tool']);
    expect(detail?.steps[2]).toMatchObject({ category: 'command', status: 'done' });
    expect(detail?.steps[3]).toMatchObject({ category: 'search', preview: 'public query', status: 'error', failure: 'Access denied' });
    expect(JSON.stringify(detail)).not.toMatch(/private reasoning|secret command|private output|private error/);
    expect(publicExecutionDetail([], 'turn-1')).toBeNull();
  });

  it('removes URL query credentials from the public preview', () => {
    const detail = publicExecutionDetail([{ id: 'm2', turnId: 'turn-2', role: 'assistant', content: '',
      toolCalls: [{ id: 'call', name: 'web_fetch', args: { url: 'https://example.com/page?token=secret' }, result: 'ok' }],
    }], 'turn-2');
    expect(detail?.steps[0].preview).toBe('https://example.com/page');
  });
});
