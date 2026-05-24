// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  CHANNEL_STATUS_SSE_EVENT,
  parseChannelStatusSseDetail,
  subscribeChannelStatusSse,
} from '@/features/settings/channels/use-channel-status-sse';

describe('use-channel-status-sse', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('parseChannelStatusSseDetail extracts channels array', () => {
    expect(parseChannelStatusSseDetail(null)).toBeNull();
    expect(parseChannelStatusSseDetail({ channels: [{ name: 'telegram', enabled: true, connected: true }] })).toEqual([
      { name: 'telegram', enabled: true, connected: true },
    ]);
  });

  it('subscribeChannelStatusSse forwards custom event detail', () => {
    const onEvent = vi.fn();
    const unsubscribe = subscribeChannelStatusSse(onEvent);

    window.dispatchEvent(
      new CustomEvent(CHANNEL_STATUS_SSE_EVENT, {
        detail: { channels: [{ name: 'weixin', enabled: false, connected: false }] },
      }),
    );

    expect(onEvent).toHaveBeenCalledWith({
      channels: [{ name: 'weixin', enabled: false, connected: false }],
    });

    onEvent.mockClear();
    unsubscribe();

    window.dispatchEvent(new CustomEvent(CHANNEL_STATUS_SSE_EVENT, { detail: {} }));
    expect(onEvent).not.toHaveBeenCalled();
  });
});
