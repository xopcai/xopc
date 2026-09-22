import { describe, expect, it, vi } from 'vitest';
import type { AgentMessage } from '@earendil-works/pi-agent-core';
import type { Api, Model } from '@earendil-works/pi-ai';

import { assessContext, recoverContext } from '../context-recovery.js';
import { resolveCompactionPolicy } from '../compaction-policy.js';
import type { CompactionResult } from '../compaction.js';
import { renderCompactionHandover } from '../compaction-ledger.js';

const model = { provider: 'test', id: 'test', contextWindow: 128_000 } as Model<Api>;
const user = (content: string) => ({ role: 'user', content, timestamp: 1 }) as AgentMessage;
const result = (compacted: boolean): CompactionResult => ({ compacted, messages: [user('summary')],
  summary: 'summary', firstKeptIndex: 1, tokensBefore: 150_000, tokensAfter: 20 });
function fixture(messages = [user('x'.repeat(650_000))]) {
  const transcript = { loadMessages: vi.fn(async () => messages), compact: vi.fn(async (..._args: unknown[]) => result(false)) };
  return { transcript, options: { conversationId: 'test', transcript, summaryModel: model,
    budget: { contextWindow: model.contextWindow }, policy: resolveCompactionPolicy() } };
}

describe('context recovery contract', () => {
  it('does not confuse the presence of a prunable result with fitting the budget', () => {
    const messages = [user('x'.repeat(600_000)), { role: 'toolResult', content: [{ type: 'text', text: 't'.repeat(2000) }] } as AgentMessage];
    const assessed = assessContext({ messages, contextWindow: 128_000, canCompact: false }, 2_000_000);
    expect(assessed.fits).toBe(false);
    expect(assessed.evaluation.estimatedTokens).toBeGreaterThan(assessed.evaluation.hardLimitTokens);
  });

  it('recovers fewer than the minimum messages through a bounded full-history fallback', async () => {
    const { transcript, options } = fixture();
    transcript.compact.mockResolvedValueOnce(result(false)).mockImplementationOnce(async () => {
      transcript.loadMessages.mockResolvedValue([user('summary')]);
      return result(true);
    });
    const recovered = await recoverContext(options);
    expect(recovered.status).toBe('compacted');
    expect(transcript.compact).toHaveBeenCalledTimes(2);
    expect(transcript.compact.mock.calls[1]?.[4]).toMatchObject({ summarizeAll: true });
  });

  it('does not retry indefinitely when the current input cannot fit', async () => {
    const { transcript, options } = fixture([user('short history')]);
    transcript.compact.mockResolvedValue(result(true));
    await expect(recoverContext({ ...options, budget: { ...options.budget,
      currentUserMessage: user('x'.repeat(650_000)) } })).rejects.toMatchObject({ code: 'unrecoverable' });
    expect(transcript.compact).toHaveBeenCalledTimes(2);
  });

  it('honors disabled compaction even for a provider rejection', async () => {
    const { transcript, options } = fixture([user('short')]);
    await expect(recoverContext({ ...options, policy: { ...options.policy, enabled: false }, providerRejected: true }))
      .rejects.toMatchObject({ code: 'disabled' });
    expect(transcript.compact).not.toHaveBeenCalled();
  });

  it('propagates cancellation before any mutation', async () => {
    const { transcript, options } = fixture();
    const controller = new AbortController();
    controller.abort(new Error('cancelled'));
    await expect(recoverContext({ ...options, signal: controller.signal })).rejects.toThrow('cancelled');
    expect(transcript.compact).not.toHaveBeenCalled();
  });

  it('stops after cancellation during ordinary compaction instead of escalating', async () => {
    const { transcript, options } = fixture();
    const controller = new AbortController();
    transcript.compact.mockImplementationOnce(async () => {
      controller.abort(new Error('cancelled during summary'));
      return result(false);
    });
    await expect(recoverContext({ ...options, signal: controller.signal })).rejects.toThrow('cancelled during summary');
    expect(transcript.compact).toHaveBeenCalledTimes(1);
  });

  it('escalates when ordinary compaction succeeds but retained history is still too large', async () => {
    const { transcript, options } = fixture();
    transcript.compact.mockResolvedValueOnce(result(true)).mockImplementationOnce(async () => {
      transcript.loadMessages.mockResolvedValue([user('summary')]);
      return result(true);
    });
    expect((await recoverContext(options)).status).toBe('compacted');
    expect(transcript.compact).toHaveBeenCalledTimes(2);
  });

  it('strips partial failed assistant output after reloading persisted messages', async () => {
    const { transcript, options } = fixture();
    transcript.compact.mockImplementationOnce(async () => {
      transcript.loadMessages.mockResolvedValue([user('pending'), {
        role: 'assistant', stopReason: 'error', content: [{ type: 'text', text: 'partial' }],
      } as AgentMessage]);
      return result(true);
    });
    const recovered = await recoverContext({ ...options, providerRejected: true, preserveLastUser: true });
    expect(recovered.messages.at(-1)?.role).toBe('user');
  });

  it('forces a short oversized tool turn through full-history fallback', async () => {
    const { transcript, options } = fixture([user('x'.repeat(420_000))]);
    transcript.compact.mockResolvedValueOnce(result(false)).mockImplementationOnce(async () => {
      transcript.loadMessages.mockResolvedValue([user('summary')]);
      return result(true);
    });
    const recovered = await recoverContext({ ...options, forceOnTrigger: true });
    expect(recovered.status).toBe('compacted');
    expect(transcript.compact).toHaveBeenCalledTimes(2);
    expect(transcript.compact.mock.calls[0]?.[3]).toBe(true);
    expect(transcript.compact.mock.calls[1]?.[4]).toMatchObject({ summarizeAll: true });
  });

  it('omits a discarded length attempt and its synthetic tool result from the recovered view', async () => {
    const messages = [user('pending'), {
      role: 'assistant', provider: 'test', model: 'test', timestamp: 2, stopReason: 'length',
      content: [{ type: 'toolCall', id: 'call-1', name: 'read', arguments: {} }],
    }, {
      role: 'toolResult', toolCallId: 'call-1', toolName: 'read', timestamp: 3,
      content: [{ type: 'text', text: 'synthetic failure' }],
    }] as AgentMessage[];
    const { transcript, options } = fixture(messages);
    transcript.compact.mockResolvedValue(result(true));
    const recovered = await recoverContext({
      ...options,
      providerRejected: true,
      discardedAttempt: { assistantTimestamp: 2, provider: 'test', model: 'test', toolCallIds: ['call-1'] },
    });
    expect(recovered.messages).toEqual([user('pending')]);
    expect(transcript.compact.mock.calls[0]?.[4]).toMatchObject({
      summarizeAll: true,
      discardedAttempt: expect.objectContaining({ assistantTimestamp: 2 }),
    });
  });

  it('preserves completed facts and identifiers without reopening completed todos', () => {
    const summary = renderCompactionHandover({ version: 1, sourceThroughSeq: 1, items: [
      { id: 'file', kind: 'file_change', status: 'completed', text: 'Patched auth', sources: [], identifiers: ['src/auth.ts'] },
      { id: 'test', kind: 'tool_outcome', status: 'completed', text: 'Tests passed', sources: [], identifiers: [] },
      { id: 'todo', kind: 'todo', status: 'completed', text: 'Run the tests', sources: [], identifiers: [] },
      { id: 'old', kind: 'decision', status: 'superseded', text: 'Obsolete decision', sources: [], identifiers: [] },
    ] });
    expect(summary).toContain('src/auth.ts');
    expect(summary).toContain('Tests passed');
    expect(summary).not.toContain('Run the tests');
    expect(summary).not.toContain('Obsolete decision');
  });
});
