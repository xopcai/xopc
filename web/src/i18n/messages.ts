import type { StoredLanguage } from '@/lib/storage';

import { en, zh } from './locales/bundle';

export type Tab =
  | 'chat'
  | 'sessions'
  | 'cron'
  | 'skills'
  | 'channels'
  | 'agents'
  | 'logs'
  | 'settingsAppearance'
  | 'settingsProviders'
  | 'settingsModels'
  | 'settingsChannels'
  | 'settingsVoice'
  | 'settingsGateway'
  | 'settingsHeartbeat'
  | 'settingsSearch'
  | 'settingsDreams'
  | 'settingsAgentDefaults'
  | 'settingsAgents'
  | 'settingsSystem';

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
  | 'dreams'
  | 'agents'
  | 'system'
  | 'cron'
  | 'skills';

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
export type LogsMessages = MessageBundle['logs'];

export function messages(lang: StoredLanguage) {
  return bundles[lang];
}

export function tabLabel(lang: StoredLanguage, tab: Tab): string {
  const m = messages(lang);
  if (tab === 'settingsAgents') {
    return m.nav.agents;
  }
  return m.nav[tab];
}
