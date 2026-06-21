import type { DmPolicy, GroupPolicy, ReplyToMode } from '@xopcai/xopc/channels/channel-domain.js';

export interface TelegramTopicConfig {
  topicId?: string;
  requireMention?: boolean;
  enabled?: boolean;
  allowFrom?: Array<string | number>;
  systemPrompt?: string;
  agentId?: string;
  groupPolicy?: GroupPolicy;
}

export interface TelegramGroupConfig {
  groupId?: string;
  requireMention?: boolean;
  groupPolicy?: GroupPolicy;
  enabled?: boolean;
  allowFrom?: Array<string | number>;
  systemPrompt?: string;
  agentId?: string;
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
  streaming?: {
    mode?: 'off' | 'partial' | 'block';
    preview?: { toolProgress?: boolean };
    block?: { coalesce?: { minChars?: number; idleMs?: number } };
  };
  proxy?: string;
  apiRoot?: string;
  pollingStallThresholdMs?: number;
  reactionLevel?: 'off' | 'ack' | 'minimal' | 'extensive';
  reactionNotifications?: 'off' | 'own' | 'all';
  ackReaction?: string;
  tokenSource?: string;
}
