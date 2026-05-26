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
  | 'settingsOverview'
  | 'settingsAppearance'
  | 'settingsCredentials'
  | 'settingsProviders'
  | 'settingsModels'
  | 'settingsImageModels'
  | 'settingsChannels'
  | 'settingsVoice'
  | 'settingsGateway'
  | 'settingsHeartbeat'
  | 'settingsTunnel'
  | 'settingsShares'
  | 'settingsSearch'
  | 'settingsDreams'
  | 'settingsCron'
  | 'settingsGoals'
  | 'settingsAgentDefaults'
  | 'settingsAgentChat'
  | 'settingsAgentWorkspace'
  | 'settingsAgentBrowser'
  | 'settingsAgentRuntime'
  | 'settingsAgentContext'
  | 'settingsAgentMemory'
  | 'settingsAgentTools'
  | 'settingsAgentSkills'
  | 'settingsAgentMcp'
  | 'settingsAgentSystemPrompt'
  | 'settingsAgents'
  | 'settingsSystem'
  | 'settingsAppManagement';

export type SettingsSectionId =
  | 'overview'
  | 'appearance'
  | 'agent'
  | 'agent-defaults'
  | 'agent-chat'
  | 'agent-workspace'
  | 'agent-browser'
  | 'agent-runtime'
  | 'agent-context'
  | 'agent-memory'
  | 'agent-tools'
  | 'agent-skills'
  | 'agent-mcp'
  | 'agent-system-prompt'
  | 'providers'
  | 'credentials'
  | 'models'
  | 'image-models'
  | 'channels'
  | 'voice'
  | 'gateway'
  | 'heartbeat'
  | 'tunnel'
  | 'remote-access'
  | 'shares'
  | 'search'
  | 'dreams'
  | 'goals'
  | 'agents'
  | 'system'
  | 'app-management'
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
export type TunnelSettingsMessages = MessageBundle['tunnelSettings'];
export type SharesSettingsMessages = MessageBundle['sharesSettings'];
export type WebSearchSettingsMessages = MessageBundle['webSearchSettings'];
export type McpSettingsMessages = MessageBundle['mcpSettings'];
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
  if (tab === 'settingsAgentDefaults') {
    return m.nav.settingsAgentChat;
  }
  return m.nav[tab];
}
