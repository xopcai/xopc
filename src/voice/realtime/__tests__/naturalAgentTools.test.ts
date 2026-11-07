import { describe, expect, it, vi } from 'vitest';

import { NaturalAgentTools } from '../naturalAgentTools.js';
import type { VoiceAgentEvent } from '../agentBroker.js';

function setup() {
  const events: VoiceAgentEvent[] = [];
  let wake: (() => void) | undefined;
  const broker = {
    delegate: vi.fn(async (input: { signal: AbortSignal }) => ({ taskId: 'task-1', runId: 'run-1',
      events: (async function* () {
        while (!input.signal.aborted) {
          if (events.length) { yield events.shift()!; continue; }
          await new Promise<void>(resolve => { wake = resolve; input.signal.addEventListener('abort', resolve.bind(null, undefined), { once: true }); });
        }
      })(),
    })),
    cancel: vi.fn(async () => true),
  };
  const send = vi.fn(); const output = vi.fn(); const result = vi.fn();
  const bridge = new NaturalAgentTools({ broker, conversationId: 'chat', transcriptId: 'transcript', callId: 'call', send, output, result });
  return { bridge, broker, send, output, result, emit(event: VoiceAgentEvent) { events.push(event); wake?.(); } };
}
const execute = { id: 'tool-1', name: 'agent_execute', arguments: JSON.stringify({ task: '查询今天的日程，不要修改。' }), responseId: 'response-1' };

describe('natural voice Agent actions', () => {
  it('shares selected assistant content once without executing it or speaking another receipt', async () => {
    const test = setup();
    const publish = vi.fn(async () => {});
    const bridge = new NaturalAgentTools({ broker: test.broker, conversationId: 'chat', transcriptId: 'transcript', callId: 'call',
      send: test.send, output: test.output, result: test.result, publish, hasSpokenResponse: () => true });
    const call = { id: 'publish-1', name: 'chat_publish', responseId: 'response-1', turnId: 'turn-1',
      arguments: JSON.stringify({ text: '先检查接口，再检查发布流程。' }) };
    await Promise.all([bridge.handle(call), bridge.handle(call)]);
    expect(publish).toHaveBeenCalledOnce();
    expect(publish).toHaveBeenCalledWith(expect.objectContaining({ text: '先检查接口，再检查发布流程。', source: 'conversation' }));
    expect(test.broker.delegate).not.toHaveBeenCalled();
    expect(test.output).toHaveBeenCalledWith('publish-1', expect.objectContaining({ published: true }), false);
    bridge.close(); test.bridge.close();
  });

  it('acknowledges a durable task immediately, deduplicates calls, and delivers its result asynchronously', async () => {
    const test = setup();
    await Promise.all([test.bridge.handle(execute), test.bridge.handle(execute)]);
    expect(test.broker.delegate).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ conversationId: 'chat',
      expectedTranscriptId: 'transcript', text: '查询今天的日程，不要修改。', clientMessageId: 'voice-action:transcript:tool-1' }));
    expect(test.output).toHaveBeenCalledWith('tool-1', expect.objectContaining({ status: 'running', taskId: 'task-1' }));
    expect(test.result).not.toHaveBeenCalled();
    test.emit({ type: 'tool_start', payload: { toolCallId: 'lookup', toolName: 'calendar' } });
    test.emit({ type: 'assistant_delta', payload: { delta: '今天有两场会议。' } });
    test.emit({ type: 'run_end', payload: { status: 'completed' } });
    await vi.waitFor(() => expect(test.result).toHaveBeenCalledWith('task-1', { taskId: 'task-1', status: 'completed', statusScope: 'agent_turn', result: '今天有两场会议。' }));
    expect(test.send).toHaveBeenCalledWith('task.activity', expect.objectContaining({ status: 'running' }));
    test.bridge.close();
  });

  it('keeps task execution separate from delivery and explicitly cancels only owned tasks', async () => {
    const test = setup();
    await test.bridge.handle(execute);
    await expect(test.bridge.cancel('other-call-task')).resolves.toBe(false);
    expect(test.broker.cancel).not.toHaveBeenCalled();
    await test.bridge.handle({ ...execute, id: 'cancel', name: 'agent_cancel', arguments: '{}' });
    expect(test.broker.cancel).toHaveBeenCalledExactlyOnceWith('task-1');
    expect(test.output).toHaveBeenCalledWith('cancel', expect.objectContaining({ cancellationRequested: true, status: 'running' }));
    test.emit({ type: 'run_end', payload: { status: 'cancelled' } });
    await vi.waitFor(() => expect(test.send).toHaveBeenCalledWith('task.done', { taskId: 'task-1', status: 'cancelled' }));
    test.bridge.close();
  });

  it('deduplicates an identical action called again under a different tool id in the same user turn', async () => {
    const test = setup();
    await Promise.all([
      test.bridge.handle({ ...execute, turnId: 'utterance-1' }),
      test.bridge.handle({ ...execute, id: 'tool-retry', responseId: 'followup-response', turnId: 'utterance-1' }),
    ]);
    expect(test.broker.delegate).toHaveBeenCalledOnce();
    expect(test.send.mock.calls.filter(([type]) => type === 'task.created')).toHaveLength(1);
    expect(test.output).toHaveBeenCalledWith('tool-retry', expect.objectContaining({ taskId: 'task-1', status: 'running' }));
    test.bridge.close();
  });

  it('detaches on hangup without cancelling the durable task or publishing late results', async () => {
    const test = setup();
    await test.bridge.handle(execute);
    test.bridge.close();
    expect(test.broker.delegate.mock.calls[0][0].signal.aborted).toBe(true);
    expect(test.broker.cancel).not.toHaveBeenCalled();
    test.emit({ type: 'run_end', payload: { status: 'completed' } });
    await Promise.resolve();
    expect(test.result).not.toHaveBeenCalled();
  });

  it('returns progress without re-executing a task and preserves approval questions', async () => {
    const test = setup();
    await test.bridge.handle(execute);
    await test.bridge.handle({ ...execute, id: 'status', name: 'agent_task_status', arguments: '{}' });
    expect(test.broker.delegate).toHaveBeenCalledOnce();
    expect(test.output).toHaveBeenCalledWith('status', expect.objectContaining({ status: 'running' }));
    test.emit({ type: 'clarify_request', payload: { question: '是否确认修改？', requestId: 'approval-1', kind: 'approval' } });
    test.emit({ type: 'run_end', payload: { status: 'suspended' } });
    await vi.waitFor(() => expect(test.send).toHaveBeenCalledWith('response.clarification', expect.objectContaining({ requestId: 'approval-1', kind: 'approval' })));
    expect(test.result).toHaveBeenCalledWith('task-1', expect.objectContaining({ status: 'suspended' }));
    test.bridge.close();
  });

  it.each(['{"task":""}', '[]', '{"task":"read","extra":true}', 'invalid'])('rejects malformed actions without submitting them: %s', async argumentsText => {
    const test = setup();
    await test.bridge.handle({ ...execute, arguments: argumentsText });
    expect(test.broker.delegate).not.toHaveBeenCalled();
    expect(test.output).toHaveBeenCalledWith('tool-1', expect.objectContaining({ error: expect.any(String) }));
    test.bridge.close();
  });

  it('does not report success when task event delivery ends without a terminal outcome', async () => {
    const test = setup();
    test.broker.delegate.mockImplementationOnce(async () => ({ taskId: 'task-1', runId: 'run-1', events: (async function* () {})() }));
    await test.bridge.handle(execute);
    await vi.waitFor(() => expect(test.result).toHaveBeenCalledWith('task-1', expect.objectContaining({ status: 'failed', error: expect.stringContaining('not retry') })));
    test.bridge.close();
  });

  it('bounds long results and explicitly marks omitted text', async () => {
    const test = setup();
    await test.bridge.handle(execute);
    test.emit({ type: 'assistant_delta', payload: { delta: 'x'.repeat(20_000) } });
    test.emit({ type: 'run_end', payload: { status: 'completed' } });
    await vi.waitFor(() => expect(test.result).toHaveBeenCalledWith('task-1', expect.objectContaining({ resultTruncated: true })));
    expect((test.result.mock.calls[0][1] as { result: string }).result.length).toBeLessThanOrEqual(8000);
    test.bridge.close();
  });
});
