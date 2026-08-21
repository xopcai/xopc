// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  CHANNEL_STATUS_REALTIME_EVENT,
  parseChannelStatusRealtimeDetail,
  subscribeChannelStatusRealtime,
} from '@/features/settings/channels/use-channel-status-realtime';

describe('use-channel-status-realtime', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('extracts the channels array', () => {
    expect(parseChannelStatusRealtimeDetail(null)).toBeNull();
    expect(
      parseChannelStatusRealtimeDetail({
        channels: [{ name: 'telegram', enabled: true, connected: true }],
      }),
    ).toEqual([{ name: 'telegram', enabled: true, connected: true }]);
  });

  it('forwards realtime event details until unsubscribed', () => {
    const onEvent = vi.fn();
    const unsubscribe = subscribeChannelStatusRealtime(onEvent);

    window.dispatchEvent(
      new CustomEvent(CHANNEL_STATUS_REALTIME_EVENT, {
        detail: { channels: [{ name: 'weixin', enabled: false, connected: false }] },
      }),
    );
    expect(onEvent).toHaveBeenCalledWith({
      channels: [{ name: 'weixin', enabled: false, connected: false }],
    });

    onEvent.mockClear();
    unsubscribe();
    window.dispatchEvent(new CustomEvent(CHANNEL_STATUS_REALTIME_EVENT, { detail: {} }));
    expect(onEvent).not.toHaveBeenCalled();
  });
});
