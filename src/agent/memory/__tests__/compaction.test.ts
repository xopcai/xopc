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

const structuredSummary = `## Decisions
The user is married, has two children, and is changing jobs.
## Pending user asks
None
## Open TODOs
None
## Constraints and rules
None
## Exact identifiers
None
## Tool operations and results
None
## Recent state
The job change is ongoing.`;

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
      content: [{ type: 'text', text: structuredSummary }],
    } as never);
    const compactor = new SessionCompactor({
      minMessagesBeforeCompact: 4,
      keepRecentTokens: 1,
      recentTurnsPreserve: 1,
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
      expect.objectContaining({ maxTokens: 2000, reasoning: 'low' }),
    );
  });

  it('does not persist derived droppable context in the compacted snapshot', async () => {
    vi.mocked(completeWithResolvedCredentials).mockResolvedValueOnce({
      role: 'assistant',
      content: [{ type: 'text', text: structuredSummary }],
    } as never);
    const compactor = new SessionCompactor({
      minMessagesBeforeCompact: 4,
      keepRecentTokens: 1,
      recentTurnsPreserve: 1,
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
    const compactor = new SessionCompactor({
      minMessagesBeforeCompact: 4,
      keepRecentTokens: 1,
      recentTurnsPreserve: 1,
      summaryRetries: 0,
      qualityGuard: false,
    });

    await expect(compactor.compact(conversation(), model, undefined, true)).rejects.toThrow(
      'model unavailable',
    );
  });

  it('preserves the provider error when a completion returns no content', async () => {
    vi.mocked(completeWithResolvedCredentials).mockResolvedValueOnce({
      role: 'assistant',
      content: [],
      stopReason: 'error',
      errorMessage: 'OAuth token expired',
      usage: { output: 0 },
    } as never);
    const compactor = new SessionCompactor({
      minMessagesBeforeCompact: 4,
      keepRecentTokens: 1,
      recentTurnsPreserve: 1,
      summaryRetries: 0,
      qualityGuard: false,
    });

    await expect(compactor.compact(conversation(), model, undefined, true)).rejects.toThrow(
      'Compaction model request failed (stopReason=error, rawStopReason=unknown, contentTypes=none, outputTokens=0, reasoningTokens=unknown): OAuth token expired',
    );
  });

  it('uses a fallback model when the primary summarizer fails', async () => {
    vi.mocked(completeWithResolvedCredentials)
      .mockRejectedValueOnce(new Error('primary unavailable'))
      .mockResolvedValueOnce({
        role: 'assistant',
        content: [{ type: 'text', text: structuredSummary }],
      } as never);
    const fallback = { provider: 'fallback', id: 'summary-fallback', contextWindow: 128_000 } as never;
    const compactor = new SessionCompactor({
      minMessagesBeforeCompact: 4,
      keepRecentTokens: 1,
      recentTurnsPreserve: 1,
      summaryRetries: 0,
    });

    const result = await compactor.compact(conversation(), model, undefined, true, {
      fallbackModels: [fallback],
    });

    expect(result.compacted).toBe(true);
    expect(completeWithResolvedCredentials).toHaveBeenNthCalledWith(
      2,
      fallback,
      expect.anything(),
      expect.anything(),
    );
  });

  it('repairs a summary that fails the structured quality contract', async () => {
    vi.mocked(completeWithResolvedCredentials)
      .mockResolvedValueOnce({
        role: 'assistant',
        content: [{ type: 'text', text: 'A short but unstructured summary.' }],
      } as never)
      .mockResolvedValueOnce({
        role: 'assistant',
        content: [{ type: 'text', text: structuredSummary }],
      } as never);
    const compactor = new SessionCompactor({
      minMessagesBeforeCompact: 4,
      keepRecentTokens: 1,
      recentTurnsPreserve: 1,
      summaryRetries: 0,
    });

    const result = await compactor.compact(conversation(), model, undefined, true);

    expect(result.summary).toBe(structuredSummary);
    expect(completeWithResolvedCredentials).toHaveBeenCalledTimes(2);
    expect(vi.mocked(completeWithResolvedCredentials).mock.calls[1]?.[1]).toEqual(
      expect.objectContaining({
        systemPrompt: expect.stringContaining('durable continuation summary'),
        messages: [expect.objectContaining({ content: expect.stringContaining('Quality failures:') })],
      }),
    );
    expect(vi.mocked(completeWithResolvedCredentials).mock.calls[0]?.[2]).toEqual(
      expect.objectContaining({ sessionId: 'xopc-compaction-v3' }),
    );
  });

  it('deterministically completes the quality contract when model repair remains incomplete', async () => {
    const incompleteRepair = `## Decisions
Keep the benchmark results.
## Pending user asks
None
## Open TODOs
None
## Constraints and rules
None
## Exact identifiers
None`;
    vi.mocked(completeWithResolvedCredentials)
      .mockResolvedValueOnce({
        role: 'assistant',
        content: [{ type: 'text', text: incompleteRepair }],
      } as never)
      .mockResolvedValueOnce({
        role: 'assistant',
        content: [{ type: 'text', text: incompleteRepair }],
      } as never);
    const messages = conversation();
    messages[0] = {
      role: 'user',
      content: 'Inspect /run/123/logs before deploying release/1.2.',
      timestamp: 1,
    } as AgentMessage;
    const compactor = new SessionCompactor({
      minMessagesBeforeCompact: 4,
      keepRecentTokens: 1,
      recentTurnsPreserve: 1,
      summaryRetries: 0,
    });

    const result = await compactor.compact(messages, model, undefined, true);

    expect(result.summary).toContain('## Tool operations and results\nNone');
    expect(result.summary).toContain('## Recent state\nNone');
    expect(result.summary).toContain('- `/run/123/logs`');
    expect(result.summary).toContain('- `release/1.2`');
    expect(result.summary).not.toContain('## Exact identifiers\nNone');
    expect(result.qualityAudit).toBe('passed');
    expect(completeWithResolvedCredentials).toHaveBeenCalledTimes(2);
  });

  it('refuses to split a single active user/tool turn during forced compaction', async () => {
    const compactor = new SessionCompactor({ minMessagesBeforeCompact: 2 });
    const messages = [
      { role: 'user', content: 'Run the tool', timestamp: 1 },
      {
        role: 'assistant',
        content: [{ type: 'toolCall', id: 'call-1', name: 'work', arguments: {} }],
        timestamp: 2,
      },
      {
        role: 'toolResult',
        toolCallId: 'call-1',
        toolName: 'work',
        content: [{ type: 'text', text: 'done' }],
        isError: false,
        timestamp: 3,
      },
    ] as AgentMessage[];

    const result = await compactor.compact(messages, model, undefined, true);

    expect(result.compacted).toBe(false);
    expect(completeWithResolvedCredentials).not.toHaveBeenCalled();
  });
});
