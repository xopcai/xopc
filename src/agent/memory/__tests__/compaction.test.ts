import type { Api, Model } from '@earendil-works/pi-ai/compat';
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
  maxTokens: 16_000,
  reasoning: true,
} as Model<Api>;

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
    upserts: [{
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
      expect.objectContaining({ maxTokens: 4000 }),
    );
    expect(vi.mocked(completeWithResolvedCredentials).mock.calls[0]?.[2]).not.toHaveProperty('reasoning');
  });

  it('only enables low reasoning when explicitly configured', async () => {
    vi.mocked(completeWithResolvedCredentials).mockResolvedValueOnce(completion(ledger()));
    await new SessionCompactor({
      minMessagesBeforeCompact: 4,
      keepRecentTokens: 1,
      recentTurnsPreserve: 1,
      reasoningLevel: 'low',
      gapAudit: false,
    }).compact(sources(conversation()), model, undefined, true);

    expect(vi.mocked(completeWithResolvedCredentials).mock.calls[0]?.[2]).toMatchObject({
      reasoning: 'low',
    });
  });

  it('preserves old facts across repeated compactions while reading only new raw deltas', async () => {
    vi.mocked(completeWithResolvedCredentials)
      .mockResolvedValueOnce(completion(JSON.stringify({
        upserts: [
          { kind: 'current_state', text: 'New work is underway.', status: 'active', sourceSeqs: [14], identifiers: [] },
        ],
      })))
      .mockResolvedValueOnce(completion(JSON.stringify({
        upserts: [
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

    const stalled = await compactor.compact([
      ...entries,
      { entryId: 'boundary-18', seq: 18, createdAt: 18, row: secondBoundary },
    ], model, undefined, true);
    expect(stalled.compacted).toBe(false);
    expect(completeWithResolvedCredentials).toHaveBeenCalledTimes(1);

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
    const repair = String(vi.mocked(completeWithResolvedCredentials).mock.calls[1]?.[1].messages[0]?.content);
    expect(repair).toContain('<record seq="1"');
    expect(repair).toContain('I am married, have two children');
    expect(repair).toContain('Current ledger:');
  });

  it('runs an independent gap audit for risky source records and merges omissions', async () => {
    const rows = conversation();
    rows[0] = { role: 'user', content: 'Please update /tmp/release-plan.md before replying.' } as AgentMessage;
    vi.mocked(completeWithResolvedCredentials)
      .mockResolvedValueOnce(completion(ledger(1, 'The release plan is being updated.')))
      .mockResolvedValueOnce(completion(JSON.stringify({
        upserts: [
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

  it('resumes from the last durable chunk checkpoint after an interrupted compaction', async () => {
    let stored: unknown;
    const checkpoint = {
      load: vi.fn(() => stored),
      save: vi.fn((value) => { stored = value; }),
      clear: vi.fn(() => { stored = undefined; }),
    };
    const entries = sources([
      { role: 'user', content: `BEGIN-${'x'.repeat(22_000)}-END` } as AgentMessage,
      { role: 'assistant', content: 'ack' } as AgentMessage,
      { role: 'user', content: 'keep this turn' } as AgentMessage,
      { role: 'assistant', content: 'kept' } as AgentMessage,
    ]);
    const compactor = new SessionCompactor({
      minMessagesBeforeCompact: 2,
      keepRecentTokens: 1,
      recentTurnsPreserve: 1,
      summaryChunkTokens: 2_000,
      summaryRetries: 0,
      gapAudit: false,
    });
    vi.mocked(completeWithResolvedCredentials)
      .mockResolvedValueOnce(completion(ledger(1)))
      .mockRejectedValueOnce(new Error('gateway restarted'));

    await expect(compactor.compact(entries, model, undefined, true, { checkpoint }))
      .rejects.toThrow('gateway restarted');
    expect(checkpoint.save).toHaveBeenCalledTimes(1);

    vi.mocked(completeWithResolvedCredentials).mockReset();
    vi.mocked(completeWithResolvedCredentials).mockResolvedValue(completion(ledger(1)));
    const result = await compactor.compact(entries, model, undefined, true, { checkpoint });
    const resumedPrompts = vi.mocked(completeWithResolvedCredentials).mock.calls
      .map((call) => String(call[1].messages[0]?.content));

    expect(result.compacted).toBe(true);
    expect(resumedPrompts.join('')).not.toContain('BEGIN-');
    expect(resumedPrompts.join('')).toContain('-END');
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

  it.each([
    [],
    [{ type: 'thinking', thinking: 'private reasoning' }],
    [{ type: 'text', text: '{"upserts":[' }],
    [{ type: 'text', text: ledger() }],
  ].map((content) => ({ content })))('regenerates every length response with more budget, never repairing it ($content)', async ({ content }) => {
    vi.mocked(completeWithResolvedCredentials)
      .mockResolvedValueOnce({ content, stopReason: 'length', usage: { output: 4_000, reasoning: 0 } } as never)
      .mockResolvedValueOnce(completion(ledger()));
    const compactor = new SessionCompactor({ keepRecentTokens: 1, recentTurnsPreserve: 1, gapAudit: false });
    expect((await compactor.compact(sources(conversation()), model, undefined, true)).compacted).toBe(true);
    const calls = vi.mocked(completeWithResolvedCredentials).mock.calls;
    expect(calls.map((call) => call[2]?.maxTokens)).toEqual([4_000, 8_000]);
    expect(calls[1]?.[1].messages[0]?.content).toEqual(calls[0]?.[1].messages[0]?.content);
  });

  it('stops length retries at the configured cap and switches to the fallback', async () => {
    vi.mocked(completeWithResolvedCredentials)
      .mockResolvedValueOnce({ content: [], stopReason: 'length' } as never)
      .mockResolvedValueOnce(completion(ledger()));
    const fallback = { ...model, id: 'fallback' };
    const compactor = new SessionCompactor({ summaryMaxTokens: 2_000, keepRecentTokens: 1, recentTurnsPreserve: 1, gapAudit: false });
    const result = await compactor.compact(sources(conversation()), model, undefined, true, { fallbackModels: [fallback, model] });
    expect(result.summaryModelRef).toBe('test/fallback');
    expect(vi.mocked(completeWithResolvedCredentials).mock.calls.map((call) => call[2]?.maxTokens)).toEqual([2_000, 2_000]);
  });

  it('honors the model cap and fails without retrying the same truncated request', async () => {
    vi.mocked(completeWithResolvedCredentials).mockResolvedValue({ content: [], stopReason: 'length' } as never);
    const compactor = new SessionCompactor({ keepRecentTokens: 1, recentTurnsPreserve: 1 });
    await expect(compactor.compact(sources(conversation()), { ...model, maxTokens: 3_000 }, undefined, true))
      .rejects.toThrow('truncated');
    expect(completeWithResolvedCredentials).toHaveBeenCalledTimes(1);
    expect(vi.mocked(completeWithResolvedCredentials).mock.calls[0]?.[2]?.maxTokens).toBe(3_000);
  });

  it('retries an empty normal response without changing the budget', async () => {
    vi.mocked(completeWithResolvedCredentials)
      .mockResolvedValueOnce({ content: [], stopReason: 'stop' } as never)
      .mockResolvedValueOnce(completion(ledger()));
    await new SessionCompactor({ keepRecentTokens: 1, recentTurnsPreserve: 1, gapAudit: false })
      .compact(sources(conversation()), model, undefined, true);
    expect(vi.mocked(completeWithResolvedCredentials).mock.calls.map((call) => call[2]?.maxTokens)).toEqual([4_000, 4_000]);
  });

  it('does not retry permanent authentication failures', async () => {
    vi.mocked(completeWithResolvedCredentials).mockResolvedValue({ content: [], stopReason: 'error', errorMessage: '401 Unauthorized' } as never);
    await expect(new SessionCompactor({ keepRecentTokens: 1, recentTurnsPreserve: 1 })
      .compact(sources(conversation()), model, undefined, true)).rejects.toThrow('401 Unauthorized');
    expect(completeWithResolvedCredentials).toHaveBeenCalledTimes(1);
  });

  it('does not grow a request when the adapter already reduced its output budget', async () => {
    vi.mocked(completeWithResolvedCredentials).mockImplementation(async (_model, _context, options) => {
      await options?.onPayload?.({ max_completion_tokens: 1_000 }, model);
      return { content: [], stopReason: 'length' } as never;
    });
    await expect(new SessionCompactor({ keepRecentTokens: 1, recentTurnsPreserve: 1 })
      .compact(sources(conversation()), model, undefined, true)).rejects.toThrow('truncated');
    expect(completeWithResolvedCredentials).toHaveBeenCalledTimes(1);
  });

  it('retries transient transport failures within the existing attempt count', async () => {
    vi.mocked(completeWithResolvedCredentials)
      .mockRejectedValueOnce(new Error('ECONNRESET'))
      .mockResolvedValueOnce(completion(ledger()));
    await new SessionCompactor({ keepRecentTokens: 1, recentTurnsPreserve: 1, gapAudit: false })
      .compact(sources(conversation()), model, undefined, true);
    expect(completeWithResolvedCredentials).toHaveBeenCalledTimes(2);
  });

  it('times out an attempt and uses the fallback', async () => {
    vi.useFakeTimers();
    try {
      vi.mocked(completeWithResolvedCredentials)
        .mockImplementationOnce(async (_model, _context, options) => new Promise((_resolve, reject) => {
          options?.signal?.addEventListener('abort', () => reject(options.signal?.reason), { once: true });
        }))
        .mockResolvedValueOnce(completion(ledger()));
      const task = new SessionCompactor({ summaryTimeoutMs: 1_000, summaryRetries: 0, keepRecentTokens: 1, recentTurnsPreserve: 1, gapAudit: false })
        .compact(sources(conversation()), model, undefined, true, { fallbackModels: [{ ...model, id: 'fallback' }] });
      await vi.advanceTimersByTimeAsync(1_000);
      expect((await task).summaryModelRef).toBe('test/fallback');
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it('stops during retry backoff when the parent is cancelled', async () => {
    vi.useFakeTimers();
    try {
      const controller = new AbortController();
      const reason = new Error('cancelled');
      vi.mocked(completeWithResolvedCredentials).mockRejectedValue(new Error('ECONNRESET'));
      const task = new SessionCompactor({ keepRecentTokens: 1, recentTurnsPreserve: 1 })
        .compact(sources(conversation()), model, undefined, true, { signal: controller.signal, fallbackModels: [{ ...model, id: 'fallback' }] });
      const rejected = expect(task).rejects.toBe(reason);
      await vi.advanceTimersByTimeAsync(0);
      controller.abort(reason);
      await rejected;
      expect(completeWithResolvedCredentials).toHaveBeenCalledTimes(1);
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it('rejects an invalid repaired ledger without requesting another repair', async () => {
    vi.mocked(completeWithResolvedCredentials).mockResolvedValue(completion(ledger(999)));
    await expect(new SessionCompactor({ keepRecentTokens: 1, recentTurnsPreserve: 1 })
      .compact(sources(conversation()), model, undefined, true)).rejects.toThrow('unavailable source seq');
    expect(completeWithResolvedCredentials).toHaveBeenCalledTimes(2);
  });

  it('propagates cancellation during the audit even if the provider returns a valid response', async () => {
    const controller = new AbortController();
    const reason = new Error('parent deadline');
    vi.mocked(completeWithResolvedCredentials)
      .mockResolvedValueOnce(completion(ledger(1, 'Inspect /tmp/job.log.')))
      .mockImplementationOnce(async () => { controller.abort(reason); return completion('{"upserts":[]}'); });
    const rows = conversation();
    rows[0] = { role: 'user', content: 'Inspect /tmp/job.log.' } as AgentMessage;
    await expect(new SessionCompactor({ keepRecentTokens: 1, recentTurnsPreserve: 1 })
      .compact(sources(rows), model, undefined, true, { signal: controller.signal })).rejects.toBe(reason);
    expect(completeWithResolvedCredentials).toHaveBeenCalledTimes(2);
  });

  it('shrinks later chunks as the previous ledger grows while preserving all source text', async () => {
    const seenRecords: string[] = [];
    let count = 0;
    vi.mocked(completeWithResolvedCredentials).mockImplementation(async (_model, context) => {
      const prompt = String(context.messages[0]?.content);
      const records = prompt.split(/Transcript records \(chunk \d+\):\n/)[1]!.split('\n\nReturn only the JSON delta of upserts.')[0]!;
      seenRecords.push(records);
      expect(Math.ceil((context.systemPrompt ?? '').length / 4) + Math.ceil(prompt.length / 4) + 32 + 4_096 + 2_000).toBeLessThanOrEqual(10_000);
      count += 1;
      return completion(ledger(1, 'fact '.repeat(count === 1 ? 300 : 380)));
    });
    const rows = sources([
      { role: 'user', content: 'BEGIN-' + 'x'.repeat(30_000) + '-END' } as AgentMessage,
      { role: 'assistant', content: 'ack' } as AgentMessage,
      { role: 'user', content: 'keep' } as AgentMessage,
      { role: 'assistant', content: 'kept' } as AgentMessage,
    ]);
    const result = await new SessionCompactor({ summaryMaxTokens: 2_000, summaryChunkTokens: 24_000, keepRecentTokens: 1, recentTurnsPreserve: 1, gapAudit: false })
      .compact(rows, { ...model, contextWindow: 10_000 }, undefined, true);
    expect(result.compacted).toBe(true);
    expect(seenRecords.length).toBeGreaterThan(2);
    expect(seenRecords[1]!.length).toBeLessThan(seenRecords[0]!.length);
    expect(seenRecords.join('')).toContain('BEGIN-');
    expect(seenRecords.join('')).toContain('-END');
    const fragments = seenRecords.flatMap((text) => [...text.matchAll(/<record_fragment[^>]*>\n([\s\S]*?)\n<\/record_fragment>/g)].map((match) => match[1]));
    expect(fragments.join('')).toContain('x'.repeat(30_000));
  });

  it('fails before calling a model when the ledger and source cannot fit', async () => {
    await expect(new SessionCompactor({ keepRecentTokens: 1, recentTurnsPreserve: 1 })
      .compact(sources(conversation()), { ...model, contextWindow: 4_096 }, undefined, true)).rejects.toThrow('context budget');
    expect(completeWithResolvedCredentials).not.toHaveBeenCalled();
  });

  it.each([false, true])('summarizes a whole single tool turn for recovery (interrupted=%s)', async (interrupted) => {
    vi.mocked(completeWithResolvedCredentials).mockResolvedValue(completion(ledger(1, 'PR #8569 review remains in progress.')));
    const entries = sources([
      { role: 'user', content: 'Review PR #8569', timestamp: 1 },
      { role: 'assistant', content: [{ type: 'toolCall', id: 'call-1', name: 'work', arguments: {} }], timestamp: 2 },
      ...(!interrupted ? [{ role: 'toolResult', toolCallId: 'call-1', toolName: 'work', content: [{ type: 'text', text: 'done' }], isError: false, timestamp: 3 }] : []),
    ] as AgentMessage[]);
    const result = await new SessionCompactor({ gapAudit: false })
      .compact(entries, model, undefined, true, { summarizeAll: true });
    expect(result.compacted).toBe(true);
    expect(result.messages).toHaveLength(1);
    expect(result.summary).toContain('PR #8569');
    expect(result.handover?.sourceThroughSeq).toBe(entries.at(-1)!.seq);
    expect(result.firstKeptIndex).toBe(entries.length);
  });

  it('recovers a single oversized message by summarizing every fragment', async () => {
    vi.mocked(completeWithResolvedCredentials).mockResolvedValue(completion(ledger()));
    const result = await new SessionCompactor({ summaryChunkTokens: 2_000, gapAudit: false })
      .compact(sources([{ role: 'user', content: 'BEGIN-' + 'x'.repeat(22_000) + '-END' } as AgentMessage]),
        model, undefined, true, { summarizeAll: true });
    expect(result.compacted).toBe(true);
    expect(result.messages).toHaveLength(1);
    const prompts = vi.mocked(completeWithResolvedCredentials).mock.calls.map((call) => String(call[1].messages[0]?.content));
    expect(prompts.length).toBeGreaterThan(2);
    expect(prompts.join('')).toContain('BEGIN-');
    expect(prompts.join('')).toContain('-END');
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
