import { afterEach, describe, expect, it, vi } from 'vitest';

import type { Config } from '@xopcai/xopc/config/schema.js';

import { createFeishuStreamingAdapter } from '../streaming/streaming-adapter.js';

const { createFeishuClient } = vi.hoisted(() => ({ createFeishuClient: vi.fn() }));
vi.mock('../transport/client/client.js', () => ({ createFeishuClient }));

const config = {
  channels: { feishu: { enabled: true, accounts: { default: { appId: 'fixture', appSecret: 'fixture', streaming: true } } } },
} as Config;

describe('Feishu streaming delivery', () => {
  afterEach(() => {
    vi.resetAllMocks();
    vi.useRealTimers();
  });

  it('preserves normal outbound when the preview succeeds but the final update fails', async () => {
    vi.useFakeTimers();
    const update = vi.fn().mockResolvedValueOnce({ code: 0 }).mockResolvedValue({ code: 999 });
    const create = vi.fn().mockResolvedValue({ code: 0, data: { message_id: 'preview' } });
    const settings = vi.fn().mockResolvedValue({ code: 0 });
    createFeishuClient.mockReturnValue({
      api: {
        cardkit: { v1: { card: { create: vi.fn().mockResolvedValue({ code: 0, data: { card_id: 'card' } }), settings }, cardElement: { content: update } } },
        im: { message: { create } },
      },
    });
    const stream = createFeishuStreamingAdapter(() => config).startStream({ chatId: 'ou_test' })!;
    stream.update('preview');
    await vi.advanceTimersByTimeAsync(900);
    stream.update('complete reply');
    await stream.end();
    expect(update).toHaveBeenCalledTimes(2);
    expect(create).toHaveBeenCalledTimes(1);
    expect(settings).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ settings: JSON.stringify({ config: { streaming_mode: false } }) }) }));
    expect(stream.skipFinalOutbound?.()).toBe(false);
  });
});
