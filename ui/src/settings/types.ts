// Shared types for settings sections
export type DmPolicy = 'pairing' | 'allowlist' | 'open' | 'disabled';
export type GroupPolicy = 'open' | 'disabled' | 'allowlist';
export type StreamMode = 'off' | 'partial' | 'block';
export type ReplyToMode = 'off' | 'first' | 'all';

export interface TelegramAccount {
  accountId: string;
  name: string;
  enabled: boolean;
  botToken: string;
  /** Path to token file (alternative to inline botToken) */
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
  /** Per-account group overrides; see TelegramGroupConfigSchema */
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
  advancedMode: boolean;
}

/** Per-account overrides; see WeixinAccountConfigSchema */
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
  /** Serialized as string in the form; empty means unset */
  routeTag: string;
  accounts: Record<string, WeixinAccount>;
  advancedMode: boolean;
}

export interface SettingsData {
  model: string;
  /** provider/model for vision / image tool */
  imageModel?: string;
  /** provider/model for image_generate (e.g. openai/gpt-image-1) */
  imageGenerationModel?: string;
  /** Max MB per image load for image tool */
  mediaMaxMb?: number;
  maxTokens: number;
  temperature: number;
  maxToolIterations: number;
  workspace: string;
  thinkingDefault?: string;
  reasoningDefault?: string;
  verboseDefault?: string;
  providers: Record<string, string>;
  telegram: TelegramConfig;
  weixin: WeixinConfig;
  gateway: {
    heartbeat: { enabled: boolean; intervalMs: number };
    auth?: { mode: 'none' | 'token'; token?: string };
  };
  stt?: {
    enabled: boolean;
    provider: 'alibaba' | 'openai';
    alibaba?: { apiKey?: string; model?: string };
    openai?: { apiKey?: string; model?: string };
    fallback?: { enabled: boolean; order: ('alibaba' | 'openai')[] };
  };
  tts?: {
    enabled: boolean;
    provider: 'openai' | 'alibaba' | 'edge';
    trigger: 'off' | 'always' | 'inbound' | 'tagged';
    maxTextLength?: number;
    timeoutMs?: number;
    alibaba?: { apiKey?: string; model?: string; voice?: string };
    openai?: { apiKey?: string; model?: string; voice?: string };
    edge?: { voice?: string; lang?: string };
  };
}

export const DEFAULT_SETTINGS: SettingsData = {
  model: '',
  maxTokens: 8192,
  temperature: 0.7,
  maxToolIterations: 20,
  workspace: '~/.xopcbot/workspace',
  thinkingDefault: 'medium',
  reasoningDefault: 'off',
  verboseDefault: 'off',
  providers: {},
  telegram: {
    enabled: false,
    botToken: '',
    apiRoot: '',
    debug: false,
    allowFrom: [],
    groupAllowFrom: [],
    dmPolicy: 'pairing',
    groupPolicy: 'open',
    replyToMode: 'off',
    streamMode: 'partial',
    historyLimit: 50,
    textChunkLimit: 4000,
    proxy: '',
    accounts: {},
    advancedMode: false,
  },
  weixin: {
    enabled: false,
    dmPolicy: 'pairing',
    allowFrom: [],
    debug: false,
    streamMode: 'partial',
    historyLimit: 50,
    textChunkLimit: 4000,
    routeTag: '',
    accounts: {},
    advancedMode: false,
  },
  gateway: {
    heartbeat: { enabled: true, intervalMs: 60000 },
    auth: { mode: 'token', token: '' },
  },
};
