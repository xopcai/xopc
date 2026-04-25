import type { ChannelStreamHandle, ChannelStreamingAdapter } from '@xopcai/xopc/channels/plugin-types.js';

export function createFeishuStreamingAdapter(): ChannelStreamingAdapter {
  return {
    startStream(): ChannelStreamHandle | null {
      // Socket Mode streaming-card (Card Kit) will be implemented during parity work.
      return null;
    },
  };
}

