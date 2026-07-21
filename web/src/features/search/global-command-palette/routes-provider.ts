import type { StoredLanguage } from '@/lib/storage';
import { messages, tabLabel, type Tab } from '@/i18n/messages';
import { pathForTab } from '@/navigation';
import { isSettingsPathVisibleInMode, isSettingsTabVisibleInMode } from '@/navigation/settings-nav-visibility';
import { channelDetailPath } from '@/features/settings/channels/channels-routes';
import { useSettingsModeStore } from '@/stores/settings-mode-store';

export type RouteHitSeed = {
  id: string;
  title: string;
  subtitle?: string;
  path: string;
  keywords?: string[];
};

/**
 * Tabs for which the command palette offers a deep-link shortcut.
 *
 * Manifest-first agent management lives under `/agents`; user profile and
 * browser automation are standalone agent-related settings routes.
 */
const AGENT_SETTINGS_PALETTE_TABS: readonly Tab[] = ['settingsUserProfile', 'settingsAgentBrowser'];

const AGENT_SETTINGS_ROUTE_KEYWORDS: Partial<Record<Tab, string[]>> = {
  settingsUserProfile: ['user', 'profile', 'preferences', 'timezone'],
  settingsAgentBrowser: ['browser', 'playwright', 'automation'],
};

function buildAgentSettingsRouteSeeds(language: StoredLanguage, settingsMode: ReturnType<typeof useSettingsModeStore.getState>['mode']): RouteHitSeed[] {
  const m = messages(language);
  const subtitle = m.commandPalette.routes.agentsSubtitle;
  return AGENT_SETTINGS_PALETTE_TABS.filter((tab) => isSettingsTabVisibleInMode(tab, settingsMode)).map((tab) => ({
    id: `route:settings:agent:${tab}`,
    title: tabLabel(language, tab),
    subtitle,
    path: pathForTab(tab),
    keywords: ['agent', 'manifest', 'preset', 'config', ...(AGENT_SETTINGS_ROUTE_KEYWORDS[tab] ?? [])],
  }));
}

function filterRouteSeedsBySettingsMode(
  seeds: RouteHitSeed[],
  settingsMode: ReturnType<typeof useSettingsModeStore.getState>['mode'],
): RouteHitSeed[] {
  return seeds.filter((seed) => isSettingsPathVisibleInMode(seed.path.split('?')[0] ?? seed.path, settingsMode));
}

export function buildRouteSeeds(language: StoredLanguage): RouteHitSeed[] {
  const m = messages(language);
  const r = m.commandPalette.routes;
  const ch = m.channelsSettings;
  const settingsMode = useSettingsModeStore.getState().mode;
  return filterRouteSeedsBySettingsMode(
    [
    {
      id: 'route:chat',
      title: m.nav.chat,
      subtitle: r.chatSubtitle,
      path: '/chat',
      keywords: ['chat', 'new', 'compose', 'assistant'],
    },
    {
      id: 'route:agents',
      title: m.nav.agents,
      subtitle: r.agentsSubtitle,
      path: '/agents',
      keywords: ['agent', 'persona', 'switch'],
    },
    {
      id: 'route:extensions',
      title: m.nav.extensions,
      subtitle: r.extensionsSubtitle,
      path: '/extensions',
      keywords: ['extension', 'plugin', 'addon'],
    },
    {
      id: 'route:local-apps',
      title: m.nav.localApps,
      subtitle: r.localAppsSubtitle,
      path: '/local-apps',
      keywords: ['app', 'apps', 'local app', 'tool', 'workshop', 'coder', '应用', '本地应用', '工具', '工坊'],
    },
    {
      id: 'route:sessions',
      title: m.nav.sessions,
      subtitle: r.sessionsSubtitle,
      path: '/settings/sessions',
      keywords: ['history', 'archive', 'pin'],
    },
    {
      id: 'route:logs',
      title: m.nav.logs,
      subtitle: r.logsSubtitle,
      path: '/settings/logs',
      keywords: ['debug', 'errors'],
    },
    {
      id: 'route:skills',
      title: m.nav.skills,
      subtitle: r.skillsSubtitle,
      path: '/skills',
      keywords: ['tools', 'catalog'],
    },
    {
      id: 'route:connectors',
      title: m.nav.connectors,
      subtitle: r.connectorsSubtitle,
      path: '/connectors',
      keywords: ['connector', 'mcp', 'registry', 'integration', 'tools'],
    },
    {
      id: 'route:channels',
      title: m.nav.channels,
      subtitle: r.channelsSubtitle,
      path: '/channels',
      keywords: ['telegram', 'weixin', 'feishu', 'channel'],
    },
    {
      id: 'route:channels:telegram',
      title: 'Telegram',
      subtitle: r.channelsSubtitle,
      path: channelDetailPath('telegram'),
      keywords: ['telegram', 'bot', 'channel', 'pairing'],
    },
    {
      id: 'route:channels:weixin',
      title: 'Weixin',
      subtitle: r.channelsSubtitle,
      path: channelDetailPath('weixin'),
      keywords: ['weixin', 'wechat', 'channel', 'qr'],
    },
    {
      id: 'route:channels:feishu',
      title: 'Feishu/Lark',
      subtitle: r.channelsSubtitle,
      path: channelDetailPath('feishu'),
      keywords: ['feishu', 'lark', 'channel'],
    },
    {
      id: 'route:channels:telegram:pairing',
      title: `Telegram — ${ch.hubPairingButton}`,
      subtitle: r.channelsSubtitle,
      path: channelDetailPath('telegram'),
      keywords: ['telegram', 'pairing', 'approve', 'dm'],
    },
    {
      id: 'route:automations',
      title: 'Automations',
      subtitle: 'Triggers, actions, and run history',
      path: '/automations',
      keywords: ['automation', 'automations', 'schedule', 'tasks', 'history', 'scheduler'],
    },
    {
      id: 'route:settings:goals',
      title: m.nav.settingsGoals,
      subtitle: r.goalsSettingsSubtitle,
      path: '/settings/goals',
      keywords: ['goal', 'checklist', 'judge', '/goal', 'automation'],
    },
    {
      id: 'route:settings:dreams',
      title: m.nav.settingsDreams,
      subtitle: r.dreamsSettingsSubtitle,
      path: '/settings/dreams',
      keywords: ['dream', 'memory', 'consolidation', 'automation'],
    },
    {
      id: 'route:settings',
      title: m.nav.settings,
      subtitle: r.settingsSubtitle,
      path: '/settings/overview',
      keywords: ['config', 'status', 'providers', 'models', 'agents', 'search', 'preferences'],
    },
    // Models & Capabilities center keeps task-specific deep links in query params.
    {
      id: 'route:settings:credentials',
      title: m.nav.settingsCredentials,
      subtitle: r.credentialsSubtitle,
      path: '/settings/credentials',
      keywords: ['api', 'key', 'credentials', 'oauth', 'token', 'models', 'providers'],
    },
    {
      id: 'route:settings:providers',
      title: m.nav.settingsProviders,
      subtitle: r.providersSubtitle,
      path: '/settings/credentials?tab=services',
      keywords: ['api', 'key', 'openai', 'anthropic', 'google'],
    },
    {
      id: 'route:settings:models',
      title: m.nav.settingsModels,
      subtitle: r.modelsSubtitle,
      path: '/settings/credentials?tab=services',
      keywords: ['gpt', 'claude', 'gemini', 'llm'],
    },
    {
      id: 'route:settings:image-models',
      title: m.nav.settingsImageModels,
      subtitle: r.imageModelsSubtitle,
      path: '/settings/credentials?tab=image-models',
      keywords: ['image', 'vision', 'generate', 'picture'],
    },
    {
      id: 'route:settings:voice',
      title: m.nav.settingsVoice,
      subtitle: r.voiceSubtitle,
      path: '/settings/credentials?tab=voice',
      keywords: ['tts', 'stt', 'speech', 'microphone'],
    },
    {
      id: 'route:settings:search',
      title: m.nav.settingsSearch,
      subtitle: r.searchSubtitle,
      path: '/settings/credentials?tab=search',
      keywords: ['search', 'web', 'tavily', 'serper', 'brave'],
    },
    {
      id: 'route:settings:gateway',
      title: m.nav.settingsGateway,
      subtitle: r.gatewaySubtitle,
      path: '/settings/gateway',
      keywords: ['server', 'port', 'auth', 'token'],
    },
      ...buildAgentSettingsRouteSeeds(language, settingsMode),
  ],
    settingsMode,
  );
}
