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

export interface SettingsData {
  model: string;
  maxTokens: number;
  temperature: number;
  maxToolIterations: number;
  workspace: string;
  thinkingDefault?: string;
  reasoningDefault?: string;
  verboseDefault?: string;
  providers: Record<string, string>;
  telegram: TelegramConfig;
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
    provider: 'openai' | 'alibaba';
    trigger: 'auto' | 'never';
    alibaba?: { apiKey?: string; model?: string; voice?: string };
    openai?: { apiKey?: string; model?: string; voice?: string };
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
    token: '',
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
  gateway: {
    heartbeat: { enabled: true, intervalMs: 60000 },
    auth: { mode: 'token', token: '' },
  },
};
