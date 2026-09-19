import { describe, expect, it } from 'vitest';

import { createStreamingMessage, finalizeStreamingMessage, reduceRunEvent } from './chat-stream-reducer';

const event = (name: string, payload: Record<string, unknown>, timestamp = 100) => ({
  event: name,
  payload,
  runId: 'run-1',
  timestamp,
});

describe('browser chat stream reducer', () => {
  it('keeps thinking, tools, and answer text in execution order', () => {
    let message = createStreamingMessage('run-1', 1);
    message = reduceRunEvent(message, event('thinking_delta', { delta: 'Check ' }));
    message = reduceRunEvent(message, event('thinking_delta', { delta: 'files' }));
    message = reduceRunEvent(message, event('tool_start', { toolCallId: 'call-1', toolName: 'read_file', args: { path: 'a.ts' } }, 110));
    message = reduceRunEvent(message, event('tool_end', { toolCallId: 'call-1', toolName: 'read_file', status: 'success', result: 'ok' }, 130));
    message = reduceRunEvent(message, event('assistant_delta', { messageId: 'answer-1', delta: 'Done.' }, 140));

    expect(message.blocks).toMatchObject([
      { type: 'thinking', text: 'Check files', streaming: false },
      { type: 'tool', toolCallId: 'call-1', status: 'done', startedAt: 110, completedAt: 130 },
      { type: 'text', text: 'Done.' },
    ]);
  });

  it('matches duplicate tool names by call id', () => {
    let message = createStreamingMessage('run-1');
    message = reduceRunEvent(message, event('tool_start', { toolCallId: 'one', toolName: 'read_file' }));
    message = reduceRunEvent(message, event('tool_start', { toolCallId: 'two', toolName: 'read_file' }));
    message = reduceRunEvent(message, event('tool_end', { toolCallId: 'one', toolName: 'read_file', status: 'success' }));

    expect(message.blocks).toMatchObject([
      { type: 'tool', toolCallId: 'one', status: 'done' },
      { type: 'tool', toolCallId: 'two', status: 'running' },
    ]);
  });

  it('deduplicates replay overlap and synthesizes a missing tool start', () => {
    let message = createStreamingMessage('run-1');
    message = reduceRunEvent(message, event('assistant_delta', { messageId: 'm1', delta: 'abc' }));
    message = reduceRunEvent(message, event('assistant_delta', { messageId: 'm1', delta: 'bcdef' }));
    message = reduceRunEvent(message, event('tool_end', { toolCallId: 'late', toolName: 'web_search', status: 'error' }));

    expect(message.blocks).toMatchObject([
      { type: 'text', text: 'abcdef' },
      { type: 'tool', toolCallId: 'late', status: 'error' },
    ]);
  });

  it('closes incomplete activity when the stream terminates', () => {
    let message = createStreamingMessage('run-1');
    message = reduceRunEvent(message, event('thinking_delta', { delta: ' working ' }));
    message = reduceRunEvent(message, event('tool_start', { toolCallId: 'one', toolName: 'exec_command' }));

    expect(finalizeStreamingMessage(message, true).blocks).toMatchObject([
      { type: 'thinking', text: 'working', streaming: false },
      { type: 'tool', status: 'error' },
    ]);
  });

  it('keeps structured updates and their text delta', () => {
    let message = createStreamingMessage('run-1');
    message = reduceRunEvent(message, event('tool_start', { toolCallId: 'one', toolName: 'workflow' }));
    message = reduceRunEvent(message, event('tool_update', {
      toolCallId: 'one',
      toolName: 'workflow',
      details: { phase: 'run' },
      textDelta: 'hello',
    }));

    expect(message.blocks[0]).toMatchObject({ details: { phase: 'run', text: 'hello' } });
  });
});
