import { describe, expect, it } from 'vitest';
import { reduceChatStream } from '../entry/src/main/ets/common/chatStream.ets';
import { chatAnswerText, chatDeliveries } from '../entry/src/main/ets/common/chatRichContent.ets';

describe('compact chat reducer', () => {
  it.each(['thinking_delta', 'tool_start', 'tool_update', 'command_output_delta', 'turn_diff', 'turn_plan'])('does not retain %s', type => {
    const row = reduceChatStream(undefined, type, { delta: 'secret', args: { secret: true }, diff: 'private' }, 'r');
    expect(row.blocks).toEqual([]); expect(JSON.stringify(row)).not.toContain('secret');
  });
  it('streams text immediately, deduplicates replay and keeps snapshots immutable', () => {
    const first = reduceChatStream(undefined, 'assistant_delta', { messageId: 'm', delta: 'hello', offset: 0 }, 'r');
    const replay = reduceChatStream(first, 'assistant_delta', { messageId: 'm', delta: 'hello', offset: 0 }, 'r');
    const next = reduceChatStream(replay, 'assistant_delta', { messageId: 'm', delta: ' world', offset: 5 }, 'r');
    expect(chatAnswerText(first)).toBe('hello'); expect(chatAnswerText(next)).toBe('hello world');
    const notice = reduceChatStream(next, 'assistant_message_end', { messageId: 'm', presentation: 'narration' }, 'r');
    expect(chatAnswerText(notice)).toBe(''); expect(notice.blocks?.[0].presentation).toBe('narration');
  });
  it('retains deliveries, reviews, audio and failed outcomes at termination', () => {
    const delivery = { version: 2, operation: 'created', primary: { kind: 'note', id: 'n', title: 'Note', capabilities: ['open'] } };
    let row = reduceChatStream(undefined, 'tool_end', { deliveries: [delivery] }, 'r');
    row = reduceChatStream(row, 'tool_end', { deliveries: [delivery] }, 'r');
    row = reduceChatStream(row, 'tts_audio', { uri: 'media://voice' }, 'r');
    row = reduceChatStream(row, 'tts_audio', { uri: 'media://voice' }, 'r');
    row = reduceChatStream(row, 'review', { review: { type: 'review', findings: [] } }, 'r');
    row = reduceChatStream(row, 'turn_outcome', { version: 1, outcomeId: 'o', runId: 'r', turnId: 'r', status: 'failed', deliverables: [] } as never, 'r');
    row = reduceChatStream(row, 'run_end', { status: 'error' }, 'r');
    expect(row.live).toBe(false); expect(row.media).toHaveLength(1); expect(chatDeliveries(row)).toHaveLength(1);
    expect(row.outcome?.status).toBe('failed'); expect(row.blocks?.[0].kind).toBe('review');
  });
});
