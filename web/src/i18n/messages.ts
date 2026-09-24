import type { StoredLanguage } from '@/lib/storage';

import { en, zh } from './locales/bundle';

export type Tab =
  | 'sessions'
  | 'logs'
  | 'settingsImports'
  | 'settingsOverview'
  | 'settingsAppearance'
  | 'settingsModels'
  | 'settingsVoice'
  | 'settingsSearch'
  | 'settingsGateway'
  | 'settingsRuntimes'
  | 'settingsDevices'
  | 'settingsHeartbeat'
  | 'settingsTunnel'
  | 'settingsShares'
  | 'settingsAgentBrowser'
  | 'settingsComputerUse'
  | 'settingsAgentDefaults'
  | 'settingsKeyboardShortcuts'
  | 'settingsSystem'
  | 'settingsDesktopPet'
  | 'settingsDesktopApp';

export type SettingsSectionId =
  | 'imports'
  | 'overview'
  | 'appearance'
  | 'agent'
  | 'agent-browser'
  | 'computer-use'
  | 'agent-defaults'
  | 'gateway'
  | 'runtimes'
  | 'devices'
  | 'heartbeat'
  | 'tunnel'
  | 'remote-access'
  | 'shares'
  | 'keyboard-shortcuts'
  | 'system'
  | 'desktop-pet'
  | 'desktop-app';

export type MessageBundle = typeof en;

const bundles: Record<StoredLanguage, MessageBundle> = { en, zh };

export type ProvidersSettingsMessages = MessageBundle['providersSettings'];
export type ModelsSettingsMessages = MessageBundle['modelsSettings'];
export type ChannelsSettingsMessages = MessageBundle['channelsSettings'];
export type VoiceSettingsMessages = MessageBundle['voiceSettings'];
export type GatewaySettingsMessages = MessageBundle['gatewaySettings'];
export type HeartbeatSettingsMessages = MessageBundle['heartbeatSettings'];
export type TunnelSettingsMessages = MessageBundle['tunnelSettings'];
export type SharesSettingsMessages = MessageBundle['sharesSettings'];
export type WebSearchSettingsMessages = MessageBundle['webSearchSettings'];
export type McpSettingsMessages = MessageBundle['mcpSettings'];
export type ConnectorsSettingsMessages = MessageBundle['connectorsSettings'];
export type AgentsSettingsMessages = MessageBundle['agentsSettings'];
export type ChatMessages = MessageBundle['chat'];
export type SideChatMessages = MessageBundle['sideChat'];
export type LogsMessages = MessageBundle['logs'];

export function messages(lang: StoredLanguage) {
  return bundles[lang];
}

export function tabLabel(lang: StoredLanguage, tab: Tab): string {
  const m = messages(lang);
  return m.nav[tab];
}
