/**
 * Channel Plugin Architecture Types
 * 
 * Inspired by openclaw's plugin-based channel design
 */

import type { MessageBus } from '../bus/index.js';
import type { Config } from '../config/index.js';

// ============================================
// Channel Metadata & Capabilities
// ============================================

export type ChannelType = 'telegram' | 'whatsapp' | 'system';

export type ChatType = 'direct' | 'group' | 'channel' | 'thread';

export interface ChannelCapabilities {
  chatTypes: ChatType[];
  reactions: boolean;
  threads: boolean;
  media: boolean;
  polls: boolean;
  nativeCommands: boolean;
  blockStreaming: boolean;
}

export interface ChannelMetadata {
  id: ChannelType;
  name: string;
  description: string;
  capabilities: ChannelCapabilities;
}

export interface TelegramTopicConfig {
  topicId: string;
  requireMention?: boolean;
  enabled?: boolean;
  allowFrom?: Array<string | number>;
  systemPrompt?: string;
  groupPolicy?: GroupPolicy;
}

// ============================================
// Channel Configuration
// ============================================

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

export interface TelegramTopicConfig {
  topicId: string;
  requireMention?: boolean;
  groupPolicy?: GroupPolicy;
  enabled?: boolean;
  allowFrom?: Array<string | number>;
  systemPrompt?: string;
}

export interface TelegramAccountConfig {
  accountId: string;
  name?: string;
  enabled?: boolean;
  token?: string;
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
  // Legacy single-account config (for backward compatibility)
  token?: string;
  allowFrom?: Array<string | number>;
  dmPolicy?: DmPolicy;
  groupPolicy?: GroupPolicy;
}

// ============================================
// Normalized AllowFrom
// ============================================

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

// ============================================
// Channel Message Context
// ============================================

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

// ============================================
// Channel Plugin Interface
// ============================================

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
}

export interface ChannelStatus {
  accountId: string;
  running: boolean;
  lastStartAt?: number;
  lastStopAt?: number;
  lastError?: string;
  mode: 'polling' | 'webhook' | 'stopped';
}

export interface ChannelPlugin {
  /** Channel identifier */
  id: ChannelType;
  
  /** Channel metadata */
  meta: ChannelMetadata;
  
  /** Initialize channel (called once) */
  init(options: ChannelInitOptions): Promise<void>;
  
  /** Start channel for an account */
  start(options?: ChannelStartOptions): Promise<void>;
  
  /** Stop channel */
  stop(accountId?: string): Promise<void>;
  
  /** Send a message */
  send(options: ChannelSendOptions): Promise<ChannelSendResult>;
  
  /** Start a streaming message */
  startStream(options: ChannelSendStreamOptions): ChannelStreamHandle;
  
  /** Get channel status */
  getStatus(accountId?: string): ChannelStatus;
  
  /** Test connection */
  testConnection(): Promise<{ success: boolean; error?: string }>;
}

// ============================================
// Access Control Results
// ============================================

export interface GroupAccessResult {
  allowed: boolean;
  reason?: 'group-disabled' | 'topic-disabled' | 'unauthorized' | 'policy-blocked';
  groupPolicy?: GroupPolicy;
}

// ============================================
// Update Offset Store (for polling)
// ============================================

export interface UpdateOffsetStore {
  readOffset(accountId: string): Promise<number | null>;
  writeOffset(accountId: string, offset: number): Promise<void>;
}
