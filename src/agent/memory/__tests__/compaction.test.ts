import type { AgentMessage } from '@earendil-works/pi-agent-core';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../providers/model-call.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../providers/model-call.js')>();
  return { ...actual, completeWithResolvedCredentials: vi.fn() };
});

import { completeWithResolvedCredentials } from '../../../providers/model-call.js';
import { SessionCompactor } from '../compaction.js';

const model = {
  provider: 'test',
  id: 'summary-model',
  contextWindow: 128_000,
} as never;

function conversation(): AgentMessage[] {
  return Array.from({ length: 12 }, (_, index) => ({
    role: index % 2 === 0 ? 'user' : 'assistant',
    content: index === 0
      ? 'I am married, have two children, and am changing jobs.'
      : `message-${index}`,
    timestamp: index + 1,
  })) as AgentMessage[];
}

describe('SessionCompactor', () => {
  beforeEach(() => {
    vi.mocked(completeWithResolvedCredentials).mockReset();
  });

  it('uses the resolved session model and preserves complete recent turns', async () => {
    vi.mocked(completeWithResolvedCredentials).mockResolvedValueOnce({
      role: 'assistant',
      content: [{ type: 'text', text: 'The user is married, has two children, and is changing jobs.' }],
    } as never);
    const compactor = new SessionCompactor({
      minMessagesBeforeCompact: 4,
      keepRecentMessages: 2,
      retentionWindow: 1,
    });

    const result = await compactor.compact(conversation(), model, undefined, true);
    const compacted = compactor.applyCompaction(conversation(), result);

    expect(result).toMatchObject({ compacted: true, firstKeptIndex: 10 });
    expect(compacted).toHaveLength(3);
    expect(compacted.slice(1).map((message) => message.content)).toEqual(['message-10', 'message-11']);
    expect(JSON.stringify(compacted[0]?.content)).toContain('<conversation_summary>');
    expect(completeWithResolvedCredentials).toHaveBeenCalledWith(
      model,
      expect.objectContaining({
        messages: [expect.objectContaining({
          content: expect.stringContaining('I am married, have two children, and am changing jobs.'),
        })],
      }),
      expect.objectContaining({ maxTokens: 2000 }),
    );
  });

  it('does not persist derived droppable context in the compacted snapshot', async () => {
    vi.mocked(completeWithResolvedCredentials).mockResolvedValueOnce({
      role: 'assistant',
      content: [{ type: 'text', text: 'durable summary' }],
    } as never);
    const compactor = new SessionCompactor({
      minMessagesBeforeCompact: 4,
      keepRecentMessages: 2,
      retentionWindow: 1,
    });
    const messages = [
      ...conversation(),
      { role: 'user', content: '<coding_context>derived</coding_context>', timestamp: 13, droppable: true },
    ] as AgentMessage[];

    const result = await compactor.compact(messages, model, undefined, true);
    const compacted = compactor.applyCompaction(messages, result);

    expect(JSON.stringify(compacted)).not.toContain('<coding_context>');
  });

  it('fails closed when summary generation fails', async () => {
    vi.mocked(completeWithResolvedCredentials).mockRejectedValueOnce(new Error('model unavailable'));
    const compactor = new SessionCompactor({ minMessagesBeforeCompact: 4 });

    await expect(compactor.compact(conversation(), model, undefined, true)).rejects.toThrow(
      'model unavailable',
    );
  });
});
