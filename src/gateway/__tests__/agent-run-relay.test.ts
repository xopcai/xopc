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
});
