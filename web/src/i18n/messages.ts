import type { StoredLanguage } from '@/lib/storage';

export type Tab =
  | 'chat'
  | 'sessions'
  | 'cron'
  | 'skills'
  | 'logs'
  | 'settingsAgent'
  | 'settingsProviders'
  | 'settingsModels'
  | 'settingsChannels'
  | 'settingsVoice'
  | 'settingsGateway';

export type SettingsSectionId = 'agent' | 'providers' | 'models' | 'channels' | 'voice' | 'gateway';

const bundles: Record<
  StoredLanguage,
  {
    appBrand: string;
    appSubtitle: string;
    nav: Record<Tab | 'management' | 'settings', string>;
    settingsSections: Record<SettingsSectionId, string>;
    token: {
      title: string;
      description: string;
      gatewayUrl: string;
      tokenLabel: string;
      placeholder: string;
      save: string;
      show: string;
      hide: string;
    };
    connection: {
      connecting: string;
      online: string;
      reconnecting: string;
      offline: string;
      error: string;
      reconnect: string;
    };
    chat: {
      typeMessage: string;
      sendMessage: string;
      abort: string;
      needToken: string;
      loading: string;
    };
  }
> = {
  en: {
    appBrand: 'xopcbot',
    appSubtitle: 'Gateway console',
    nav: {
      chat: 'Chat',
      management: 'Management',
      settings: 'Settings',
      sessions: 'Sessions',
      cron: 'Cron Jobs',
      skills: 'Skills',
      logs: 'Logs',
      settingsAgent: 'Agent',
      settingsProviders: 'Providers',
      settingsModels: 'Models',
      settingsChannels: 'Channels',
      settingsVoice: 'Voice',
      settingsGateway: 'Gateway',
    },
    settingsSections: {
      agent: 'Agent',
      providers: 'Providers',
      models: 'Models',
      channels: 'Channels',
      voice: 'Voice',
      gateway: 'Gateway',
    },
    token: {
      title: 'Authentication required',
      description: 'Enter your gateway token to continue.',
      gatewayUrl: 'Gateway URL',
      tokenLabel: 'Token',
      placeholder: 'Gateway token (e.g. ea4c67bf…)',
      save: 'Save',
      show: 'Show',
      hide: 'Hide',
    },
    connection: {
      connecting: 'Connecting…',
      online: 'Online',
      reconnecting: 'Reconnecting…',
      offline: 'Offline',
      error: 'Connection error',
      reconnect: 'Reconnect',
    },
    chat: {
      typeMessage: 'Type a message…',
      sendMessage: 'Send',
      abort: 'Abort',
      needToken: 'Save a gateway token to chat.',
      loading: 'Loading conversation…',
    },
  },
  zh: {
    appBrand: 'xopcbot',
    appSubtitle: '网关控制台',
    nav: {
      chat: '对话',
      management: '管理',
      settings: '设置',
      sessions: '会话',
      cron: '定时任务',
      skills: '技能',
      logs: '日志',
      settingsAgent: '代理',
      settingsProviders: '提供商',
      settingsModels: '模型',
      settingsChannels: '渠道',
      settingsVoice: '语音',
      settingsGateway: '网关',
    },
    settingsSections: {
      agent: '代理',
      providers: '提供商',
      models: '模型',
      channels: '渠道',
      voice: '语音',
      gateway: '网关',
    },
    token: {
      title: '需要身份验证',
      description: '请输入网关 Token 以继续。',
      gatewayUrl: '网关地址',
      tokenLabel: 'Token',
      placeholder: '网关 Token（例如 ea4c67bf…）',
      save: '保存',
      show: '显示',
      hide: '隐藏',
    },
    connection: {
      connecting: '连接中…',
      online: '在线',
      reconnecting: '重连中…',
      offline: '离线',
      error: '连接异常',
      reconnect: '重连',
    },
    chat: {
      typeMessage: '输入消息…',
      sendMessage: '发送',
      abort: '中止',
      needToken: '请先保存网关 Token 后再对话。',
      loading: '加载对话中…',
    },
  },
};

export type TabGroup = { label: string; tabs: readonly Tab[] };

export function getTabGroups(lang: StoredLanguage): TabGroup[] {
  const m = messages(lang);
  return [
    { label: m.nav.chat, tabs: ['chat'] as const },
    { label: m.nav.management, tabs: ['sessions', 'cron', 'skills', 'logs'] as const },
    {
      label: m.nav.settings,
      tabs: [
        'settingsAgent',
        'settingsProviders',
        'settingsModels',
        'settingsChannels',
        'settingsVoice',
        'settingsGateway',
      ] as const,
    },
  ];
}

export function messages(lang: StoredLanguage) {
  return bundles[lang];
}

export function tabLabel(lang: StoredLanguage, tab: Tab): string {
  const m = messages(lang);
  return m.nav[tab];
}
