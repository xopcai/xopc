/**
 * Synthetic `OutboundMessage.channel` for internal agent runs (e.g. heartbeat without delivery).
 * {@link ChannelManager.send} drops these without treating them as unknown plugins.
 */
export const INTERNAL_OUTBOUND_DROP_CHANNEL = '__xopc_internal';

const NON_EXTERNAL_MESSAGING_CHANNELS = new Set([
  'webchat',
  'cli',
  'tui',
  'system',
  'automation',
  'heartbeat',
  'cron',
  'subagent',
  INTERNAL_OUTBOUND_DROP_CHANNEL,
]);

/** Returns true for real external IM/chat channels (DingTalk, WeCom, Feishu, Telegram, Weixin, Slack, Discord, etc.). */
export function isExternalMessagingChannel(channel?: string | null): boolean {
  const normalized = channel?.trim().toLowerCase();
  return Boolean(normalized && !NON_EXTERNAL_MESSAGING_CHANNELS.has(normalized));
}
