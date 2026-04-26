/** Telegram / channel settings shapes for gateway `channels` config. */

import type { BindingRuleWire, ChannelAgentRoutesState as ChannelAgentRoutes } from './channel-bindings-merge';

export type { ChannelAgentRoutesState } from './channel-bindings-merge';

export type DmPolicy = 'pairing' | 'allowlist' | 'open' | 'disabled';
export type GroupPolicy = 'open' | 'disabled' | 'allowlist';
export type StreamMode = 'off' | 'partial' | 'block';
export type ReplyToMode = 'off' | 'first' | 'all';
export type FeishuDomain = 'feishu' | 'lark' | string;
export type FeishuRenderMode = 'auto' | 'raw' | 'card';
export type FeishuReactionNotifications = 'off' | 'own' | 'all';

export interface TelegramAccount {
  accountId: string;
  name: string;
  enabled: boolean;
  botToken: string;
  tokenFile?: string;
  allowFrom: (string | number)[];
  groupAllowFrom?: (string | number)[];
  dmPolicy: DmPolicy;
  groupPolicy: GroupPolicy;
  replyToMode: ReplyToMode;
  apiRoot: string;
  proxy: string;
  historyLimit: number;
  textChunkLimit: number;
  streamMode: StreamMode;
  groups?: Record<string, unknown>;
}

export interface TelegramConfig {
  enabled: boolean;
  botToken: string;
  apiRoot: string;
  debug: boolean;
  allowFrom: (string | number)[];
  groupAllowFrom: (string | number)[];
  dmPolicy: DmPolicy;
  groupPolicy: GroupPolicy;
  replyToMode: ReplyToMode;
  streamMode: StreamMode;
  historyLimit: number;
  textChunkLimit: number;
  proxy: string;
  accounts: Record<string, TelegramAccount>;
}

export interface WeixinAccount {
  name?: string;
  enabled?: boolean;
  cdnBaseUrl?: string;
  routeTag?: string | number;
  dmPolicy?: DmPolicy;
  allowFrom?: string[];
  streamMode?: StreamMode;
  debug?: boolean;
}

export interface WeixinConfig {
  enabled: boolean;
  dmPolicy: DmPolicy;
  allowFrom: string[];
  debug: boolean;
  streamMode: StreamMode;
  historyLimit: number;
  textChunkLimit: number;
  routeTag: string;
  accounts: Record<string, WeixinAccount>;
}

export interface FeishuAccount {
  name?: string;
  enabled?: boolean;
  appId?: string;
  appSecret?: string;
  domain?: FeishuDomain;
  connectionMode?: 'websocket' | 'webhook';
  verificationToken?: string;
  encryptKey?: string;
  webhookHost?: string;
  webhookPort?: number;
  webhookPath?: string;
  dmPolicy?: DmPolicy;
  groupPolicy?: GroupPolicy;
  allowFrom?: (string | number)[];
  groupAllowFrom?: (string | number)[];
  requireMention?: boolean;
  historyLimit?: number;
  textChunkLimit?: number;
  renderMode?: FeishuRenderMode;
  streaming?: boolean;
  reactionNotifications?: FeishuReactionNotifications;
  tools?: Record<string, boolean>;
  actions?: Record<string, boolean>;
}

export interface FeishuConfig {
  enabled: boolean;
  defaultAccount?: string;
  appId: string;
  appSecret: string;
  domain: FeishuDomain;
  connectionMode: 'websocket' | 'webhook';
  verificationToken?: string;
  encryptKey?: string;
  webhookHost?: string;
  webhookPort?: number;
  webhookPath?: string;
  dmPolicy: DmPolicy;
  groupPolicy: GroupPolicy;
  allowFrom: (string | number)[];
  groupAllowFrom: (string | number)[];
  requireMention: boolean;
  historyLimit: number;
  textChunkLimit: number;
  renderMode: FeishuRenderMode;
  streaming: boolean;
  reactionNotifications: FeishuReactionNotifications;
  tools?: Record<string, boolean>;
  actions?: Record<string, boolean>;
  accounts: Record<string, FeishuAccount>;
}

export interface ChannelsSettingsState {
  telegram: TelegramConfig;
  weixin: WeixinConfig;
  feishu: FeishuConfig;
  /** Full bindings array last loaded from the gateway (merge base for saves). */
  bindingsFull: BindingRuleWire[];
  channelAgentRoutes: ChannelAgentRoutes;
  /** `agents.defaultId` — fallback agent when no explicit route. */
  defaultAgentId: string;
}
