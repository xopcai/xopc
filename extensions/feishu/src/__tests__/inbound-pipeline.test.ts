import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import type { InboundMessage } from '@xopcai/xopc/channels/transport-types.js';

import { createFeishuInboundPipeline } from '../transport/reliability/inbound-pipeline.js';

describe('createFeishuInboundPipeline', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('merges debounced text for the same chat', async () => {
    const published: InboundMessage[] = [];
    const bus = {
      publishInbound: vi.fn(async (m: InboundMessage) => {
        published.push(m);
      }),
    };

    const p = createFeishuInboundPipeline({ bus: bus as any, defaultDebounceMs: 50 });

    const work = (content: string, messageId: string) => ({
      kind: 'text' as const,
      accountId: 'acc',
      chatId: 'chat1',
      debounceMs: 50,
      inbound: {
        channel: 'feishu',
        sender_id: 'u',
        chat_id: 'chat1',
        content,
        metadata: { messageId, sessionKey: 'sk' },
      },
    });

    await p.enqueue(work('hello', 'm1'));
    await p.enqueue(work('world', 'm2'));
    await vi.advanceTimersByTimeAsync(60);

    expect(published).toHaveLength(1);
    expect(published[0]?.content).toBe('hello\n\nworld');
    expect(published[0]?.metadata?.messageId).toBe('m2');
    expect(published[0]?.metadata?.feishuMergedCount).toBe(2);
  });

  it('publishes immediately when debounce is 0', async () => {
    const published: InboundMessage[] = [];
    const bus = {
      publishInbound: vi.fn(async (m: InboundMessage) => {
        published.push(m);
      }),
    };
    const p = createFeishuInboundPipeline({ bus: bus as any, defaultDebounceMs: 50 });

    await p.enqueue({
      kind: 'text',
      accountId: 'a',
      chatId: 'c',
      debounceMs: 0,
      inbound: {
        channel: 'feishu',
        sender_id: 'u',
        chat_id: 'c',
        content: 'x',
        metadata: { messageId: 'm1' },
      },
    });

    expect(published).toHaveLength(1);
    expect(published[0]?.content).toBe('x');
  });
});
