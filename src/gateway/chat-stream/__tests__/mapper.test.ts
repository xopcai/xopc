import { describe, expect, it } from 'vitest';

import { ChatStreamMapper } from '../mapper.js';

function mapper() {
  return new ChatStreamMapper({ runId: 'run-1', sessionKey: 'sk', channel: 'webchat' });
}

describe('ChatStreamMapper', () => {
  it('maps run lifecycle with gateway-owned terminal event', () => {
    const m = mapper();
    expect(m.map({ type: 'agent_start', runId: 'run-1' })[0]).toMatchObject({
      type: 'run_start',
      runId: 'run-1',
      sessionKey: 'sk',
      payload: { channel: 'webchat' },
    });
    expect(m.map({ type: 'agent_end', runId: 'run-1' })).toEqual([]);
    expect(m.end('success')[0]).toMatchObject({
      type: 'run_end',
      payload: { status: 'success' },
    });
  });

  it('maps assistant text deltas', () => {
    const m = mapper();
    const [start] = m.map({ type: 'message_start', message: { role: 'assistant', content: [] } });
    const [delta] = m.map({
      type: 'message_update',
      message: { role: 'assistant', content: [{ type: 'text', text: 'h' }] },
      assistantMessageEvent: { type: 'text_delta', delta: 'h' },
    });
    const end = m.map({ type: 'message_end', message: { role: 'assistant', content: [{ type: 'text', text: 'hi' }] } });

    expect(start).toMatchObject({ type: 'assistant_message_start', payload: { messageId: 'msg_run-1_1' } });
    expect(delta).toMatchObject({ type: 'assistant_delta', payload: { messageId: 'msg_run-1_1', delta: 'h' } });
    expect(end.map((e) => e.type)).toEqual(['assistant_delta', 'thinking_end', 'assistant_message_end']);
    expect(end[0]).toMatchObject({ payload: { delta: 'i' } });
  });

  it('does not duplicate text when a provider reports cumulative text_delta chunks', () => {
    const m = mapper();
    m.map({ type: 'message_start', message: { role: 'assistant', content: [] } });

    const first = m.map({
      type: 'message_update',
      message: { role: 'assistant', content: [{ type: 'text', text: 'Hey! What can' }] },
      assistantMessageEvent: { type: 'text_delta', delta: 'Hey! What can' },
    });
    const second = m.map({
      type: 'message_update',
      message: { role: 'assistant', content: [{ type: 'text', text: 'Hey! What can I help you with today?' }] },
      assistantMessageEvent: { type: 'text_delta', delta: 'Hey! What can I help you with today?' },
    });

    expect(first[0]).toMatchObject({ type: 'assistant_delta', payload: { delta: 'Hey! What can' } });
    expect(second[0]).toMatchObject({ type: 'assistant_delta', payload: { delta: ' I help you with today?' } });
  });

  it('maps TTS audio before the gateway run_end and targets the last assistant', () => {
    const m = mapper();
    m.map({ type: 'message_start', message: { role: 'assistant', content: [] } });
    m.map({
      type: 'message_update',
      message: { role: 'assistant', content: [{ type: 'text', text: 'hello' }] },
    });
    m.map({ type: 'message_end', message: { role: 'assistant', content: [{ type: 'text', text: 'hello' }] } });

    expect(m.map({ type: 'agent_end', runId: 'run-1' })).toEqual([]);
    const [tts] = m.map({
      type: 'tts_audio',
      uri: 'media://tts/reply.mp3',
      mimeType: 'audio/mpeg',
      name: 'reply.mp3',
    });
    const [done] = m.end('success');

    expect(tts).toMatchObject({
      type: 'tts_audio',
      payload: {
        uri: 'media://tts/reply.mp3',
        attachTo: 'last_assistant',
        messageId: 'msg_run-1_1',
      },
    });
    expect(done).toMatchObject({ type: 'run_end' });
  });

  it('maps tool lifecycle', () => {
    const m = mapper();
    m.map({ type: 'message_start', message: { role: 'assistant', content: [] } });
    const [start] = m.map({ type: 'tool_execution_start', toolCallId: 'tc1', toolName: 'workflow', args: { step: 1 } });
    const [update] = m.map({ type: 'tool_execution_update', toolCallId: 'tc1', toolName: 'workflow', partialResult: { details: { phase: 'run' } } });
    const [end] = m.map({ type: 'tool_execution_end', toolCallId: 'tc1', toolName: 'workflow', isError: false, result: { content: [{ type: 'text', text: 'done' }], details: { phase: 'done' } } });

    expect(start).toMatchObject({ type: 'tool_start', payload: { toolCallId: 'tc1', toolName: 'workflow', args: { step: 1 } } });
    expect(update).toMatchObject({ type: 'tool_update', payload: { toolCallId: 'tc1', details: { phase: 'run' } } });
    expect(end).toMatchObject({ type: 'tool_end', payload: { toolCallId: 'tc1', status: 'success', result: { text: 'done', details: { phase: 'done' } } } });
  });
});
