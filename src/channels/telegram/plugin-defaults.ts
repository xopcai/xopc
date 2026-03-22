/**
 * Default queue and outbound limits for the Telegram channel plugin.
 * Keep in sync with ChannelPlugin.defaults on TelegramChannelPlugin.
 */

export const TELEGRAM_CHANNEL_DEFAULTS = {
  queue: {
    /** Inbound message debounce window (ms) */
    debounceMs: 300,
  },
  outbound: {
    /** Telegram message text chunk size (Bot API limit is 4096; we use 4000 for safety) */
    textChunkLimit: 4000,
  },
} as const;
