import type { StoredLanguage } from '@/lib/storage';
import { messages } from '@/i18n/messages';

export type RouteHitSeed = {
  id: string;
  title: string;
  subtitle?: string;
  path: string;
  keywords?: string[];
};

export function buildRouteSeeds(language: StoredLanguage): RouteHitSeed[] {
  const m = messages(language);
  const r = m.commandPalette.routes;
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
      keywords: ['telegram', 'weixin'],
    },
    {
      id: 'route:cron',
      title: m.nav.cron,
      subtitle: r.cronSubtitle,
      path: '/cron',
      keywords: ['schedule', 'jobs'],
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
  ];
}
