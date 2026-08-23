import { describe, expect, it } from 'vitest';

import { ChatStreamMapper } from '../mapper.js';
import { createPetFeedback } from '../pet-feedback.js';

function mapper() {
  return new ChatStreamMapper({ runId: 'run-1', sessionKey: 'sk', channel: 'webchat' });
}

describe('ChatStreamMapper', () => {
  it('publishes only summaries that a producer explicitly marks for the pet', () => {
    expect(createPetFeedback('success', { publicSummary: '  Tests passed  ' })).toMatchObject({
      sensitivity: 'public',
      publicSummary: 'Tests passed',
    });
    expect(createPetFeedback('error')).toMatchObject({
      sensitivity: 'private',
      reassurance: 'details_available',
    });
  });

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
      payload: {
        status: 'success',
        petFeedback: {
          version: 2,
          taskState: 'success',
          sensitivity: 'private',
          reassurance: 'completed',
          nextAction: { type: 'open_session' },
        },
      },
    });
  });

  it('maps persisted media to user message attachments', () => {
    const m = mapper();
    const [event] = m.map({
      type: 'user_message',
      timestamp: 42,
      content: [{ type: 'text', text: 'see image' }],
      media: [{ uri: 'media://inbound/x.png', mimeType: 'image/png', name: 'x.png' }],
    });

    expect(event).toMatchObject({
      type: 'user_message',
      payload: {
        message: {
          role: 'user',
          timestamp: 42,
          attachments: [
            { uri: 'media://inbound/x.png', mimeType: 'image/png', name: 'x.png' },
          ],
        },
      },
    });
  });

  it('adds ambient-safe feedback to progress without inferring from its private message', () => {
    const m = mapper();
    const [progress] = m.map({
      type: 'progress',
      stage: 'testing',
      message: 'Testing /private/customer-repo',
      completed: 8,
      total: 5,
    });

    expect(progress).toMatchObject({
      type: 'progress',
      payload: {
        message: 'Testing /private/customer-repo',
        petFeedback: {
          version: 2,
          taskState: 'working',
          sensitivity: 'private',
          reassurance: 'making_progress',
          progress: { completed: 5, total: 5 },
        },
      },
    });
    expect(progress.payload.petFeedback).not.toHaveProperty('publicSummary');
  });

  it('never copies raw errors into ambient pet feedback', () => {
    const m = mapper();
    const [error] = m.error('Authorization: Bearer private-token');

    expect(error).toMatchObject({
      type: 'error',
      payload: {
        message: 'Authorization: Bearer private-token',
        petFeedback: {
          version: 2,
          taskState: 'error',
          sensitivity: 'private',
          reassurance: 'details_available',
          nextAction: { type: 'review_error' },
        },
      },
    });
    expect(error.payload.petFeedback).not.toHaveProperty('publicSummary');
  });

  it('maps assistant text deltas', () => {
    const m = mapper();
    const [start] = m.map({ type: 'message_start', message: { role: 'assistant', content: [] } });
    const [firstDelta] = m.map({
      type: 'message_update',
      message: { role: 'assistant', content: [{ type: 'text', text: 'h' }] },
      assistantMessageEvent: { type: 'text_delta', delta: 'h' },
    });
    const [secondDelta] = m.map({
      type: 'message_update',
      message: { role: 'assistant', content: [{ type: 'text', text: 'hi' }] },
      assistantMessageEvent: { type: 'text_delta', delta: 'i' },
    });
    const end = m.map({ type: 'message_end', message: { role: 'assistant', content: [{ type: 'text', text: 'hi' }] } });

    expect(start).toMatchObject({ type: 'assistant_message_start', payload: { messageId: 'msg_run-1_1' } });
    expect(firstDelta).toMatchObject({ type: 'assistant_delta', payload: { messageId: 'msg_run-1_1', delta: 'h' } });
    expect(secondDelta).toMatchObject({ type: 'assistant_delta', payload: { messageId: 'msg_run-1_1', delta: 'i' } });
    expect(end.map((e) => e.type)).toEqual(['thinking_end', 'assistant_message_end']);
    expect(end.at(-1)).toMatchObject({
      type: 'assistant_message_end',
      payload: { presentation: 'answer' },
    });
  });

  it('marks text accompanying a tool call as narration', () => {
    const m = mapper();
    m.map({ type: 'message_start', message: { role: 'assistant', content: [] } });

    const events = m.map({
      type: 'message_end',
      message: {
        role: 'assistant',
        content: [
          { type: 'text', text: 'I will inspect the project first. More detail follows.' },
          { type: 'toolCall', id: 'call-1', name: 'read_file', arguments: {} },
        ],
      },
    });

    expect(events.at(-1)).toMatchObject({
      type: 'assistant_message_end',
      payload: { presentation: 'narration' },
    });
  });

  it('exposes provider cache usage on the terminal assistant event', () => {
    const m = mapper();
    m.map({ type: 'message_start', message: { role: 'assistant', content: [] } });

    const events = m.map({
      type: 'message_end',
      message: {
        role: 'assistant',
        content: [{ type: 'text', text: 'done' }],
        usage: {
          input: 120,
          output: 30,
          cacheRead: 80,
          cacheWrite: 10,
          totalTokens: 240,
          cost: { input: 0.1, output: 0.2, cacheRead: 0.01, cacheWrite: 0.02, total: 0.33 },
        },
      },
    });

    expect(events.at(-1)).toMatchObject({
      type: 'assistant_message_end',
      payload: {
        usage: {
          inputTokens: 120,
          outputTokens: 30,
          cacheReadTokens: 80,
          cacheWriteTokens: 10,
          totalTokens: 240,
          cost: 0.33,
        },
      },
    });
  });

  it('uses text_delta as the only live text source when the message snapshot is ahead', () => {
    const m = mapper();
    m.map({ type: 'message_start', message: { role: 'assistant', content: [] } });

    const first = m.map({
      type: 'message_update',
      message: { role: 'assistant', content: [{ type: 'text', text: '先看看刚生成的三款 logo 实际效果，再针对性优化。' }] },
      assistantMessageEvent: { type: 'text_delta', delta: '先看看' },
    });
    const second = m.map({
      type: 'message_update',
      message: { role: 'assistant', content: [{ type: 'text', text: '先看看刚生成的三款 logo 实际效果，再针对性优化。' }] },
      assistantMessageEvent: { type: 'text_delta', delta: '刚生成的三款 logo 实际效果，再针对性优化。' },
    });

    expect(first[0]).toMatchObject({ type: 'assistant_delta', payload: { delta: '先看看' } });
    expect(second[0]).toMatchObject({ type: 'assistant_delta', payload: { delta: '刚生成的三款 logo 实际效果，再针对性优化。' } });
  });

  it('uses text_delta as the only live text source when the message snapshot is stale', () => {
    const m = mapper();
    m.map({ type: 'message_start', message: { role: 'assistant', content: [] } });

    const first = m.map({
      type: 'message_update',
      message: { role: 'assistant', content: [{ type: 'text', text: '让我' }] },
      assistantMessageEvent: { type: 'text_delta', delta: '让我' },
    });
    const second = m.map({
      type: 'message_update',
      message: { role: 'assistant', content: [{ type: 'text', text: '让我' }] },
      assistantMessageEvent: { type: 'text_delta', delta: '先快速' },
    });
    const third = m.map({
      type: 'message_update',
      message: { role: 'assistant', content: [{ type: 'text', text: '让我' }] },
      assistantMessageEvent: { type: 'text_delta', delta: '查一下' },
    });
    const end = m.map({
      type: 'message_end',
      message: { role: 'assistant', content: [{ type: 'text', text: '让我先快速查一下' }] },
    });

    expect(first[0]).toMatchObject({ type: 'assistant_delta', payload: { delta: '让我' } });
    expect(second[0]).toMatchObject({ type: 'assistant_delta', payload: { delta: '先快速' } });
    expect(third[0]).toMatchObject({ type: 'assistant_delta', payload: { delta: '查一下' } });
    expect(end.map((event) => event.type)).toEqual(['thinking_end', 'assistant_message_end']);
  });

  it('maps an explicit assistant snapshot as one complete delta', () => {
    const m = mapper();
    m.map({ type: 'message_start', message: { role: 'assistant', content: [] } });

    const [delta] = m.map({
      type: 'assistant_snapshot',
      message: { role: 'assistant', content: [{ type: 'text', text: 'Background task completed.' }] },
    });

    expect(delta).toMatchObject({ type: 'assistant_delta', payload: { delta: 'Background task completed.' } });
  });

  it('does not reinterpret a non-text sub-event message snapshot as text', () => {
    const m = mapper();
    m.map({ type: 'message_start', message: { role: 'assistant', content: [] } });

    const events = m.map({
      type: 'message_update',
      message: { role: 'assistant', content: [{ type: 'text', text: 'Already streamed.' }] },
      assistantMessageEvent: { type: 'toolcall_delta', delta: '{}' },
    });

    expect(events).toEqual([]);
  });

  it('falls back to a message snapshot when an update has no incremental sub-event', () => {
    const m = mapper();
    m.map({ type: 'message_start', message: { role: 'assistant', content: [] } });

    const events = m.map({
      type: 'message_update',
      message: { role: 'assistant', content: [{ type: 'text', text: 'Complete snapshot.' }] },
    });

    expect(events).toEqual([
      expect.objectContaining({
        type: 'assistant_delta',
        payload: expect.objectContaining({ delta: 'Complete snapshot.' }),
      }),
    ]);
  });

  it('emits text missing from incremental events before the assistant message ends', () => {
    const m = mapper();
    m.map({ type: 'message_start', message: { role: 'assistant', content: [] } });
    m.map({
      type: 'message_update',
      message: { role: 'assistant', content: [{ type: 'text', text: 'Partial' }] },
      assistantMessageEvent: { type: 'text_delta', delta: 'Partial' },
    });

    const events = m.map({
      type: 'message_end',
      message: { role: 'assistant', content: [{ type: 'text', text: 'Partial final answer' }] },
    });

    expect(events[0]).toMatchObject({
      type: 'assistant_delta',
      payload: { delta: ' final answer' },
    });
    expect(events.map((event) => event.type)).toEqual([
      'assistant_delta',
      'thinking_end',
      'assistant_message_end',
    ]);
  });

  it('preserves a text delta when the same update first publishes a review', () => {
    const m = mapper();
    m.map({ type: 'message_start', message: { role: 'assistant', content: [] } });

    const events = m.map({
      type: 'message_update',
      message: {
        role: 'assistant',
        content: [{ type: 'text', text: 'Complete answer.' }],
        metadata: { review: { type: 'review', status: 'complete' } },
      },
      assistantMessageEvent: { type: 'text_delta', delta: 'Complete answer.' },
    });

    expect(events.map((event) => event.type)).toEqual(['review', 'assistant_delta']);
    expect(events[1]).toMatchObject({ payload: { delta: 'Complete answer.' } });
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

  it('maps quiet memory consent and capture events', () => {
    const m = mapper();
    const [consent] = m.map({
      type: 'memory_consent_required',
      requests: [{ id: 'consent-1', recordId: 'memory-1', statement: 'Prefer concise answers.', purpose: 'Draft a reply' }],
    });
    const [captured] = m.map({
      type: 'memory_captured',
      records: [{ id: 'memory-2', content: 'Use pnpm.', kind: 'tool_preference' }],
    });
    expect(consent).toMatchObject({ type: 'memory_consent_required', payload: { requests: [{ id: 'consent-1' }] } });
    expect(captured).toMatchObject({ type: 'memory_captured', payload: { records: [{ id: 'memory-2' }] } });
  });

  it('maps memory candidates without activating them', () => {
    const m = mapper();
    const [candidate] = m.map({
      type: 'memory_candidate',
      records: [{ id: 'memory-3', content: 'Prefer concise updates.', kind: 'preference' }],
    });
    expect(candidate).toMatchObject({
      type: 'memory_candidate',
      payload: { records: [{ id: 'memory-3', content: 'Prefer concise updates.', kind: 'preference' }] },
    });
  });

  it('maps tool lifecycle', () => {
    const m = mapper();
    m.map({ type: 'message_start', message: { role: 'assistant', content: [] } });
    const [start] = m.map({ type: 'tool_execution_start', toolCallId: 'tc1', toolName: 'workflow', args: { step: 1 } });
    const [update] = m.map({ type: 'tool_execution_update', toolCallId: 'tc1', toolName: 'workflow', partialResult: { details: { phase: 'run' } } });
    const [end] = m.map({ type: 'tool_execution_end', toolCallId: 'tc1', toolName: 'workflow', isError: false, result: { content: [{ type: 'text', text: 'done' }], details: { phase: 'done' } } });

    expect(start).toMatchObject({
      type: 'tool_start',
      payload: {
        toolCallId: 'tc1',
        toolName: 'workflow',
        args: { step: 1 },
        activity: { category: 'other', action: 'use', status: 'running', source: 'unknown' },
      },
    });
    expect(update).toMatchObject({ type: 'tool_update', payload: { toolCallId: 'tc1', details: { phase: 'run' } } });
    expect(end).toMatchObject({
      type: 'tool_end',
      payload: {
        toolCallId: 'tc1',
        status: 'success',
        activity: { category: 'other', action: 'use', status: 'completed', source: 'unknown' },
        result: { text: 'done', details: { phase: 'done' } },
      },
    });
  });

  it('emits command-specific lifecycle events for exec_command', () => {
    const m = mapper();
    m.map({ type: 'message_start', message: { role: 'assistant', content: [] } });
    const start = m.map({ type: 'tool_execution_start', toolCallId: 'tc1', toolName: 'exec_command', args: { cmd: 'pnpm test', cwd: 'web' } });
    const update = m.map({
      type: 'tool_execution_update',
      toolCallId: 'tc1',
      toolName: 'exec_command',
      partialResult: { details: { kind: 'command_output_delta', stream: 'stdout', delta: 'ok' } },
    });
    const end = m.map({
      type: 'tool_execution_end',
      toolCallId: 'tc1',
      toolName: 'exec_command',
      isError: false,
      result: {
        content: [{ type: 'text', text: 'ok' }],
        details: { command: 'pnpm test', cwd: '/repo/web', exitCode: 0, durationMs: 42, timedOut: false, truncated: false },
      },
    });

    expect(start.map((event) => event.type)).toEqual(['tool_start', 'command_started']);
    expect(start[1]).toMatchObject({ payload: { command: 'pnpm test', cwd: 'web' } });
    expect(update.map((event) => event.type)).toEqual(['tool_update', 'command_output_delta']);
    expect(update[1]).toMatchObject({ payload: { stream: 'stdout', delta: 'ok' } });
    expect(end.map((event) => event.type)).toEqual(['tool_end', 'command_completed']);
    expect(end[1]).toMatchObject({ payload: { command: 'pnpm test', exitCode: 0, durationMs: 42 } });
  });

  it('emits patch_applied and turn_diff for apply_patch', () => {
    const m = mapper();
    m.map({ type: 'message_start', message: { role: 'assistant', content: [] } });
    const toolEnd = m.map({
      type: 'tool_execution_end',
      toolCallId: 'tc1',
      toolName: 'apply_patch',
      isError: false,
      result: {
        content: [{ type: 'text', text: 'updated' }],
        details: {
          changes: [{ kind: 'update', path: 'a.ts', added: 1, removed: 1, diff: '--- a.ts\n+++ a.ts\n-old\n+new' }],
          diff: '--- a.ts\n+++ a.ts\n-old\n+new',
          added: 1,
          removed: 1,
        },
      },
    });
    const messageEnd = m.map({ type: 'message_end', message: { role: 'assistant', content: [{ type: 'text', text: 'done' }] } });

    expect(toolEnd.map((event) => event.type)).toEqual(['tool_end', 'patch_applied']);
    expect(toolEnd[1]).toMatchObject({ payload: { added: 1, removed: 1 } });
    expect(messageEnd.map((event) => event.type)).toEqual(['assistant_delta', 'thinking_end', 'turn_diff', 'assistant_message_end']);
    expect(messageEnd[0]).toMatchObject({ type: 'assistant_delta', payload: { delta: 'done' } });
    expect(messageEnd[2]).toMatchObject({ type: 'turn_diff', payload: { files: ['a.ts'], added: 1, removed: 1 } });
  });

  it('emits turn_plan for update_plan', () => {
    const m = mapper();
    m.map({ type: 'message_start', message: { role: 'assistant', content: [] } });
    const events = m.map({
      type: 'tool_execution_end',
      toolCallId: 'tc1',
      toolName: 'update_plan',
      isError: false,
      result: {
        content: [{ type: 'text', text: 'plan updated' }],
        details: {
          explanation: 'P0 implementation',
          plan: [
            { step: 'Wire event', status: 'completed' },
            { step: 'Run review', status: 'in_progress' },
          ],
        },
      },
    });

    expect(events.map((event) => event.type)).toEqual([
      'tool_end',
      'turn_plan',
      'task_plan_updated',
    ]);
    expect(events[1]).toMatchObject({
      type: 'turn_plan',
      payload: {
        messageId: 'msg_run-1_1',
        explanation: 'P0 implementation',
        plan: [
          { step: 'Wire event', status: 'completed' },
          { step: 'Run review', status: 'in_progress' },
        ],
      },
    });
    expect(events[2]).toMatchObject({
      type: 'task_plan_updated',
      payload: {
        planId: 'msg_run-1_1:update_plan',
        revision: expect.any(Number),
        source: 'update_plan',
        scope: 'turn',
        items: [
          { id: 'step-1', title: 'Wire event', status: 'completed' },
          { id: 'step-2', title: 'Run review', status: 'in_progress' },
        ],
      },
    });
  });

  it('emits task_plan_updated for todo', () => {
    const m = mapper();
    m.map({ type: 'message_start', message: { role: 'assistant', content: [] } });
    const events = m.map({
      type: 'tool_execution_end',
      toolCallId: 'tc-todo',
      toolName: 'todo',
      isError: false,
      result: {
        content: [{ type: 'text', text: 'todo updated' }],
        details: {
          items: [
            { id: 'review', content: 'Review changes', status: 'in_progress' },
            { id: 'ship', content: 'Ship', status: 'pending' },
          ],
        },
      },
    });

    expect(events.map((event) => event.type)).toEqual(['tool_end', 'task_plan_updated']);
    expect(events[1]).toMatchObject({
      type: 'task_plan_updated',
      payload: {
        planId: 'sk:todo',
        revision: expect.any(Number),
        source: 'todo',
        scope: 'session',
        items: [
          { id: 'review', title: 'Review changes', status: 'in_progress' },
          { id: 'ship', title: 'Ship', status: 'pending' },
        ],
      },
    });
  });

  it('emits an empty todo snapshot when the list is cleared', () => {
    const m = mapper();
    m.map({ type: 'message_start', message: { role: 'assistant', content: [] } });
    const events = m.map({
      type: 'tool_execution_end',
      toolCallId: 'tc-todo-clear',
      toolName: 'todo',
      isError: false,
      result: {
        content: [{ type: 'text', text: 'todo cleared' }],
        details: { items: [] },
      },
    });

    expect(events).toHaveLength(2);
    expect(events[1]).toMatchObject({
      type: 'task_plan_updated',
      payload: {
        source: 'todo',
        items: [],
      },
    });
  });
});
