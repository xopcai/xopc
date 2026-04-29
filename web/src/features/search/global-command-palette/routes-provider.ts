import { messages } from '@/i18n/messages';

export type RouteHitSeed = {
  id: string;
  title: string;
  subtitle?: string;
  path: string;
  keywords?: string[];
};

export function buildRouteSeeds(language: 'en' | 'zh'): RouteHitSeed[] {
  const m = messages(language);
  return [
    {
      id: 'route:chat',
      title: m.nav.chat,
      subtitle: language === 'zh' ? '打开聊天' : 'Open chat',
      path: '/chat',
      keywords: ['chat', 'new', 'compose', 'assistant'],
    },
    {
      id: 'route:agents',
      title: m.nav.agents,
      subtitle: language === 'zh' ? '管理智能体' : 'Manage agents',
      path: '/agents',
      keywords: ['agent', 'persona', 'switch'],
    },
    {
      id: 'route:apps',
      title: m.nav.apps,
      subtitle: language === 'zh' ? '扩展应用' : 'Extension apps',
      path: '/apps',
      keywords: ['extension', 'plugin', 'addon'],
    },
    {
      id: 'route:sessions',
      title: m.nav.sessions,
      subtitle: language === 'zh' ? '管理与搜索会话' : 'Manage and search sessions',
      path: '/settings/sessions',
      keywords: ['history', 'archive', 'pin'],
    },
    {
      id: 'route:logs',
      title: m.nav.logs,
      subtitle: language === 'zh' ? '查看日志' : 'View logs',
      path: '/settings/logs',
      keywords: ['debug', 'errors'],
    },
    {
      id: 'route:skills',
      title: m.nav.skills,
      subtitle: language === 'zh' ? '管理技能' : 'Manage skills',
      path: '/skills',
      keywords: ['tools', 'catalog'],
    },
    {
      id: 'route:channels',
      title: m.nav.channels,
      subtitle: language === 'zh' ? '消息通道设置' : 'Channel settings',
      path: '/channels',
      keywords: ['telegram', 'weixin'],
    },
    {
      id: 'route:cron',
      title: m.nav.cron,
      subtitle: language === 'zh' ? '定时任务与调度' : 'Cron jobs and schedules',
      path: '/cron',
      keywords: ['schedule', 'jobs'],
    },
    {
      id: 'route:settings',
      title: m.nav.settings,
      subtitle: language === 'zh' ? '打开设置' : 'Open settings',
      path: '/settings/appearance',
      keywords: ['config', 'appearance', 'providers', 'models', 'agents', 'search', 'preferences'],
    },
    {
      id: 'route:settings:providers',
      title: m.nav.settingsProviders,
      subtitle: language === 'zh' ? 'AI 服务商配置' : 'AI provider configuration',
      path: '/settings/providers',
      keywords: ['api', 'key', 'openai', 'anthropic', 'google'],
    },
    {
      id: 'route:settings:models',
      title: m.nav.settingsModels,
      subtitle: language === 'zh' ? '模型配置' : 'Model configuration',
      path: '/settings/models',
      keywords: ['gpt', 'claude', 'gemini', 'llm'],
    },
    {
      id: 'route:settings:voice',
      title: m.nav.settingsVoice,
      subtitle: language === 'zh' ? '语音设置' : 'Voice settings',
      path: '/settings/voice',
      keywords: ['tts', 'stt', 'speech', 'microphone'],
    },
    {
      id: 'route:settings:gateway',
      title: m.nav.settingsGateway,
      subtitle: language === 'zh' ? '网关设置' : 'Gateway settings',
      path: '/settings/gateway',
      keywords: ['server', 'port', 'auth', 'token'],
    },
  ];
}
