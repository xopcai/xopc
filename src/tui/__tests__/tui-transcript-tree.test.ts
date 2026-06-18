import { describe, expect, it } from 'vitest';

import {
  buildTuiTranscriptTree,
  filterTuiTranscriptTreeEntries,
  formatTuiTranscriptTreeEntryDisplayText,
} from '../tui-transcript-tree.js';

describe('buildTuiTranscriptTree', () => {
  it('groups assistant, tool, and context rows under the current user turn', () => {
    const entries = buildTuiTranscriptTree([
      { role: 'user', content: 'first question' },
      { role: 'assistant', content: 'first answer' },
      { kind: 'context', text: 'audit row' },
      { role: 'user', content: 'second question' },
      {
        role: 'assistant',
        content: [{ type: 'toolCall', id: 't1', name: 'read_file', arguments: { path: 'a.ts' } }],
      },
      { role: 'toolResult', toolName: 'read_file', content: 'file contents' },
    ] as never);

    expect(entries.map((entry) => [entry.id, entry.parentId, entry.depth, entry.label])).toEqual([
      ['row-1', undefined, 0, 'user'],
      ['row-2', 'row-1', 1, 'assistant'],
      ['row-3', 'row-1', 1, 'context'],
      ['row-4', undefined, 0, 'user'],
      ['row-5', 'row-4', 1, 'assistant'],
      ['row-6', 'row-4', 1, 'tool:read_file'],
    ]);
    expect(entries[4]?.preview).toBe('[read: a.ts]');
  });

  it('formats common assistant tool calls with pi-style previews', () => {
    const entries = buildTuiTranscriptTree([
      { role: 'user', content: 'inspect repo' },
      {
        role: 'assistant',
        content: [
          { type: 'toolCall', id: 't1', name: 'read', arguments: { path: 'src/a.ts', offset: 3, limit: 2 } },
          { type: 'toolCall', id: 't2', name: 'bash', arguments: { command: 'pnpm test\n-- --run' } },
          { type: 'toolCall', id: 't3', name: 'grep', arguments: { pattern: 'TODO', path: 'src' } },
        ],
      },
    ] as never);

    expect(entries[1]?.preview).toBe('[read: src/a.ts:3-4] [bash: pnpm test -- --run] [grep: /TODO/ in src]');
  });

  it('formats custom assistant tool calls with truncated JSON args', () => {
    const entries = buildTuiTranscriptTree([
      { role: 'user', content: 'inspect repo' },
      {
        role: 'assistant',
        content: [
          {
            type: 'toolCall',
            id: 't1',
            name: 'server__custom',
            arguments: { query: 'alpha beta gamma delta epsilon zeta', mode: 'full' },
          },
        ],
      },
      { role: 'toolResult', toolCallId: 't1', content: 'custom result' },
    ] as never);

    expect(entries[1]?.preview).toBe('[server__custom: {"query":"alpha beta gamma delta epsilon...]');
    expect(entries[2]?.toolCallPreview).toBe('[server__custom: {"query":"alpha beta gamma delta epsilon...]');
    expect(formatTuiTranscriptTreeEntryDisplayText(entries[2]!)).toBe(
      '[server__custom: {"query":"alpha beta gamma delta epsilon...]',
    );
  });

  it('links tool result rows back to assistant tool calls for pi-style display text', () => {
    const entries = buildTuiTranscriptTree([
      { role: 'user', content: 'inspect repo' },
      {
        role: 'assistant',
        content: [
          { type: 'toolCall', id: 't1', name: 'read', arguments: { path: 'src/a.ts', offset: 3, limit: 2 } },
        ],
      },
      { role: 'toolResult', toolCallId: 't1', content: 'file contents' },
    ] as never);

    expect(entries[2]).toMatchObject({
      label: 'tool:read',
      preview: 'file contents',
      contentText: 'file contents',
      toolCallPreview: '[read: src/a.ts:3-4]',
    });
    expect(formatTuiTranscriptTreeEntryDisplayText(entries[2]!)).toBe('[read: src/a.ts:3-4]');
  });

  it('links tool result rows using snake_case tool call ids from persisted transcripts', () => {
    const entries = buildTuiTranscriptTree([
      { role: 'user', content: 'inspect repo' },
      {
        role: 'assistant',
        content: [
          {
            type: 'toolCall',
            tool_call_id$: 'call-1',
            name: 'bash',
            arguments: { command: 'pnpm test' },
          },
        ],
      },
      { role: 'toolResult', tool_call_id: 'call-1', content: 'ok' },
    ] as never);

    expect(entries[2]).toMatchObject({
      label: 'tool:bash',
      preview: 'ok',
      contentText: 'ok',
      toolCallPreview: '[bash: pnpm test]',
    });
    expect(formatTuiTranscriptTreeEntryDisplayText(entries[2]!)).toBe('[bash: pnpm test]');
  });

  it('keeps compact tool labels when result rows cannot be linked to a tool call', () => {
    const entries = buildTuiTranscriptTree([
      { role: 'user', content: 'inspect repo' },
      { role: 'toolResult', toolName: 'read_file', content: 'file contents' },
    ] as never);

    expect(entries[1]).toMatchObject({
      label: 'tool:read_file',
      preview: 'file contents',
      contentText: 'file contents',
    });
    expect(formatTuiTranscriptTreeEntryDisplayText(entries[1]!)).toBe('[read_file]');
  });

  it('hides empty and tool-only assistant rows from filtered transcript tree views', () => {
    const entries = buildTuiTranscriptTree([
      { role: 'user', content: 'inspect repo' },
      { role: 'assistant', content: '' },
      {
        role: 'assistant',
        content: [{ type: 'toolCall', id: 't1', name: 'read', arguments: { path: 'src/a.ts' } }],
      },
      { role: 'toolResult', toolName: 'read', content: 'file contents' },
    ] as never);

    expect(filterTuiTranscriptTreeEntries(entries, 'default').map((entry) => entry.label)).toEqual([
      'user',
      'tool:read',
    ]);
    expect(filterTuiTranscriptTreeEntries(entries, 'no-tools').map((entry) => entry.label)).toEqual([
      'user',
    ]);
    expect(filterTuiTranscriptTreeEntries(entries, 'all').map((entry) => entry.label)).toEqual([
      'user',
      'assistant',
      'assistant',
      'tool:read',
    ]);
  });

  it('keeps the current leaf visible even when it is an empty assistant row', () => {
    const entries = buildTuiTranscriptTree([
      { role: 'user', content: 'inspect repo' },
      { role: 'assistant', content: '' },
    ] as never);

    expect(entries[1]).toMatchObject({ label: 'assistant', isCurrentLeaf: true });
    expect(filterTuiTranscriptTreeEntries(entries, 'default').map((entry) => entry.label)).toEqual([
      'user',
      'assistant',
    ]);
    expect(filterTuiTranscriptTreeEntries(entries, 'no-tools').map((entry) => entry.label)).toEqual([
      'user',
      'assistant',
    ]);
  });

  it('keeps the current leaf visible even when it only contains tool calls', () => {
    const entries = buildTuiTranscriptTree([
      { role: 'user', content: 'inspect repo' },
      {
        role: 'assistant',
        content: [{ type: 'toolCall', id: 't1', name: 'read', arguments: { path: 'src/a.ts' } }],
      },
    ] as never);

    expect(entries[1]).toMatchObject({ label: 'assistant', isCurrentLeaf: true });
    expect(filterTuiTranscriptTreeEntries(entries, 'default').map((entry) => entry.label)).toEqual([
      'user',
      'assistant',
    ]);
  });

  it('keeps full user text separately from the display preview', () => {
    const longText = `${'word '.repeat(30)}tail`;
    const entries = buildTuiTranscriptTree([{ role: 'user', content: longText }] as never);

    expect(entries[0]?.contentText).toBe(longText);
    expect(entries[0]?.preview?.length).toBeLessThan(longText.length);
    expect(entries[0]?.preview).toContain('...');
  });

  it('marks the current transcript leaf and active parent path from row order', () => {
    const entries = buildTuiTranscriptTree([
      { role: 'user', content: 'question' },
      { role: 'assistant', content: 'answer' },
      { type: 'label', targetId: 'u1', label: 'later label' },
      { type: 'model_change', provider: 'openai', modelId: 'gpt-5' },
    ] as never);

    expect(entries.map((entry) => [entry.id, entry.isOnActivePath, entry.isCurrentLeaf])).toEqual([
      ['row-1', true, undefined],
      ['row-2', true, true],
      ['row-3', undefined, undefined],
      ['row-4', undefined, undefined],
    ]);
  });

  it('filters transcript tree entries by pi-style tree filter modes', () => {
    const entries = buildTuiTranscriptTree([
      { role: 'user', content: 'question' },
      { role: 'assistant', content: 'answer' },
      { kind: 'context', text: 'audit row' },
      { role: 'toolResult', toolName: 'read_file', content: 'file contents' },
    ] as never);

    expect(filterTuiTranscriptTreeEntries(entries, 'default').map((entry) => entry.label)).toEqual([
      'user',
      'assistant',
      'tool:read_file',
    ]);
    expect(filterTuiTranscriptTreeEntries(entries, 'no-tools').map((entry) => entry.label)).toEqual([
      'user',
      'assistant',
    ]);
    expect(filterTuiTranscriptTreeEntries(entries, 'user-only').map((entry) => entry.label)).toEqual([
      'user',
    ]);
    expect(filterTuiTranscriptTreeEntries(entries, 'all')).toHaveLength(4);
  });

  it('resolves pi-style label rows onto target entries', () => {
    const entries = buildTuiTranscriptTree([
      { id: 'u1', role: 'user', content: 'question' },
      { id: 'a1', role: 'assistant', content: 'answer' },
      {
        type: 'label',
        targetId: 'u1',
        label: 'important',
        timestamp: '2026-06-17T00:00:00.000Z',
      },
    ] as never);

    expect(entries[0]).toMatchObject({
      id: 'row-1',
      label: 'user',
      userLabel: 'important',
      labelTimestamp: '2026-06-17T00:00:00.000Z',
    });
    expect(entries[2]).toMatchObject({
      label: 'label:important',
      preview: 'label: important',
    });
    expect(filterTuiTranscriptTreeEntries(entries, 'labeled-only').map((entry) => entry.id)).toEqual([
      'row-1',
    ]);
    expect(filterTuiTranscriptTreeEntries(entries, 'default').map((entry) => entry.id)).toEqual([
      'row-1',
      'row-2',
    ]);
    expect(filterTuiTranscriptTreeEntries(entries, 'all').map((entry) => entry.id)).toEqual([
      'row-1',
      'row-2',
      'row-3',
    ]);
  });

  it('resolves persisted TUI row labels onto synthetic row ids after reload', () => {
    const entries = buildTuiTranscriptTree([
      { role: 'user', content: 'question' },
      { role: 'assistant', content: 'answer' },
      {
        type: 'label',
        targetId: 'row-1',
        label: 'important',
        timestamp: '2026-06-17T00:00:00.000Z',
      },
    ] as never);

    expect(entries[0]).toMatchObject({
      id: 'row-1',
      label: 'user',
      userLabel: 'important',
      labelTimestamp: '2026-06-17T00:00:00.000Z',
    });
    expect(filterTuiTranscriptTreeEntries(entries, 'labeled-only').map((entry) => entry.id)).toEqual([
      'row-1',
    ]);
  });

  it('clears persisted TUI row labels by synthetic row id after reload', () => {
    const entries = buildTuiTranscriptTree([
      { role: 'user', content: 'question' },
      { type: 'label', targetId: 'row-1', label: 'important' },
      { type: 'label', targetId: 'row-1' },
    ] as never);

    expect(entries[0]?.userLabel).toBeUndefined();
    expect(filterTuiTranscriptTreeEntries(entries, 'labeled-only')).toEqual([]);
  });

  it('renders pi-style metadata rows with searchable previews and hides them by default', () => {
    const entries = buildTuiTranscriptTree([
      { role: 'user', content: 'question' },
      { type: 'model_change', provider: 'openai', modelId: 'gpt-5' },
      { type: 'thinking_level_change', thinkingLevel: 'high' },
      { type: 'session_info', name: 'Demo session' },
      { role: 'assistant', content: 'answer' },
    ] as never);

    expect(entries.map((entry) => [entry.label, entry.parentId, entry.depth, entry.preview])).toEqual([
      ['user', undefined, 0, 'question'],
      ['model_change', 'row-1', 1, 'openai/gpt-5'],
      ['thinking_level_change', 'row-1', 1, 'thinking: high'],
      ['session_info', 'row-1', 1, 'title: Demo session'],
      ['assistant', 'row-1', 1, 'answer'],
    ]);
    expect(filterTuiTranscriptTreeEntries(entries, 'default').map((entry) => entry.label)).toEqual([
      'user',
      'assistant',
    ]);
    expect(filterTuiTranscriptTreeEntries(entries, 'all').map((entry) => entry.label)).toEqual([
      'user',
      'model_change',
      'thinking_level_change',
      'session_info',
      'assistant',
    ]);
  });

  it('maps custom and summary transcript rows into pi-style tree entries', () => {
    const entries = buildTuiTranscriptTree([
      { role: 'user', content: 'question' },
      { role: 'custom', customType: 'skill', content: 'ran skill', display: true },
      { type: 'custom_message', customType: 'hook', content: [{ type: 'text', text: 'hook note' }] },
      { role: 'branchSummary', summary: 'returned from branch' },
      { role: 'compactionSummary', summary: 'summarized old context' },
    ] as never);

    expect(entries.map((entry) => [entry.label, entry.parentId, entry.depth, entry.preview])).toEqual([
      ['user', undefined, 0, 'question'],
      ['custom:skill', 'row-1', 1, 'skill: ran skill'],
      ['custom:hook', 'row-1', 1, 'hook: hook note'],
      ['branch_summary', 'row-1', 1, 'returned from branch'],
      ['compaction', 'row-1', 1, 'summarized old context'],
    ]);
    expect(filterTuiTranscriptTreeEntries(entries, 'default').map((entry) => entry.label)).toEqual([
      'user',
      'branch_summary',
      'compaction',
    ]);
    expect(filterTuiTranscriptTreeEntries(entries, 'all').map((entry) => entry.label)).toEqual([
      'user',
      'custom:skill',
      'custom:hook',
      'branch_summary',
      'compaction',
    ]);
  });

  it('maps bash execution transcript rows into pi-style tree entries', () => {
    const entries = buildTuiTranscriptTree([
      { role: 'user', content: 'run tests' },
      { role: 'bashExecution', command: 'pnpm test', output: 'ok', exitCode: 0 },
    ] as never);

    expect(entries.map((entry) => [entry.label, entry.parentId, entry.depth, entry.preview])).toEqual([
      ['user', undefined, 0, 'run tests'],
      ['bashExecution', 'row-1', 1, 'pnpm test'],
    ]);
    expect(filterTuiTranscriptTreeEntries(entries, 'default').map((entry) => entry.label)).toEqual([
      'user',
      'bashExecution',
    ]);
    expect(filterTuiTranscriptTreeEntries(entries, 'no-tools').map((entry) => entry.label)).toEqual([
      'user',
      'bashExecution',
    ]);
  });

  it('preserves assistant aborted and error states in transcript tree previews', () => {
    const entries = buildTuiTranscriptTree([
      { role: 'user', content: 'question' },
      { role: 'assistant', content: '', stopReason: 'aborted' },
      { role: 'assistant', content: [], stopReason: 'error', errorMessage: 'provider unavailable' },
    ] as never);

    expect(entries.map((entry) => [entry.label, entry.parentId, entry.depth, entry.preview])).toEqual([
      ['user', undefined, 0, 'question'],
      ['assistant', 'row-1', 1, '(aborted)'],
      ['assistant', 'row-1', 1, 'provider unavailable'],
    ]);
    expect(filterTuiTranscriptTreeEntries(entries, 'default').map((entry) => entry.preview)).toEqual([
      'question',
      '(aborted)',
      'provider unavailable',
    ]);
  });
});
