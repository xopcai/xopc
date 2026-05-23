// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  CHANNEL_PAIRING_SSE_EVENTS,
  subscribeChannelPairingSse,
} from '@/features/settings/channels/use-channel-pairing-sse';

describe('subscribeChannelPairingSse', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('calls refresh on all pairing SSE window events', () => {
    const onRefresh = vi.fn();
    const unsubscribe = subscribeChannelPairingSse(onRefresh);

    for (const name of CHANNEL_PAIRING_SSE_EVENTS) {
      window.dispatchEvent(new Event(name));
    }

    expect(onRefresh).toHaveBeenCalledTimes(CHANNEL_PAIRING_SSE_EVENTS.length);

    onRefresh.mockClear();
    unsubscribe();

    window.dispatchEvent(new Event('channels-pairing-requested'));
    expect(onRefresh).not.toHaveBeenCalled();
  });
});
