/**
 * Telegram channel resolved account shape for plugin adapters.
 */

export interface TelegramResolvedAccount {
  accountId: string;
  name?: string;
  enabled: boolean;
  botToken: string;
  apiRoot?: string;
  dmPolicy?: 'pairing' | 'allowlist' | 'open' | 'disabled';
  groupPolicy?: 'open' | 'disabled' | 'allowlist';
  allowFrom?: Array<string | number>;
  groupAllowFrom?: Array<string | number>;
  requireMention?: boolean;
  streamMode?: 'off' | 'partial' | 'block';
}
