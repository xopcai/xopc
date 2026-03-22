/**
 * Channel domain types (Telegram config, message context, send options).
 */

import type { MessageBus } from '../bus/index.js';
import type { Config } from '../config/index.js';
import type { ProgressStage } from '../agent/progress.js';

export type { ProgressStage } from '../agent/progress.js';

export type ChannelType = 'telegram' | 'system';

export type ChatType = 'direct' | 'group' | 'channel' | 'thread';

export interface TelegramTopicConfig {
  topicId: string;
  requireMention?: boolean;
  enabled?: boolean;
  allowFrom?: Array<string | number>;
  systemPrompt?: string;
  groupPolicy?: GroupPolicy;
}

export type DmPolicy = 'pairing' | 'allowlist' | 'open' | 'disabled';
export type GroupPolicy = 'open' | 'disabled' | 'allowlist';
export type ReplyToMode = 'off' | 'first' | 'all';

export interface TelegramGroupConfig {
  groupId: string;
  requireMention?: boolean;
  groupPolicy?: GroupPolicy;
  enabled?: boolean;
  allowFrom?: Array<string | number>;
  systemPrompt?: string;
  topics?: Record<string, TelegramTopicConfig>;
}

export interface TelegramAccountConfig {
  accountId: string;
  name?: string;
  enabled?: boolean;
  botToken?: string;
  tokenFile?: string;
  dmPolicy?: DmPolicy;
  groupPolicy?: GroupPolicy;
  replyToMode?: ReplyToMode;
  allowFrom?: Array<string | number>;
  groupAllowFrom?: Array<string | number>;
  groups?: Record<string, TelegramGroupConfig>;
  historyLimit?: number;
  textChunkLimit?: number;
  streamMode?: 'off' | 'partial' | 'block';
  proxy?: string;
  apiRoot?: string;
}

export interface TelegramChannelConfig {
  enabled?: boolean;
  accounts?: Record<string, TelegramAccountConfig>;
  botToken?: string;
  allowFrom?: Array<string | number>;
  groupAllowFrom?: Array<string | number>;
  dmPolicy?: DmPolicy;
  groupPolicy?: GroupPolicy;
  replyToMode?: ReplyToMode;
  streamMode?: 'off' | 'partial' | 'block';
  historyLimit?: number;
  textChunkLimit?: number;
  proxy?: string;
  apiRoot?: string;
  debug?: boolean;
}

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
  updateProgress?: (text: string, stage: ProgressStage, detail?: string) => void;
  setProgress?: (stage: ProgressStage, detail?: string) => void;
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
