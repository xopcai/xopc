/**
 * Built-in chat channel registry: stable ordering and UI-facing metadata.
 * Extension-provided channels register separately; keep protocol IDs aligned.
 */

import type { ChannelCapabilities } from './plugin-types.js';

export const CHAT_CHANNEL_ORDER = ['telegram'] as const;

export type ChatChannelId = (typeof CHAT_CHANNEL_ORDER)[number];

export interface ChatChannelMeta {
  id: ChatChannelId;
  label: string;
  description: string;
  capabilities: ChannelCapabilities;
}

const DEFAULT_CAPABILITIES: ChannelCapabilities = {
  chatTypes: ['direct', 'group', 'channel', 'thread'],
  reactions: true,
  threads: true,
  media: true,
  polls: false,
  nativeCommands: true,
  blockStreaming: true,
};

const CHAT_CHANNEL_META: Record<ChatChannelId, ChatChannelMeta> = {
  telegram: {
    id: 'telegram',
    label: 'Telegram',
    description: 'Telegram Bot API (GrammY)',
    capabilities: DEFAULT_CAPABILITIES,
  },
};

export function getChatChannelMeta(id: ChatChannelId): ChatChannelMeta {
  return CHAT_CHANNEL_META[id];
}

export function isChatChannelId(id: string): id is ChatChannelId {
  return (CHAT_CHANNEL_ORDER as readonly string[]).includes(id);
}

export function listChatChannelMeta(): ChatChannelMeta[] {
  return CHAT_CHANNEL_ORDER.map((id) => CHAT_CHANNEL_META[id]);
}
