import { describe, expect, it } from 'vitest';

import { computeTranscriptUserRoundDeleteRange } from '../user-round-delete.js';
import type { TranscriptStoredRow } from '../session-context-for-llm.js';

describe('computeTranscriptUserRoundDeleteRange', () => {
  it('deletes a steering message and its reply by stable input ID', () => {
    const rows = [
      { role: 'user', content: 'Request' },
      { role: 'assistant', content: 'Progress' },
      { role: 'user', content: 'Same text', metadata: { steered: true, clientMessageId: 'first' } },
      { role: 'user', content: 'Same text', metadata: { steered: true, clientMessageId: 'second' } },
      { role: 'assistant', content: 'Updated answer' },
    ] as Parameters<typeof computeTranscriptUserRoundDeleteRange>[0];
    expect(computeTranscriptUserRoundDeleteRange(rows, { steerId: 'second' })).toEqual({ startIndex: 3, count: 2 });
    expect(computeTranscriptUserRoundDeleteRange(rows, { steerId: 'first' })).toEqual({ startIndex: 2, count: 1 });
    expect(computeTranscriptUserRoundDeleteRange(rows, { steerId: 'missing' })).toBeNull();
  });

  it('deletes user plus plain assistant reply', () => {
    const messages: TranscriptStoredRow[] = [
      { role: 'user', content: 'hi' },
      { role: 'assistant', content: 'hello' },
    ];
    expect(computeTranscriptUserRoundDeleteRange(messages, 0)).toEqual({ startIndex: 0, count: 2 });
  });

  it('deletes every raw row in the turn, including tool and audit rows', () => {
    const messages: TranscriptStoredRow[] = [
      { role: 'user', content: 'search' },
      {
        role: 'assistant',
        content: '',
        tool_calls: [
          {
            id: 'call_1',
            type: 'function',
            function: { name: 'web_search', arguments: '{}' },
          },
        ],
      },
      {
        role: 'toolResult',
        content: [{ type: 'text', text: 'results' }],
        toolCallId: 'call_1',
      },
      { kind: 'context', text: 'tool audit' },
      { role: 'assistant', content: [{ type: 'text', text: 'done' }] },
    ];
    expect(computeTranscriptUserRoundDeleteRange(messages, 0)).toEqual({ startIndex: 0, count: 5 });
  });

  it('targets the requested user round only', () => {
    const messages: TranscriptStoredRow[] = [
      { role: 'user', content: 'a' },
      { role: 'assistant', content: 'A' },
      { role: 'user', content: 'b' },
      { role: 'assistant', content: 'B' },
    ];
    expect(computeTranscriptUserRoundDeleteRange(messages, 1)).toEqual({ startIndex: 2, count: 2 });
  });

  it('counts visible custom messages exactly as the UI does', () => {
    const rows: TranscriptStoredRow[] = [
      { role: 'custom', customType: 'visible', content: 'a', display: true },
      { role: 'assistant', content: 'A' },
      { role: 'custom', customType: 'hidden', content: 'hidden', display: false },
      { role: 'user', content: 'b' },
    ];
    expect(computeTranscriptUserRoundDeleteRange(rows, 1)).toEqual({ startIndex: 3, count: 1 });
  });

  it('returns null when user round is out of range', () => {
    const messages: TranscriptStoredRow[] = [{ role: 'user', content: 'a' }];
    expect(computeTranscriptUserRoundDeleteRange(messages, 1)).toBeNull();
  });
});
