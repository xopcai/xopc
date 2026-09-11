import { describe, expect, it, vi } from 'vitest';

import type { RealtimeEvent } from '../../../realtime/broker.js';
import type { SessionInput, SessionInputState } from '../../../storage/sqlite/session-input-repository.js';
import { DurableVoiceAgentBroker } from '../agentBroker.js';

function input(overrides: Partial<SessionInput> = {}): SessionInput {
  return {
    id: 'task-1', sessionKey: 'chat', clientMessageId: 'voice:session:turn',
    requestedDelivery: 'next', effectiveDelivery: 'next', status: 'running', content: 'hello',
    kind: 'message', origin: { type: 'channel', channel: 'voice' }, position: 1, runId: 'run-1',
    version: 1, createdAtMs: 1, updatedAtMs: 1, ...overrides,
  };
}

function event(type: string): RealtimeEvent {
  return {
    protocolVersion: 1, messageId: crypto.randomUUID(), kind: 'realtime.event', sentAt: Date.now(),
    payload: { topic: 'run:run-1', seq: 1, event: 'agent.event', data: { type } },
  } as RealtimeEvent;
}

function setup(options: { activeRunId?: string; row?: SessionInput } = {}) {
  const row = options.row ?? input();
  const state: SessionInputState = { sessionKey: 'chat', revision: 1, inputs: [row],
    ...(options.activeRunId ? { activeRunId: options.activeRunId } : {}) };
  const unsubscribe = vi.fn();
  const deps = {
    submit: vi.fn(async () => ({ ok: true as const, effectiveDelivery: options.activeRunId ? 'steer' as const : 'next' as const, state })),
    find: vi.fn(() => row), snapshot: vi.fn(() => state), currentSequence: vi.fn(() => 12),
    subscribe: vi.fn(() => ({ initial: [event('assistant_delta'), event('stream_end')], cursor: 2, unsubscribe })),
    cancelRun: vi.fn(async () => {}),
  };
  return { broker: new DurableVoiceAgentBroker(deps), deps, unsubscribe };
}

describe('DurableVoiceAgentBroker', () => {
  it('submits with a stable id and replays the assigned run', async () => {
    const { broker, deps } = setup();
    const controller = new AbortController();
    const task = await broker.delegate({ sessionKey: 'chat', expectedSessionId: 'session', turnId: 'turn', text: 'hello', signal: controller.signal });
    expect(deps.submit).toHaveBeenCalledWith(expect.objectContaining({
      clientMessageId: 'voice:session:turn', delivery: 'next',
      origin: { type: 'channel', channel: 'voice' },
    }));
    const types: string[] = [];
    for await (const value of task.events) types.push(value.type);
    expect(types).toEqual(['assistant_delta', 'stream_end']);
    expect(deps.subscribe).toHaveBeenCalledWith('run:run-1', 0, expect.any(Function));
    await expect(broker.cancel(task.taskId)).resolves.toBe(false);
  });

  it('steers an active run and starts after the current event cursor', async () => {
    const { broker, deps } = setup({ activeRunId: 'run-1', row: input({ runId: undefined, targetRunId: 'run-1', effectiveDelivery: 'steer' }) });
    const task = await broker.delegate({ sessionKey: 'chat', expectedSessionId: 'session', turnId: 'turn', text: 'hello', signal: new AbortController().signal });
    expect(deps.submit).toHaveBeenCalledWith(expect.objectContaining({ delivery: 'steer' }));
    expect(deps.currentSequence).toHaveBeenCalledWith('run:run-1');
    await task.events[Symbol.asyncIterator]().next();
    expect(deps.subscribe).toHaveBeenCalledWith('run:run-1', 12, expect.any(Function));
  });

  it('disconnect only detaches delivery while explicit task cancellation stops the run', async () => {
    const { broker, deps, unsubscribe } = setup();
    const controller = new AbortController();
    const task = await broker.delegate({ sessionKey: 'chat', expectedSessionId: 'session', turnId: 'turn', text: 'hello', signal: controller.signal });
    const iterator = task.events[Symbol.asyncIterator]();
    await iterator.next();
    controller.abort();
    await iterator.next();
    expect(unsubscribe).toHaveBeenCalledOnce();
    expect(deps.cancelRun).not.toHaveBeenCalled();
    await expect(broker.cancel(task.taskId)).resolves.toBe(true);
    expect(deps.cancelRun).toHaveBeenCalledWith('run-1');
  });
});
