import { describe, expect, it, vi } from 'vitest';

import {
  AgentSseLineParser,
  consumeAgentSseFromText,
  consumeAgentSseResponse,
  consumeAgentSseStream,
  dispatchAgentSseEvent,
} from '../src/agent-sse.js';

function envelope(type: string, runId: string, payload: object, seq?: number): object {
  return {
    type,
    runId,
    sessionKey: 'chat_a',
    timestamp: 1,
    ...(seq !== undefined ? { seq } : {}),
    payload,
  };
}

function encodeSse(chunks: Array<{ event: string; data: object }>): Uint8Array {
  const lines: string[] = [];
  for (const c of chunks) {
    lines.push(`event: ${c.event}`);
    lines.push(`data: ${JSON.stringify(c.data)}`);
    lines.push('');
  }
  return new TextEncoder().encode(lines.join('\n'));
}

function callbacks(overrides: Partial<Parameters<typeof dispatchAgentSseEvent>[2]> = {}) {
  return {
    onStreamStart: vi.fn(),
    onToken: vi.fn(),
    onThinking: vi.fn(),
    onThinkingEnd: vi.fn(),
    onToolStart: vi.fn(),
    onToolUpdate: vi.fn(),
    onToolEnd: vi.fn(),
    onProgress: vi.fn(),
    onResult: vi.fn(),
    onError: vi.fn(),
    ...overrides,
  } as NonNullable<Parameters<typeof dispatchAgentSseEvent>[2]>;
}

describe('dispatchAgentSseEvent', () => {
  it('persists runId on run_start and starts stream', () => {
    const savePendingRunId = vi.fn();
    const cb = callbacks();
    dispatchAgentSseEvent(
      'run_start',
      JSON.stringify(envelope('run_start', 'run-1', { channel: 'webchat' })),
      cb,
      { sseSessionKey: 'agent:main:webchat:default:direct:chat_a', savePendingRunId },
    );
    expect(savePendingRunId).toHaveBeenCalledWith('agent:main:webchat:default:direct:chat_a', 'run-1');
    expect(cb.onStreamStart).toHaveBeenCalled();
  });

  it('dispatches assistant and thinking deltas', () => {
    const cb = callbacks();
    dispatchAgentSseEvent('assistant_delta', JSON.stringify(envelope('assistant_delta', 'run-1', { messageId: 'm1', delta: 'hi' })), cb);
    dispatchAgentSseEvent('thinking_delta', JSON.stringify(envelope('thinking_delta', 'run-1', { messageId: 'm1', delta: 'plan' })), cb);
    dispatchAgentSseEvent('thinking_end', JSON.stringify(envelope('thinking_end', 'run-1', { messageId: 'm1' })), cb);
    expect(cb.onToken).toHaveBeenCalledWith('hi');
    expect(cb.onThinking).toHaveBeenCalledWith('plan', true);
    expect(cb.onThinkingEnd).toHaveBeenCalled();
  });

  it('dispatches user_transcript to onUserTranscript', () => {
    const onUserTranscript = vi.fn();
    dispatchAgentSseEvent(
      'user_transcript',
      JSON.stringify(envelope('user_transcript', 'run-1', {
        text: '你好',
        attachments: [{ uri: 'media://inbound/s/voice.m4a', workspaceRelativePath: 'inbound/s/voice.m4a', mimeType: 'audio/mp4' }],
      })),
      callbacks({ onUserTranscript }) as never,
    );
    expect(onUserTranscript).toHaveBeenCalledWith({
      text: '你好',
      attachments: [{ uri: 'media://inbound/s/voice.m4a', workspaceRelativePath: 'inbound/s/voice.m4a', mimeType: 'audio/mp4' }],
    });
  });

  it('does not emit accepted user_message content as assistant token', () => {
    const cb = callbacks();
    dispatchAgentSseEvent('user_message', JSON.stringify(envelope('user_message', 'run-1', { message: { content: 'hello' } })), cb);
    expect(cb.onToken).not.toHaveBeenCalled();
  });

  it('uses payload type when SSE event name is generic message', () => {
    const cb = callbacks();
    dispatchAgentSseEvent('message', JSON.stringify(envelope('assistant_delta', 'run-1', { messageId: 'm1', delta: 'x' })), cb);
    expect(cb.onToken).toHaveBeenCalledWith('x');
  });

  it('dispatches tool lifecycle with toolCallId', () => {
    const cb = callbacks();
    const result = { content: [{ type: 'text', text: 'done' }], details: { ok: true } };
    dispatchAgentSseEvent('tool_start', JSON.stringify(envelope('tool_start', 'run-1', { messageId: 'm1', toolName: 'workflow', toolCallId: 'tc1', args: { step: 1 } })), cb);
    dispatchAgentSseEvent('tool_update', JSON.stringify(envelope('tool_update', 'run-1', { messageId: 'm1', toolName: 'workflow', toolCallId: 'tc1', details: { phase: 'run' } })), cb);
    dispatchAgentSseEvent('tool_end', JSON.stringify(envelope('tool_end', 'run-1', { messageId: 'm1', toolName: 'workflow', toolCallId: 'tc1', status: 'success', result })), cb);
    expect(cb.onToolStart).toHaveBeenCalledWith('workflow', { step: 1 }, 'tc1');
    expect(cb.onToolUpdate).toHaveBeenCalledWith('workflow', 'tc1', { phase: 'run' });
    expect(cb.onToolEnd).toHaveBeenCalledWith('workflow', false, result, 'tc1');
  });

  it('dispatches TTS audio payload with media uri and target metadata', () => {
    const onTtsAudio = vi.fn();
    dispatchAgentSseEvent(
      'tts_audio',
      JSON.stringify(envelope('tts_audio', 'run-1', {
        uri: 'media://tts/reply.mp3',
        mimeType: 'audio/mpeg',
        name: 'reply.mp3',
        attachTo: 'last_assistant',
        messageId: 'msg_run_1',
      })),
      callbacks({ onTtsAudio }) as never,
    );
    expect(onTtsAudio).toHaveBeenCalledWith({
      uri: 'media://tts/reply.mp3',
      mimeType: 'audio/mpeg',
      name: 'reply.mp3',
      attachTo: 'last_assistant',
      messageId: 'msg_run_1',
    });
  });

  it('calls terminal callbacks for run_end and error', () => {
    const cb = callbacks();
    dispatchAgentSseEvent('run_end', JSON.stringify(envelope('run_end', 'run-1', { status: 'success' })), cb);
    dispatchAgentSseEvent('error', JSON.stringify(envelope('error', 'run-2', { code: 'X', message: 'boom' })), cb);
    expect(cb.onResult).toHaveBeenCalled();
    expect(cb.onError).toHaveBeenCalledWith('boom');
  });
});

describe('AgentSseLineParser', () => {
  it('dispatches assistant_delta as chunks arrive', () => {
    const cb = callbacks();
    const parser = new AgentSseLineParser(cb);
    parser.feed('event: assistant_delta\ndata: {"type":"assistant_delta","runId":"r","sessionKey":"s","timestamp":1,"payload":{"messageId":"m","delta":');
    expect(cb.onToken).not.toHaveBeenCalled();
    parser.feed('"hi"}}\n\n');
    expect(cb.onToken).toHaveBeenCalledWith('hi');
  });
});

describe('consumeAgentSseFromText', () => {
  it('parses SSE from a buffered string', () => {
    const cb = callbacks();
    const text = new TextDecoder().decode(
      encodeSse([
        { event: 'assistant_delta', data: envelope('assistant_delta', 'run-1', { messageId: 'm1', delta: 'x' }) },
        { event: 'run_end', data: envelope('run_end', 'run-1', { status: 'success' }) },
      ]),
    );
    consumeAgentSseFromText(text, cb);
    expect(cb.onToken).toHaveBeenCalledWith('x');
    expect(cb.onResult).toHaveBeenCalled();
  });
});

describe('consumeAgentSseResponse', () => {
  it('falls back to text() when response.body is null', async () => {
    const cb = callbacks();
    const payload = new TextDecoder().decode(
      encodeSse([{ event: 'assistant_delta', data: envelope('assistant_delta', 'run-1', { messageId: 'm1', delta: 'from-text' }) }]),
    );
    const res = new Response(payload, { headers: { 'Content-Type': 'text/event-stream' } });
    Object.defineProperty(res, 'body', { value: null });

    await consumeAgentSseResponse(res, cb);
    expect(cb.onToken).toHaveBeenCalledWith('from-text');
  });
});

describe('consumeAgentSseStream', () => {
  it('parses multiple SSE events', async () => {
    const cb = callbacks();
    const body = new ReadableStream({
      start(controller) {
        controller.enqueue(
          encodeSse([
            { event: 'assistant_delta', data: envelope('assistant_delta', 'run-1', { messageId: 'm1', delta: 'a' }) },
            { event: 'assistant_delta', data: envelope('assistant_delta', 'run-1', { messageId: 'm1', delta: 'b' }) },
            { event: 'run_end', data: envelope('run_end', 'run-1', { status: 'success' }) },
          ]),
        );
        controller.close();
      },
    });

    await consumeAgentSseStream(body, cb);
    expect(cb.onToken).toHaveBeenCalledTimes(2);
    expect(cb.onToken).toHaveBeenNthCalledWith(1, 'a');
    expect(cb.onToken).toHaveBeenNthCalledWith(2, 'b');
    expect(cb.onResult).toHaveBeenCalled();
  });
});
