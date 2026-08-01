import { describe, expect, it } from 'vitest';

import { AgentRunRelay } from '../agent-run-relay.js';

describe('AgentRunRelay', () => {
  it('adds runId and monotonically increasing seq to published events', async () => {
    const relay = new AgentRunRelay();
    relay.ensureRun('run-1', 'agent:main:main');

    const first = relay.publish('run-1', { type: 'status', status: 'accepted' });
    const second = relay.publish('run-1', { type: 'token', content: 'hi' });
    relay.complete('run-1');

    expect(first).toMatchObject({ type: 'status', runId: 'run-1', seq: 1 });
    expect(second).toMatchObject({ type: 'token', runId: 'run-1', seq: 2 });

    const replayed = [];
    for await (const event of relay.subscribe('run-1')) {
      replayed.push(event);
    }

    expect(replayed).toEqual([first, second]);
  });

  it('compacts old deltas while retaining lifecycle and newly published terminal events', async () => {
    const relay = new AgentRunRelay(8);
    relay.ensureRun('run-long', 'agent:main:main');
    relay.publish('run-long', { type: 'run_start' });
    relay.publish('run-long', { type: 'tool_start', payload: { toolCallId: 'tool-1' } });
    for (let index = 0; index < 12; index += 1) {
      relay.publish('run-long', {
        type: 'thinking_delta',
        payload: { delta: `${index}:${'x'.repeat(17_000)}` },
      });
    }
    const toolEnd = relay.publish('run-long', {
      type: 'tool_end',
      payload: { toolCallId: 'tool-1' },
    });
    const runEnd = relay.publish('run-long', { type: 'run_end' });
    relay.complete('run-long');

    const replayed = [];
    for await (const event of relay.subscribe('run-long')) {
      replayed.push(event);
    }

    expect(replayed.map((event) => event.type)).toEqual(expect.arrayContaining([
      'run_start',
      'tool_start',
      'tool_end',
      'run_end',
    ]));
    expect(replayed).toContainEqual(toolEnd);
    expect(replayed).toContainEqual(runEnd);
    expect(replayed.length).toBeLessThanOrEqual(8);
    expect(replayed.map((event) => event.seq)).toEqual(
      [...replayed.map((event) => event.seq)].sort((a, b) => Number(a) - Number(b)),
    );
  });

  it('keeps a live resume subscriber moving after compaction changes array indexes', async () => {
    const relay = new AgentRunRelay(4);
    relay.ensureRun('run-live', 'agent:main:main');
    relay.publish('run-live', { type: 'run_start' });
    const received: string[] = [];
    const consuming = (async () => {
      for await (const event of relay.subscribe('run-live')) {
        received.push(event.type);
      }
    })();

    await Promise.resolve();
    for (let index = 0; index < 8; index += 1) {
      relay.publish('run-live', { type: 'thinking_delta', payload: { delta: String(index) } });
      await Promise.resolve();
    }
    relay.publish('run-live', { type: 'tool_end' });
    relay.publish('run-live', { type: 'run_end' });
    relay.complete('run-live');
    await consuming;

    expect(received).toContain('tool_end');
    expect(received.at(-1)).toBe('run_end');
  });

  it('keeps terminal events resumable after a production-sized delta burst', async () => {
    const relay = new AgentRunRelay();
    relay.ensureRun('run-burst', 'agent:main:main');
    relay.publish('run-burst', { type: 'run_start' });
    for (let index = 0; index < 10_000; index += 1) {
      relay.publish('run-burst', {
        type: 'thinking_delta',
        payload: { delta: 'x' },
      });
    }
    relay.publish('run-burst', { type: 'tool_end' });
    relay.publish('run-burst', { type: 'run_end' });
    relay.complete('run-burst');

    let replayedCount = 0;
    let replayedDeltaChars = 0;
    let sawToolEnd = false;
    let sawRunEnd = false;
    for await (const event of relay.subscribe('run-burst')) {
      replayedCount += 1;
      if (event.type === 'thinking_delta') {
        const payload = event.payload as { delta?: unknown };
        if (typeof payload.delta === 'string') replayedDeltaChars += payload.delta.length;
      }
      sawToolEnd ||= event.type === 'tool_end';
      sawRunEnd ||= event.type === 'run_end';
    }

    expect(replayedCount).toBeLessThan(10);
    expect(replayedDeltaChars).toBe(10_000);
    expect(sawToolEnd).toBe(true);
    expect(sawRunEnd).toBe(true);
  });

  it('does not mutate events already returned to the initial stream when replay deltas merge', () => {
    const relay = new AgentRunRelay();
    relay.ensureRun('run-immutable', 'agent:main:main');
    const first = relay.publish('run-immutable', {
      type: 'thinking_delta',
      payload: { messageId: 'message-1', delta: 'first' },
    });
    relay.publish('run-immutable', {
      type: 'thinking_delta',
      payload: { messageId: 'message-1', delta: 'second' },
    });

    expect(first?.payload).toEqual({ messageId: 'message-1', delta: 'first' });
  });
});
