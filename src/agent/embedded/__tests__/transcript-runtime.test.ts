import { describe, expect, it } from 'vitest';

import { InMemoryTranscriptRuntime } from '../transcript-runtime.js';

describe('InMemoryTranscriptRuntime', () => {
  it('keeps a stable in-memory session manager across turns', async () => {
    const runtime = new InMemoryTranscriptRuntime({
      runtimeId: 'side:test',
      cwd: process.cwd(),
      initialMessages: [
        { role: 'user', content: 'parent context', timestamp: 1 },
        {
          role: 'assistant',
          content: [{ type: 'text', text: 'parent answer' }],
          stopReason: 'stop',
          usage: {
            input: 1,
            output: 1,
            cacheRead: 0,
            cacheWrite: 0,
            totalTokens: 2,
            cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
          },
          timestamp: 2,
        },
      ],
    });

    const first = runtime.openSessionManager(process.cwd());
    const second = runtime.openSessionManager(process.cwd());
    expect(second).toBe(first);
    expect(runtime.persistent).toBe(false);
    expect(await runtime.loadMessages()).toHaveLength(2);

    first.appendMessage({ role: 'user', content: 'side question', timestamp: 3 });
    expect((await runtime.loadMessages()).at(-1)).toMatchObject({
      role: 'user',
      content: 'side question',
    });
  });

  it('uses a distinct live session identity for every side runtime', () => {
    const a = new InMemoryTranscriptRuntime({ runtimeId: 'side:a', cwd: process.cwd() });
    const b = new InMemoryTranscriptRuntime({ runtimeId: 'side:b', cwd: process.cwd() });

    expect(a.runtimeId).not.toBe(b.runtimeId);
    expect(a.sessionId).not.toBe(b.sessionId);
  });
});
