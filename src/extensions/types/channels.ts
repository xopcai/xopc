/**
 * Extension System - Channel Types
 *
 * Channel extension definitions and message types.
 */

// ============================================================================
// Channel Extension (extension SDK — minimal connect/send surface)
// ============================================================================
//
// Not to be confused with `ChannelPlugin` in `src/channels/plugin-types.ts`
// (built-in multi-adapter integration) or `ChannelExtension` in
// `src/channels/types.ts` (legacy monolithic channel shape).

export interface ChannelExtension {
  name: string;
  connect: () => Promise<void>;
  disconnect: () => Promise<void>;
  sendMessage: (to: string, content: string, options?: SendMessageOptions) => Promise<void>;
  sendTyping?: (to: string) => Promise<void>;
  onMessage?: (callback: (message: ChannelMessage) => void) => void;
}

export interface SendMessageOptions {
  parseMode?: 'plain' | 'markdown' | 'html';
  replyTo?: string;
  threadId?: string;
}

export interface ChannelMessage {
  from: string;
  chatId: string;
  content: string;
  timestamp: Date;
  isGroup: boolean;
  metadata?: Record<string, unknown>;
}

// ============================================================================
// Channel Config
// ============================================================================

export interface TelegramConfig {
  enabled: boolean;
  botToken: string;
  allowFrom: Array<string | number>;
  debug: boolean;
  dmPolicy: DmPolicy;
  groupPolicy: GroupPolicy;
  apiRoot?: string;
  accounts?: Record<string, TelegramAccountConfig>;
  replyToMode?: ReplyToMode;
  streamMode?: StreamMode;
  historyLimit?: number;
  textChunkLimit?: number;
  proxy?: string;
  advancedMode?: boolean;
}

export interface TelegramAccountConfig {
  enabled: boolean;
  botToken: string;
  allowFrom?: Array<string | number>;
  groupAllowFrom?: Array<string | number>;
  debug?: boolean;
  dmPolicy?: DmPolicy;
  groupPolicy?: GroupPolicy;
  apiRoot?: string;
  replyToMode?: ReplyToMode;
  streamMode?: StreamMode;
  historyLimit?: number;
  textChunkLimit?: number;
  proxy?: string;
}

export type DmPolicy = 'pairing' | 'allowlist' | 'open' | 'disabled';
export type GroupPolicy = 'allowlist' | 'open' | 'disabled';
export type ReplyToMode = 'off' | 'quote' | 'reply';
export type StreamMode = 'partial' | 'full';
