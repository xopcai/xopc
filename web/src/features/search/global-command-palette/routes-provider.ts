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
      id: 'route:sessions',
      title: m.nav.sessions,
      subtitle: language === 'zh' ? '管理与搜索会话' : 'Manage and search sessions',
      path: '/sessions',
      keywords: ['history', 'archive', 'pin'],
    },
    {
      id: 'route:logs',
      title: m.nav.logs,
      subtitle: language === 'zh' ? '查看日志' : 'View logs',
      path: '/logs',
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
      subtitle: language === 'zh' ? '渠道设置' : 'Channel settings',
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
      path: '/settings/gateway',
      keywords: ['config', 'appearance', 'providers', 'models', 'agents', 'search'],
    },
  ];
}

