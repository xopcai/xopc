import { describe, expect, it, vi } from 'vitest';
import type { AgentMessage } from '@earendil-works/pi-agent-core';

vi.mock('../../../providers/model-call.js', () => ({
  completeWithResolvedCredentials: vi.fn(async () => ({ role: 'assistant', content: [{ type: 'text',
    text: JSON.stringify({ items: [{ kind: 'tool_outcome', text: 'Review completed', status: 'completed', sourceSeqs: [1], identifiers: ['PR #8569'] }] }) }] })),
}));

import { InMemoryTranscriptRuntime } from '../transcript-runtime.js';
import { completeWithResolvedCredentials } from '../../../providers/model-call.js';

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
    expect(a.transcriptId).not.toBe(b.transcriptId);
  });
  it('retains the exact pending request and attachments through full compaction and a new turn', async () => {
    const pending = { role: 'user', content: [{ type: 'text', text: 'Review PR #8569' },
      { type: 'image', data: 'aGVsbG8=', mimeType: 'image/png' }], timestamp: 1 } as AgentMessage;
    const runtime = new InMemoryTranscriptRuntime({ runtimeId: 'side:recovery', cwd: process.cwd(), initialMessages: [pending] });
    const manager = runtime.openSessionManager(process.cwd());
    const original = manager.getBranch()[0];
    const result = await runtime.compact(await runtime.loadMessages(),
      { provider: 'test', id: 'summary', contextWindow: 128_000 } as any,
      undefined, true, { summarizeAll: true, preserveLastUser: true });
    expect(result.compacted).toBe(true);
    expect(await runtime.loadMessages()).toEqual(result.messages);
    expect((await runtime.loadMessages()).at(-1)).toEqual(pending);
    expect(result.summary).toContain('Review completed');
    expect(manager.getBranch()[0]).toEqual(original);
    manager.appendMessage({ role: 'user', content: 'Follow up', timestamp: 2 });
    expect((await runtime.loadMessages()).at(-1)).toMatchObject({ content: 'Follow up' });
  });

  it('supports a summary-only boundary without erasing the raw branch', async () => {
    const runtime = new InMemoryTranscriptRuntime({ runtimeId: 'side:summary', cwd: process.cwd(),
      initialMessages: [{ role: 'user', content: 'Review', timestamp: 1 }] });
    const result = await runtime.compact(await runtime.loadMessages(),
      { provider: 'test', id: 'summary', contextWindow: 128_000 } as any, undefined, true, { summarizeAll: true });
    expect(result.compacted).toBe(true);
    expect(await runtime.loadMessages()).toHaveLength(1);
    expect(runtime.openSessionManager(process.cwd()).getBranch().length).toBeGreaterThan(1);
  });

  it('rejects a stale in-memory compaction without discarding a concurrent message', async () => {
    const runtime = new InMemoryTranscriptRuntime({ runtimeId: 'side:race', cwd: process.cwd(),
      initialMessages: [{ role: 'user', content: 'Review', timestamp: 1 }] });
    const manager = runtime.openSessionManager(process.cwd());
    vi.mocked(completeWithResolvedCredentials).mockImplementationOnce(async () => {
      manager.appendMessage({ role: 'user', content: 'Concurrent update', timestamp: 2 });
      return { role: 'assistant', content: [{ type: 'text', text: JSON.stringify({ items: [
        { kind: 'current_state', text: 'Reviewing', status: 'active', sourceSeqs: [1], identifiers: [] },
      ] }) }] } as any;
    });
    await expect(runtime.compact(await runtime.loadMessages(),
      { provider: 'test', id: 'summary', contextWindow: 128_000 } as any,
      undefined, true, { summarizeAll: true })).rejects.toThrow('Session changed');
    expect((await runtime.loadMessages()).at(-1)).toMatchObject({ content: 'Concurrent update' });
    expect(manager.getBranch().some((entry) => entry.type === 'compaction')).toBe(false);
  });

});
