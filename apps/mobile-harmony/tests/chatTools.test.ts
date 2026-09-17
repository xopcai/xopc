import { describe, expect, it } from 'vitest';
import { historyRows, mergeHistoryToolResults } from '../entry/src/main/ets/common/chatProtocol.ets';
import type { XopcMessage } from '../entry/src/main/ets/model/chat.ets';
const parse = (messages: XopcMessage[]) => historyRows({ session: { key: 's', messages }, pagination: { hasMore: false } });
const call = { id: 'a', role: 'assistant', content: [{ type: 'toolCall', id: 't', name: 'read', arguments: { path: 'test' } }] };

describe('history tool result fidelity', () => {
  it('merges tool results by identity, preserving status, text and output media', () => {
    const media = { id: 'm', name: 'image', type: 'image', mimeType: 'image/png', size: 1, uri: 'media://result' };
    const rows = parse([call, { role: 'toolResult', toolCallId: 't', isError: true, content: [{ type: 'text', text: 'failure\nwith detail' }], media: [media] }]);
    expect(rows).toHaveLength(1);
    expect(rows[0].toolCalls?.[0]).toMatchObject({ id: 't', name: 'read', result: 'failure\nwith detail', isError: true });
    expect(rows[0].media).toEqual([media]);
    expect(rows[0].tools).toContain('failure\nwith detail');
  });
  it('enriches duplicate raw/top-level calls rather than discarding results', () => {
    const rows = parse([{ ...call, toolCalls: [{ id: 't', name: 'read', result: 'done', isError: false }] }]);
    expect(rows[0].toolCalls).toHaveLength(1); expect(rows[0].toolCalls?.[0].result).toBe('done');
  });
  it('matches parallel results out of order and preserves empty output', () => {
    const rows = parse([{ ...call, toolCalls: [{ id: 'b', name: 'other' }] },
      { role: 'tool', tool_call_id: 'b', content: 'B' }, { role: 'tool', tool_call_id: 't', content: '' }]);
    expect(rows).toHaveLength(1); expect(rows[0].toolCalls?.map(c => c.result)).toEqual(['', 'B']);
  });
  it('merges across history pages but never across a new user turn', () => {
    const older = parse([call]); const latest = parse([{ role: 'toolResult', toolCallId: 't', content: 'done' }]);
    expect(latest).toHaveLength(1);
    expect(mergeHistoryToolResults(older.concat(latest))).toHaveLength(1);
    expect(parse([call, { role: 'user', content: 'new turn' }, { role: 'toolResult', toolCallId: 't', content: 'orphan' }])).toHaveLength(3);
  });
  it('only falls back without identity when one pending call is unambiguous', () => {
    expect(parse([call, { role: 'tool', content: 'done' }])).toHaveLength(1);
    expect(parse([{ ...call, toolCalls: [{ id: 'b', name: 'other' }] }, { role: 'tool', content: 'ambiguous' }])).toHaveLength(2);
    expect(parse([call, { role: 'tool', tool_call_id: 'different', content: 'orphan' }])).toHaveLength(2);
  });
});
