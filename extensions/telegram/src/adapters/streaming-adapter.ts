import type { ChannelStreamHandle, ChannelStreamingAdapter } from '@xopcai/xopcbot/channels/plugin-types.js';

/**
 * Telegram draft streaming is handled via legacy draft-stream utilities; ChannelPlugin.streaming is a stub.
 */
export function createTelegramStreamingAdapter(): ChannelStreamingAdapter {
  return {
    startStream(_options: {
      chatId: string;
      accountId?: string;
      threadId?: string;
      replyToMessageId?: string;
      parseMode?: 'Markdown' | 'HTML';
    }): ChannelStreamHandle | null {
      return null;
    },
  };
}
