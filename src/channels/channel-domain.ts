/**
 * Channel domain types shared by channel plugins.
 */

import type { MessageBus } from '../infra/bus/index.js';
import type { Config } from '../config/schema.js';

export type ChatType = 'direct' | 'group' | 'channel' | 'thread';

export type DmPolicy = 'pairing' | 'allowlist' | 'open' | 'disabled';
export type GroupPolicy = 'open' | 'disabled' | 'allowlist';
export type ReplyToMode = 'off' | 'first' | 'all';

export interface NormalizedAllowFrom {
  entries: string[];
  hasWildcard: boolean;
  hasEntries: boolean;
}

export interface AllowFromMatch {
  allowed: boolean;
  matchKey?: string;
  matchSource?: 'wildcard' | 'id';
}

export interface ChannelMessageContext {
  channelId: string;
  chatId: string;
  senderId: string;
  senderUsername?: string;
  isGroup: boolean;
  isForum?: boolean;
  threadId?: string;
  messageId: string;
  content: string;
  timestamp: number;
  media?: ChannelMediaRef[];
}

export interface ChannelMediaRef {
  type: 'photo' | 'video' | 'audio' | 'document' | 'sticker';
  fileId?: string;
  url?: string;
  mimeType?: string;
  size?: number;
}

export interface ChannelInitOptions {
  bus: MessageBus;
  config: Config;
  channelConfig: Record<string, unknown>;
}

export interface ChannelStartOptions {
  accountId?: string;
}

export interface ChannelSendOptions {
  chatId: string;
  content: string;
  type?: 'message' | 'typing_on' | 'typing_off';
  accountId?: string;
  threadId?: string;
  replyToMessageId?: string;
  mediaUrl?: string;
  mediaType?: 'photo' | 'video' | 'audio' | 'document' | 'animation';
  silent?: boolean;
  audioAsVoice?: boolean;
}

export interface ChannelSendStreamOptions {
  chatId: string;
  accountId?: string;
  threadId?: string;
  replyToMessageId?: string;
  parseMode?: 'Markdown' | 'HTML';
}

export interface ChannelSendResult {
  messageId: string;
  chatId: string;
  success: boolean;
  error?: string;
}

export interface ChannelStreamHandle {
  update: (text: string) => void;
  end: () => Promise<void>;
  abort: () => Promise<void>;
  messageId: () => number | undefined;
  skipFinalOutbound?: () => boolean;
}

export interface ChannelStatus {
  accountId: string;
  running: boolean;
  lastStartAt?: number;
  lastStopAt?: number;
  lastError?: string;
  mode: 'polling' | 'webhook' | 'stopped';
}

export interface GroupAccessResult {
  allowed: boolean;
  reason?: 'group-disabled' | 'topic-disabled' | 'unauthorized' | 'policy-blocked';
  groupPolicy?: GroupPolicy;
}

export interface UpdateOffsetStore {
  readOffset(accountId: string): Promise<number | null>;
  writeOffset(accountId: string, offset: number): Promise<void>;
}
