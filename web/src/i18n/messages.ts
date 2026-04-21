import type { StoredLanguage } from '@/lib/storage';

import en from './locales/en.json' with { type: 'json' };
import zh from './locales/zh.json' with { type: 'json' };

export type Tab =
  | 'chat'
  | 'sessions'
  | 'cron'
  | 'skills'
  | 'channels'
  | 'logs'
  | 'settingsAppearance'
  | 'settingsProviders'
  | 'settingsModels'
  | 'settingsChannels'
  | 'settingsVoice'
  | 'settingsGateway'
  | 'settingsHeartbeat'
  | 'settingsSearch'
  | 'settingsAgentDefaults'
  | 'settingsAgents';

export type SettingsSectionId =
  | 'appearance'
  | 'agent'
  | 'agent-defaults'
  | 'providers'
  | 'models'
  | 'channels'
  | 'voice'
  | 'gateway'
  | 'heartbeat'
  | 'search'
  | 'agents';

export type MessageBundle = typeof en;

const bundles: Record<StoredLanguage, MessageBundle> = { en, zh };

export type ProvidersSettingsMessages = MessageBundle['providersSettings'];
export type ModelsSettingsMessages = MessageBundle['modelsSettings'];
export type ChannelsSettingsMessages = MessageBundle['channelsSettings'];
export type VoiceSettingsMessages = MessageBundle['voiceSettings'];
export type GatewaySettingsMessages = MessageBundle['gatewaySettings'];
export type HeartbeatSettingsMessages = MessageBundle['heartbeatSettings'];
export type WebSearchSettingsMessages = MessageBundle['webSearchSettings'];
export type AgentsSettingsMessages = MessageBundle['agentsSettings'];
export type ChatMessages = MessageBundle['chat'];

export function messages(lang: StoredLanguage) {
  return bundles[lang];
}

export function tabLabel(lang: StoredLanguage, tab: Tab): string {
  const m = messages(lang);
  return m.nav[tab];
}
