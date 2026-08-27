import type { AgentMessage } from '@earendil-works/pi-agent-core';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../providers/model-call.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../providers/model-call.js')>();
  return { ...actual, completeWithResolvedCredentials: vi.fn() };
});

import { completeWithResolvedCredentials } from '../../../providers/model-call.js';
import type { XopcTranscriptCompactionEntry } from '../../../session/session-context-for-llm.js';
import type { TranscriptSourceEntry } from '../../../storage/sqlite/transcript-repository.js';
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

function sources(rows: AgentMessage[], startSeq = 1): TranscriptSourceEntry[] {
  return rows.map((row, index) => ({
    entryId: `entry-${startSeq + index}`,
    seq: startSeq + index,
    createdAt: startSeq + index,
    row,
  }));
}

function ledger(seq = 1, text = 'The job change is ongoing.'): string {
  return JSON.stringify({
    items: [{
      kind: 'current_state',
      text,
      status: 'active',
      sourceSeqs: [seq],
      identifiers: [],
    }],
  });
}

function completion(text: string) {
  return {
    role: 'assistant',
    content: [{ type: 'text', text }],
  } as never;
}

describe('SessionCompactor', () => {
  beforeEach(() => {
    vi.mocked(completeWithResolvedCredentials).mockReset();
  });

  it('builds a cited handover from raw transcript entries and preserves recent turns', async () => {
    vi.mocked(completeWithResolvedCredentials).mockResolvedValueOnce(completion(ledger()));
    const compactor = new SessionCompactor({
      minMessagesBeforeCompact: 4,
      keepRecentTokens: 1,
      recentTurnsPreserve: 1,
    });

    const result = await compactor.compact(sources(conversation()), model, undefined, true);

    expect(result).toMatchObject({ compacted: true, plannerVersion: 3, firstKeptIndex: 10 });
    expect(result.messages).toHaveLength(3);
    expect(result.messages.slice(1).map((message) => message.content)).toEqual(['message-10', 'message-11']);
    expect(JSON.stringify(result.messages[0]?.content)).toContain('<conversation_summary>');
    expect(result.handover?.items[0]?.sources).toEqual([{ entryId: 'entry-1', seq: 1 }]);
    expect(completeWithResolvedCredentials).toHaveBeenCalledWith(
      model,
      expect.objectContaining({
        systemPrompt: expect.stringContaining('Return JSON only'),
        messages: [expect.objectContaining({
          content: expect.stringContaining('<record seq="1" entry_id="entry-1">'),
        })],
      }),
      expect.objectContaining({ maxTokens: 2000, reasoning: 'low' }),
    );
  });

  it('preserves old facts across repeated compactions while reading only new raw deltas', async () => {
    vi.mocked(completeWithResolvedCredentials)
      .mockResolvedValueOnce(completion(JSON.stringify({
        items: [
          { kind: 'decision', text: 'Keep the existing plan.', status: 'active', sourceSeqs: [1], identifiers: [] },
          { kind: 'current_state', text: 'New work is underway.', status: 'active', sourceSeqs: [14], identifiers: [] },
        ],
      })))
      .mockResolvedValueOnce(completion(JSON.stringify({
        items: [
          { kind: 'decision', text: 'Keep the existing plan.', status: 'active', sourceSeqs: [1], identifiers: [] },
          { kind: 'current_state', text: 'New work is underway.', status: 'active', sourceSeqs: [14], identifiers: [] },
          { kind: 'next_action', text: 'Finish the final verification.', status: 'active', sourceSeqs: [19], identifiers: [] },
        ],
      })));
    const original = sources(conversation());
    const boundary: XopcTranscriptCompactionEntry = {
      type: 'compaction',
      at: '2026-08-27T00:00:00.000Z',
      baseSeq: 12,
      plannerVersion: 3,
      summaryModelRef: 'test/model',
      qualityAudit: 'passed',
      handover: {
        version: 1,
        sourceThroughSeq: 10,
        items: [{
          id: 'old-item',
          kind: 'decision',
          text: 'Keep the existing plan.',
          status: 'active',
          sources: [{ entryId: 'entry-1', seq: 1 }],
          identifiers: [],
        }],
      },
      audit: { status: 'passed', mode: 'structural', missingItemsFound: 0, repaired: false },
      summary: 'old summary',
      messages: [],
      firstKeptIndex: 10,
      tokensBefore: 100,
      tokensAfter: 20,
    };
    const entries: TranscriptSourceEntry[] = [
      ...original,
      { entryId: 'boundary-13', seq: 13, createdAt: 13, row: boundary },
      ...sources([
        { role: 'user', content: 'new work' } as AgentMessage,
        { role: 'assistant', content: 'started' } as AgentMessage,
        { role: 'user', content: 'latest question' } as AgentMessage,
        { role: 'assistant', content: 'latest answer' } as AgentMessage,
      ], 14),
    ];
    const compactor = new SessionCompactor({
      keepRecentTokens: 1,
      recentTurnsPreserve: 1,
      gapAudit: false,
    });

    const result = await compactor.compact(entries, model, undefined, true);
    const prompt = String(vi.mocked(completeWithResolvedCredentials).mock.calls[0]?.[1].messages[0]?.content);

    expect(prompt).toContain('Keep the existing plan.');
    expect(prompt).toContain('<record seq="14"');
    expect(prompt).not.toContain('<record seq="1"');
    expect(result.handover?.previousBoundaryId).toBe('boundary-13');

    const secondBoundary: XopcTranscriptCompactionEntry = {
      type: 'compaction',
      at: '2026-08-27T01:00:00.000Z',
      baseSeq: 17,
      plannerVersion: 3,
      summaryModelRef: result.summaryModelRef!,
      qualityAudit: result.qualityAudit!,
      handover: result.handover!,
      audit: result.audit!,
      summary: result.summary,
      messages: result.messages,
      firstKeptIndex: result.firstKeptIndex,
      tokensBefore: result.tokensBefore,
      tokensAfter: result.tokensAfter,
    };
    const thirdPassEntries: TranscriptSourceEntry[] = [
      ...entries,
      { entryId: 'boundary-18', seq: 18, createdAt: 18, row: secondBoundary },
      ...sources([
        { role: 'user', content: 'final verification' } as AgentMessage,
        { role: 'assistant', content: 'in progress' } as AgentMessage,
        { role: 'user', content: 'latest follow-up' } as AgentMessage,
        { role: 'assistant', content: 'noted' } as AgentMessage,
      ], 19),
    ];

    const repeated = await compactor.compact(thirdPassEntries, model, undefined, true);
    const repeatedPrompt = String(
      vi.mocked(completeWithResolvedCredentials).mock.calls[1]?.[1].messages[0]?.content,
    );

    expect(repeatedPrompt).toContain('Keep the existing plan.');
    expect(repeatedPrompt).toContain('<record seq="19"');
    expect(repeatedPrompt).not.toContain('<record seq="1"');
    expect(repeated.summary).toContain('Keep the existing plan.');
    expect(repeated.summary).toContain('Finish the final verification.');
  });

  it('repairs invalid JSON or unavailable source citations once', async () => {
    vi.mocked(completeWithResolvedCredentials)
      .mockResolvedValueOnce(completion(ledger(999)))
      .mockResolvedValueOnce(completion(ledger(1)));
    const compactor = new SessionCompactor({
      minMessagesBeforeCompact: 4,
      keepRecentTokens: 1,
      recentTurnsPreserve: 1,
      summaryRetries: 0,
    });

    const result = await compactor.compact(sources(conversation()), model, undefined, true);

    expect(result.audit).toMatchObject({ status: 'passed', repaired: true });
    expect(completeWithResolvedCredentials).toHaveBeenCalledTimes(2);
    expect(vi.mocked(completeWithResolvedCredentials).mock.calls[1]?.[1].messages[0]?.content)
      .toContain('Allowed source sequence numbers');
  });

  it('runs an independent gap audit for risky source records and merges omissions', async () => {
    const rows = conversation();
    rows[0] = { role: 'user', content: 'Please update /tmp/release-plan.md before replying.' } as AgentMessage;
    vi.mocked(completeWithResolvedCredentials)
      .mockResolvedValueOnce(completion(ledger(1, 'The release plan is being updated.')))
      .mockResolvedValueOnce(completion(JSON.stringify({
        items: [
          {
            kind: 'current_state',
            text: 'The release plan is being updated.',
            status: 'active',
            sourceSeqs: [1],
            identifiers: ['/tmp/release-plan.md'],
          },
          {
            kind: 'pending_user_ask',
            text: 'Update /tmp/release-plan.md before replying.',
            status: 'active',
            sourceSeqs: [1],
            identifiers: ['/tmp/release-plan.md'],
          },
        ],
      })));
    const compactor = new SessionCompactor({
      minMessagesBeforeCompact: 4,
      keepRecentTokens: 1,
      recentTurnsPreserve: 1,
      summaryRetries: 0,
    });

    const result = await compactor.compact(sources(rows), model, undefined, true);

    expect(result.audit).toMatchObject({
      status: 'passed',
      mode: 'risk',
      missingItemsFound: 1,
      repaired: true,
      auditModelRef: 'test/summary-model',
    });
    expect(result.summary).toContain('Update /tmp/release-plan.md before replying.');
    expect(completeWithResolvedCredentials).toHaveBeenCalledTimes(2);
  });

  it('keeps a valid handover and marks the audit degraded when the second pass fails', async () => {
    const rows = conversation();
    rows[0] = { role: 'user', content: 'Inspect /tmp/failure.log.' } as AgentMessage;
    vi.mocked(completeWithResolvedCredentials)
      .mockResolvedValueOnce(completion(ledger()))
      .mockRejectedValueOnce(new Error('auditor unavailable'));
    const compactor = new SessionCompactor({
      minMessagesBeforeCompact: 4,
      keepRecentTokens: 1,
      recentTurnsPreserve: 1,
      summaryRetries: 0,
    });

    const result = await compactor.compact(sources(rows), model, undefined, true);

    expect(result.compacted).toBe(true);
    expect(result.audit).toMatchObject({ status: 'degraded', mode: 'risk' });
    expect(result.summary).toContain('The job change is ongoing.');
  });

  it('processes every fragment of an oversized record without a middle omission', async () => {
    vi.mocked(completeWithResolvedCredentials).mockImplementation(async () => completion(ledger(1)));
    const entries = sources([
      { role: 'user', content: `start-${'x'.repeat(22_000)}-end` } as AgentMessage,
      { role: 'assistant', content: 'ack' } as AgentMessage,
      { role: 'user', content: 'keep this turn' } as AgentMessage,
      { role: 'assistant', content: 'kept' } as AgentMessage,
    ]);
    const compactor = new SessionCompactor({
      minMessagesBeforeCompact: 2,
      keepRecentTokens: 1,
      recentTurnsPreserve: 1,
      summaryChunkTokens: 2_000,
    });

    const result = await compactor.compact(entries, model, undefined, true);
    const prompts = vi.mocked(completeWithResolvedCredentials).mock.calls
      .map((call) => String(call[1].messages[0]?.content));

    expect(result.compacted).toBe(true);
    expect(prompts.length).toBeGreaterThan(2);
    expect(prompts.join('')).toContain('start-');
    expect(prompts.join('')).toContain('-end');
    expect(prompts.join('')).not.toContain('omitted');
  });

  it('fails closed and then uses a fallback model when configured', async () => {
    vi.mocked(completeWithResolvedCredentials)
      .mockRejectedValueOnce(new Error('primary unavailable'))
      .mockResolvedValueOnce(completion(ledger()));
    const fallback = { provider: 'fallback', id: 'handover-model', contextWindow: 128_000 } as never;
    const compactor = new SessionCompactor({
      minMessagesBeforeCompact: 4,
      keepRecentTokens: 1,
      recentTurnsPreserve: 1,
      summaryRetries: 0,
    });

    const result = await compactor.compact(sources(conversation()), model, undefined, true, {
      fallbackModels: [fallback],
    });

    expect(result.compacted).toBe(true);
    expect(result.summaryModelRef).toBe('fallback/handover-model');
  });

  it('preserves provider errors when generation fails', async () => {
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

    await expect(compactor.compact(sources(conversation()), model, undefined, true)).rejects.toThrow(
      'OAuth token expired',
    );
  });

  it('refuses to split a single active user and tool turn', async () => {
    const compactor = new SessionCompactor({ minMessagesBeforeCompact: 2 });
    const entries = sources([
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
    ] as AgentMessage[]);

    const result = await compactor.compact(entries, model, undefined, true);

    expect(result.compacted).toBe(false);
    expect(completeWithResolvedCredentials).not.toHaveBeenCalled();
  });
});
