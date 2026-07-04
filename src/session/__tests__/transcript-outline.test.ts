import { describe, expect, it } from 'vitest';

import { buildSessionTimeline } from '../transcript-outline.js';
import type { TranscriptStoredRow } from '../session-context-for-llm.js';

describe('transcript-outline', () => {
  it('builds row-backed timeline items with display anchors', () => {
    const rows: TranscriptStoredRow[] = [
      {
        id: 'u1',
        role: 'user',
        content: [{ type: 'text', text: 'please read src/app.ts' }],
        timestamp: 100,
      } as TranscriptStoredRow,
      {
        id: 'a1',
        role: 'assistant',
        content: [
          {
            type: 'toolCall',
            id: 'tc1',
            name: 'read',
            arguments: { path: 'src/app.ts' },
          },
        ],
        timestamp: 110,
      } as TranscriptStoredRow,
      {
        role: 'tool',
        toolCallId: 'tc1',
        content: [{ type: 'text', text: 'file body' }],
        timestamp: 120,
      } as TranscriptStoredRow,
      {
        kind: 'context',
        text: 'audit row',
        timestamp: '2026-07-04T00:00:00.000Z',
      },
      {
        role: 'branchSummary',
        summary: 'forked from row 2',
      },
      {
        type: 'compaction',
        summary: 'older turns compacted',
        at: '2026-07-04T00:00:01.000Z',
      } as unknown as TranscriptStoredRow,
    ];

    const timeline = buildSessionTimeline(rows);

    expect(timeline.map((item) => item.kind)).toEqual([
      'turn',
      'turn',
      'file',
      'context',
      'branch',
      'compaction',
    ]);
    expect(timeline[0]).toMatchObject({
      id: 'row-1',
      title: 'Turn 1',
      displayIndex: 0,
      rowNumber: 1,
      role: 'user',
    });
    expect(timeline[2]).toMatchObject({
      id: 'row-3',
      kind: 'file',
      displayIndex: 1,
      rowNumber: 3,
      meta: { toolName: 'read', files: ['src/app.ts'] },
      status: 'done',
    });
    expect(timeline[3]?.displayIndex).toBeUndefined();
    expect(timeline[4]).toMatchObject({ kind: 'branch', depth: 1 });
    expect(timeline[5]).toMatchObject({ kind: 'compaction', depth: 1 });
  });

  it('keeps consecutive assistant rows on one display index', () => {
    const rows: TranscriptStoredRow[] = [
      { role: 'user', content: 'first' } as TranscriptStoredRow,
      { role: 'assistant', content: [{ type: 'text', text: 'thinking' }] } as TranscriptStoredRow,
      { role: 'assistant', content: [{ type: 'text', text: 'answer' }] } as TranscriptStoredRow,
      { type: 'session_info', name: 'ignored metadata' } as TranscriptStoredRow,
      { role: 'assistant', content: [{ type: 'text', text: 'tail' }] } as TranscriptStoredRow,
      { role: 'user', content: 'second' } as TranscriptStoredRow,
    ];

    const timeline = buildSessionTimeline(rows);

    expect(timeline[0]).toMatchObject({ role: 'user', displayIndex: 0, turn: 1 });
    expect(timeline[1]).toMatchObject({ role: 'assistant', displayIndex: 1, turn: 1 });
    expect(timeline[2]).toMatchObject({ role: 'assistant', displayIndex: 1, turn: 1 });
    expect(timeline[3]?.displayIndex).toBeUndefined();
    expect(timeline[4]).toMatchObject({ role: 'assistant', displayIndex: 1, turn: 1 });
    expect(timeline[5]).toMatchObject({ role: 'user', displayIndex: 2, turn: 2 });
  });

  it('recognizes tool_use blocks and anchors their result to the assistant bubble', () => {
    const rows: TranscriptStoredRow[] = [
      { role: 'user', content: 'edit file' } as TranscriptStoredRow,
      {
        role: 'assistant',
        content: [
          {
            type: 'tool_use',
            id: 'toolu_1',
            name: 'edit',
            input: { path: 'src/session/transcript-outline.ts' },
          },
        ],
      } as TranscriptStoredRow,
      {
        role: 'toolResult',
        toolCallId: 'toolu_1',
        content: 'ok',
      } as TranscriptStoredRow,
    ];

    const timeline = buildSessionTimeline(rows);

    expect(timeline[2]).toMatchObject({
      kind: 'file',
      title: 'edit',
      displayIndex: 1,
      meta: {
        toolName: 'edit',
        files: ['src/session/transcript-outline.ts'],
      },
    });
  });
});
