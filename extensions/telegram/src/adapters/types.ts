/**
 * Telegram channel resolved account shape for plugin adapters.
 */

export interface TelegramResolvedAccount {
  accountId: string;
  name?: string;
  enabled: boolean;
  botToken: string;
  tokenFile?: string;
  apiRoot?: string;
  proxy?: string;
  dmPolicy?: 'pairing' | 'allowlist' | 'open' | 'disabled';
  groupPolicy?: 'open' | 'disabled' | 'allowlist';
  allowFrom?: Array<string | number>;
  groupAllowFrom?: Array<string | number>;
  requireMention?: boolean;
  replyToMode?: 'off' | 'first' | 'all';
  streamMode?: 'off' | 'partial' | 'block';
  streaming?: import('../config-schema.js').TelegramStreamingConfig;
  pollingStallThresholdMs?: number;
  reactionLevel?: 'off' | 'ack' | 'minimal' | 'extensive';
  reactionNotifications?: 'off' | 'own' | 'all';
  ackReaction?: string;
  webhookUrl?: string;
  webhookSecret?: string;
  webhookPath?: string;
  groups?: Record<string, unknown>;
}
