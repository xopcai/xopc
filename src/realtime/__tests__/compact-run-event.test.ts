import { describe, expect, it } from 'vitest';
import { RealtimeBroker } from '../broker.js';
import { compactRunEvent } from '../compact-run-event.js';
import { ChatStreamMapper } from '../../gateway/chat-stream/mapper.js';

describe('compact run transport', () => {
  it('filters both live and replay frames without changing sequence or full subscribers', () => {
    const broker = new RealtimeBroker();
    const events = ['run_start', 'thinking_delta', 'tool_start', 'tool_update', 'assistant_delta', 'run_end'];
    const full: string[] = []; const compact: number[] = [];
    broker.subscribe('run:r', 0, frame => { full.push(frame.payload.event); const output = compactRunEvent(frame); if (output?.kind === 'realtime.event') compact.push(output.payload.seq); });
    for (const type of events) broker.publish('run:r', type, { type, payload: { delta: 'hello' } });
    expect(full).toEqual(events); expect(compact).toEqual([1, 5, 6]);
    expect(broker.subscribe('run:r', 0, () => {}).initial.map(compactRunEvent).filter(Boolean)).toHaveLength(3);
    const gap = broker.subscribe('run:r', 100, () => {}).initial[0];
    expect(compactRunEvent(gap)).toBe(gap);
  });
  it('preserves typed deliveries before raw result truncation', () => {
    const mapper = new ChatStreamMapper({ runId: 'r', conversationId: 'c', channel: 'webchat' });
    const delivery = { version: 2, operation: 'created', primary: { kind: 'note', id: 'n', title: 'Note', capabilities: ['open'] } };
    const end = mapper.map({ type: 'tool_execution_end', toolCallId: 't', toolName: 'create_note',
      result: { content: [{ type: 'text', text: 'x'.repeat(1_000_000) }], details: { delivery } } }).find(e => e.type === 'tool_end')!;
    const output = compactRunEvent(new RealtimeBroker().publish('run:r', end.type, end));
    expect(output).toMatchObject({ payload: { data: { payload: { deliveries: [delivery] } } } });
    expect(JSON.stringify(output).length).toBeLessThan(1000);
  });
  it.each(['error', 'clarify_request', 'run_end', 'tts_audio', 'review'])('retains %s', type => {
    const event = new RealtimeBroker().publish('run:r', type, { type, payload: { message: 'important' } });
    expect(compactRunEvent(event)).toEqual(event);
  });
});
