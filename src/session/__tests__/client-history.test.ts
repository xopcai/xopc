import { describe, expect, it } from 'vitest';

import { flattenMessageContent, messagesToClientHistory, transcriptRowsToClientHistory } from '../client-history.js';
import type { TranscriptStoredRow } from '../session-context-for-llm.js';
import type { Message } from '../types.js';

describe('messagesToClientHistory', () => {
  it('flattens user and assistant text', () => {
    const messages: Message[] = [
      { role: 'user', content: [{ type: 'text', text: 'Hi' }] },
      { role: 'assistant', content: [{ type: 'text', text: 'Hello' }] },
    ];
    const out = messagesToClientHistory(messages);
    expect(out).toEqual([
      { role: 'user', content: 'Hi' },
      { role: 'assistant', content: 'Hello', toolCalls: undefined },
    ]);
  });

  it('merges tool results into assistant toolCalls', () => {
    const messages: Message[] = [
      {
        role: 'assistant',
        content: '',
        tool_calls: [
          {
            id: 'call_1',
            type: 'function',
            function: { name: 'demo', arguments: '{"x":1}' },
          },
        ],
      },
      {
        role: 'tool',
        content: [{ type: 'text', text: 'done' }],
        tool_call_id: 'call_1',
      },
    ];
    const out = messagesToClientHistory(messages);
    expect(out).toHaveLength(1);
    expect(out[0]!.role).toBe('assistant');
    expect(out[0]!.toolCalls?.[0]?.name).toBe('demo');
    expect(out[0]!.toolCalls?.[0]?.args).toEqual({ x: 1 });
    expect(out[0]!.toolCalls?.[0]?.result).toBe('done');
  });

  it('respects limit on raw messages', () => {
    const messages: Message[] = [
      { role: 'user', content: 'a' },
      { role: 'user', content: 'b' },
      { role: 'user', content: 'c' },
    ];
    const out = messagesToClientHistory(messages, { limit: 2 });
    expect(out.map((m) => m.content)).toEqual(['b', 'c']);
  });

  it('preserves original transcript row ids when limiting transcript history', () => {
    const rows = [
      { role: 'user', content: 'a' },
      { role: 'assistant', content: 'b' },
      { role: 'user', content: 'c' },
    ] as unknown as TranscriptStoredRow[];

    const out = transcriptRowsToClientHistory(rows, { limit: 2 });
    expect(out.map((m) => [m.id, m.content])).toEqual([
      ['row-2', 'b'],
      ['row-3', 'c'],
    ]);
    expect(out.map((m) => m.displayIndex)).toEqual([1, 2]);
  });

  it('preserves global display indexes when limiting transcript history around tool rows', () => {
    const rows = [
      { role: 'user', content: 'turn 1' },
      {
        role: 'assistant',
        content: [
          {
            type: 'tool_use',
            id: 'tool-1',
            name: 'read_file',
            input: { path: 'a.ts' },
          },
        ],
      },
      { role: 'tool', tool_call_id: 'tool-1', content: 'done' },
      { role: 'user', content: 'turn 2' },
      { role: 'assistant', content: 'answer 2' },
    ] as unknown as TranscriptStoredRow[];

    const out = transcriptRowsToClientHistory(rows, { limit: 2 });
    expect(out.map((m) => [m.id, m.content, m.displayIndex])).toEqual([
      ['row-4', 'turn 2', 2],
      ['row-5', 'answer 2', 3],
    ]);
  });

  it('preserves row numbers and global display indexes for explicit transcript windows', () => {
    const rows = [
      { role: 'user', content: 'turn 1' },
      { role: 'assistant', content: 'answer 1' },
      { role: 'user', content: 'turn 2' },
      { role: 'assistant', content: 'answer 2' },
    ] as unknown as TranscriptStoredRow[];

    const out = transcriptRowsToClientHistory(rows, { startRowNumber: 3, endRowNumber: 4 });
    expect(out.map((m) => [m.id, m.content, m.displayIndex])).toEqual([
      ['row-3', 'turn 2', 2],
      ['row-4', 'answer 2', 3],
    ]);
  });

  it('preserves compaction transcript rows for TUI replay', () => {
    const rows = [
      { role: 'user', content: 'before' },
      {
        type: 'compaction',
        at: '2026-06-17T00:00:00.000Z',
        summary: 'summary text',
        tokensBefore: 9000,
        tokensAfter: 1200,
      },
      { kind: 'context', text: 'audit note', createdAt: '2026-06-17T00:00:01.000Z' },
    ] as unknown as TranscriptStoredRow[];

    expect(transcriptRowsToClientHistory(rows)).toEqual([
      {
        id: 'row-1',
        role: 'user',
        kind: 'message',
        content: 'before',
        displayIndex: 0,
        timestamp: undefined,
      },
      {
        id: 'row-2',
        role: 'system',
        kind: 'compaction',
        content: 'summary text',
        timestamp: Date.parse('2026-06-17T00:00:00.000Z'),
        tokensBefore: 9000,
        tokensAfter: 1200,
      },
      {
        id: 'row-3',
        role: 'system',
        kind: 'context',
        content: 'audit note',
        timestamp: Date.parse('2026-06-17T00:00:01.000Z'),
      },
    ]);
  });

  it('replays persisted review trace rows as assistant tool calls', () => {
    const rows = [
      { role: 'user', content: 'review this' },
      {
        kind: 'context',
        text: 'Review trace: review.prepare_diff started',
        createdAt: '2026-06-17T00:00:01.000Z',
        data: {
          type: 'review_trace',
          scope: 'review',
          event: 'tool_start',
          llmInput: false,
          toolCallId: 'review-1',
          toolName: 'review.prepare_diff',
          status: 'running',
          input: { target: 'uncommitted' },
        },
      },
      {
        kind: 'context',
        text: 'Review trace: review.prepare_diff completed',
        createdAt: '2026-06-17T00:00:02.000Z',
        data: {
          type: 'review_trace',
          scope: 'review',
          event: 'tool_end',
          llmInput: false,
          toolCallId: 'review-1',
          toolName: 'review.prepare_diff',
          status: 'done',
          resultPreview: 'Changed files:\n app.ts | 2 +-',
        },
      },
      { role: 'assistant', content: [{ type: 'review', target: 'working tree changes', findings: [] }] },
    ] as unknown as TranscriptStoredRow[];

    expect(transcriptRowsToClientHistory(rows)).toEqual([
      {
        id: 'row-1',
        role: 'user',
        kind: 'message',
        content: 'review this',
        displayIndex: 0,
        timestamp: undefined,
      },
      {
        id: 'row-2',
        role: 'assistant',
        content: '',
        timestamp: Date.parse('2026-06-17T00:00:01.000Z'),
        toolCalls: [
          {
            id: 'review-1',
            name: 'review.prepare_diff',
            args: { target: 'uncommitted' },
            result: 'Changed files:\n app.ts | 2 +-',
            isError: false,
          },
        ],
      },
      {
        id: 'row-4',
        role: 'assistant',
        kind: 'message',
        content: '',
        rawContent: [{ type: 'review', target: 'working tree changes', findings: [] }],
        displayIndex: 1,
        timestamp: undefined,
        toolCalls: undefined,
      },
    ]);
  });

  it('preserves bash execution transcript rows for TUI replay', () => {
    const rows = [
      {
        role: 'bashExecution',
        command: 'pnpm test',
        output: '\u001b[32mok\u001b[0m\n',
        exitCode: 0,
        excludeFromContext: true,
        timestamp: '2026-06-17T00:00:02.000Z',
      },
    ] as unknown as TranscriptStoredRow[];

    expect(transcriptRowsToClientHistory(rows)).toEqual([
      {
        id: 'row-1',
        role: 'system',
        kind: 'bash',
        content: '\u001b[32mok\u001b[0m\n',
        displayIndex: 0,
        timestamp: Date.parse('2026-06-17T00:00:02.000Z'),
        bash: {
          command: 'pnpm test',
          output: '\u001b[32mok\u001b[0m\n',
          exitCode: 0,
          signal: undefined,
          excludeFromContext: true,
          truncated: undefined,
          fullOutputPath: undefined,
        },
      },
    ]);
  });

  it('preserves visible custom message transcript rows for TUI replay', () => {
    const rows = [
      {
        role: 'custom',
        customType: 'skill',
        content: [{ type: 'text', text: 'Loaded **skill**' }],
        display: true,
        details: { id: 'skill-a' },
        timestamp: 123,
      },
      {
        role: 'custom',
        customType: 'hidden',
        content: 'secret',
        display: false,
      },
      {
        type: 'custom_message',
        customType: 'hook',
        content: 'Hook note',
        display: true,
      },
      {
        type: 'custom',
        customType: 'preset-state',
        data: { name: 'fast' },
        timestamp: 456,
      },
    ] as unknown as TranscriptStoredRow[];

    expect(transcriptRowsToClientHistory(rows)).toEqual([
      {
        id: 'row-1',
        role: 'system',
        kind: 'custom',
        content: 'Loaded **skill**',
        rawContent: [{ type: 'text', text: 'Loaded **skill**' }],
        displayIndex: 0,
        timestamp: 123,
        custom: {
          customType: 'skill',
          details: { id: 'skill-a' },
          display: true,
        },
      },
      {
        id: 'row-2',
        role: 'system',
        kind: 'custom',
        content: 'secret',
        rawContent: 'secret',
        displayIndex: 1,
        timestamp: undefined,
        custom: {
          customType: 'hidden',
          details: undefined,
          display: false,
        },
      },
      {
        id: 'row-3',
        role: 'system',
        kind: 'custom',
        content: 'Hook note',
        rawContent: 'Hook note',
        displayIndex: 2,
        timestamp: undefined,
        custom: {
          customType: 'hook',
          details: undefined,
          display: true,
        },
      },
      {
        id: 'row-4',
        role: 'system',
        kind: 'custom',
        content: '',
        timestamp: 456,
        custom: {
          customType: 'preset-state',
          details: { name: 'fast' },
          state: true,
        },
      },
    ]);
  });

  it('preserves pi-style branch and compaction summary rows for TUI replay', () => {
    const rows = [
      {
        role: 'branchSummary',
        summary: 'Returned from a side branch',
        fromId: 'entry-7',
        timestamp: 456,
      },
      {
        role: 'compactionSummary',
        summary: 'Earlier context was compacted',
        tokensBefore: 12000,
        timestamp: '2026-06-17T00:00:03.000Z',
      },
    ] as unknown as TranscriptStoredRow[];

    expect(transcriptRowsToClientHistory(rows)).toEqual([
      {
        id: 'row-1',
        role: 'system',
        kind: 'branch',
        content: 'Returned from a side branch',
        timestamp: 456,
        branch: {
          summary: 'Returned from a side branch',
          fromId: 'entry-7',
        },
      },
      {
        id: 'row-2',
        role: 'system',
        kind: 'compaction',
        content: 'Earlier context was compacted',
        timestamp: Date.parse('2026-06-17T00:00:03.000Z'),
        tokensBefore: 12000,
      },
    ]);
  });
});

describe('flattenMessageContent', () => {
  it('joins text blocks', () => {
    expect(flattenMessageContent([{ type: 'text', text: 'x' }, { type: 'text', text: 'y' }])).toBe(
      'xy',
    );
  });
});
