import type { StoredLanguage } from '@/lib/storage';
import { messages, tabLabel, type Tab } from '@/i18n/messages';
import { pathForTab, SETTINGS_SHELL_NAV_GROUPS } from '@/navigation';
import { channelDetailPath } from '@/features/settings/channels/channels-routes';

export type RouteHitSeed = {
  id: string;
  title: string;
  subtitle?: string;
  path: string;
  keywords?: string[];
};

const AGENT_DEFAULTS_ROUTE_KEYWORDS: Partial<Record<Tab, string[]>> = {
  settingsAgentChat: ['model', 'temperature', 'sampling', 'chat'],
  settingsAgentWorkspace: ['workspace', 'directory', 'folder', 'attachments'],
  settingsAgentBrowser: ['browser', 'playwright', 'automation'],
  settingsAgentRuntime: ['limits', 'turn', 'timeout', 'tool', 'iterations'],
  settingsAgentContext: ['context', 'compaction', 'pruning', 'tokens'],
  settingsAgentMemory: ['memory', 'review', 'session', 'search'],
  settingsAgentTools: ['tools', 'web', 'extract', 'code'],
  settingsAgentSkills: ['skills', 'allowlist', 'marketplace'],
  settingsAgentSystemPrompt: ['system', 'prompt', 'instructions'],
  settingsAgentMcp: ['mcp', 'external', 'tools'],
};

function buildAgentDefaultsRouteSeeds(language: StoredLanguage): RouteHitSeed[] {
  const m = messages(language);
  const subtitle = m.commandPalette.routes.agentDefaultsSubtitle;
  const agentGroup = SETTINGS_SHELL_NAV_GROUPS.find((g) => g.id === 'agent');
  if (!agentGroup) {
    return [];
  }
  return agentGroup.tabs.map((tab) => ({
    id: `route:settings:agent:${tab}`,
    title: tabLabel(language, tab),
    subtitle,
    path: pathForTab(tab),
    keywords: ['agent', 'defaults', 'config', ...(AGENT_DEFAULTS_ROUTE_KEYWORDS[tab] ?? [])],
  }));
}

export function buildRouteSeeds(language: StoredLanguage): RouteHitSeed[] {
  const m = messages(language);
  const r = m.commandPalette.routes;
  const ch = m.channelsSettings;
  return [
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
      id: 'route:apps',
      title: m.nav.apps,
      subtitle: r.appsSubtitle,
      path: '/apps',
      keywords: ['extension', 'plugin', 'addon'],
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
      id: 'route:channels',
      title: m.nav.channels,
      subtitle: r.channelsSubtitle,
      path: '/channels',
      keywords: ['telegram', 'weixin', 'feishu', 'channel'],
    },
    {
      id: 'route:channels:telegram',
      title: ch.telegramTitle,
      subtitle: r.channelsSubtitle,
      path: channelDetailPath('telegram'),
      keywords: ['telegram', 'bot', 'channel', 'pairing'],
    },
    {
      id: 'route:channels:weixin',
      title: ch.weixinTitle,
      subtitle: r.channelsSubtitle,
      path: channelDetailPath('weixin'),
      keywords: ['weixin', 'wechat', 'channel', 'qr'],
    },
    {
      id: 'route:channels:feishu',
      title: ch.feishuTitle,
      subtitle: r.channelsSubtitle,
      path: channelDetailPath('feishu'),
      keywords: ['feishu', 'lark', 'channel'],
    },
    {
      id: 'route:channels:telegram:pairing',
      title: `${ch.telegramTitle} — ${ch.hubPairingButton}`,
      subtitle: r.channelsSubtitle,
      path: channelDetailPath('telegram', { pairing: true }),
      keywords: ['telegram', 'pairing', 'approve', 'dm'],
    },
    {
      id: 'route:cron',
      title: m.nav.cron,
      subtitle: r.cronSubtitle,
      path: '/cron',
      keywords: ['schedule', 'jobs', 'tasks', 'history'],
    },
    {
      id: 'route:settings:cron',
      title: m.nav.settingsCron,
      subtitle: r.cronSettingsSubtitle,
      path: '/settings/cron',
      keywords: ['schedule', 'scheduler', 'timezone', 'concurrency', 'cron', 'automation'],
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
    {
      id: 'route:settings:credentials',
      title: m.nav.settingsCredentials,
      subtitle: r.credentialsSubtitle,
      path: '/settings/credentials',
      keywords: ['api', 'key', 'credentials', 'oauth', 'token'],
    },
    {
      id: 'route:settings:providers',
      title: m.nav.settingsProviders,
      subtitle: r.providersSubtitle,
      path: '/settings/providers',
      keywords: ['api', 'key', 'openai', 'anthropic', 'google'],
    },
    {
      id: 'route:settings:models',
      title: m.nav.settingsModels,
      subtitle: r.modelsSubtitle,
      path: '/settings/models',
      keywords: ['gpt', 'claude', 'gemini', 'llm'],
    },
    {
      id: 'route:settings:voice',
      title: m.nav.settingsVoice,
      subtitle: r.voiceSubtitle,
      path: '/settings/voice',
      keywords: ['tts', 'stt', 'speech', 'microphone'],
    },
    {
      id: 'route:settings:gateway',
      title: m.nav.settingsGateway,
      subtitle: r.gatewaySubtitle,
      path: '/settings/gateway',
      keywords: ['server', 'port', 'auth', 'token'],
    },
    ...buildAgentDefaultsRouteSeeds(language),
  ];
}
