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
      model: string;
      modelPlaceholder: string;
      thinkingLevel: string;
      newSession: string;
      welcomeTitle: string;
      welcomeDescription: string;
      you: string;
      assistant: string;
      tool: string;
      thinkingLabel: string;
      thoughts: string;
      thoughtsStreaming: string;
      thoughtsExpandHint: string;
      thinkingLevels: Record<'off' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh' | 'adaptive', string>;
      toolInput: string;
      toolOutput: string;
      noOutput: string;
      attachFile: string;
      maxAttachmentsReached: string;
      maxAttachmentsTruncated: string;
      inputPlaceholder: string;
      currentModel: string;
      modelSearchPlaceholder: string;
      modelNoMatches: string;
      dropFiles: string;
      voiceComingSoon: string;
      loadOlder: string;
      scrollToBottom: string;
    };
  }
> = {
  en: {
    appBrand: 'XOPCBOT Gateway',
    appSubtitle: 'Console',
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
      model: 'Model',
      modelPlaceholder: 'Select a model…',
      thinkingLevel: 'Thinking',
      newSession: 'New chat',
      welcomeTitle: 'Welcome to xopcbot',
      welcomeDescription: 'Send a message to get started',
      you: 'You',
      assistant: 'Assistant',
      tool: 'Tool',
      thinkingLabel: 'thinking…',
      thoughts: 'Thoughts',
      thoughtsStreaming: 'Thinking…',
      thoughtsExpandHint: 'Expand to view model thoughts',
      thinkingLevels: {
        off: 'Off',
        minimal: 'Minimal',
        low: 'Low',
        medium: 'Medium',
        high: 'High',
        xhigh: 'X-High',
        adaptive: 'Adaptive',
      },
      toolInput: 'Input',
      toolOutput: 'Output',
      noOutput: '(no output)',
      attachFile: 'Attach file',
      maxAttachmentsReached: 'Maximum {{max}} files per message. Remove some to add more.',
      maxAttachmentsTruncated: '{{dropped}} file(s) not added (limit {{max}} per message).',
      inputPlaceholder: 'Plan, @ for context, / for commands',
      currentModel: 'Model used for this conversation',
      modelSearchPlaceholder: 'Search by name, provider, or ID…',
      modelNoMatches: 'No models match your search',
      dropFiles: 'Drop files here to attach',
      voiceComingSoon: 'Voice input (coming soon)',
      loadOlder: 'Loading older messages…',
      scrollToBottom: 'Scroll to bottom',
    },
  },
  zh: {
    appBrand: 'XOPCBOT Gateway',
    appSubtitle: '控制台',
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
      model: '模型',
      modelPlaceholder: '选择模型…',
      thinkingLevel: '思考级别',
      newSession: '新对话',
      welcomeTitle: '欢迎使用 xopcbot',
      welcomeDescription: '在下方输入消息开始对话',
      you: '你',
      assistant: '助手',
      tool: '工具',
      thinkingLabel: '思考中…',
      thoughts: '思考内容',
      thoughtsStreaming: '思考中…',
      thoughtsExpandHint: '展开查看模型思考过程',
      thinkingLevels: {
        off: '关闭',
        minimal: '最低',
        low: '低',
        medium: '中',
        high: '高',
        xhigh: '极高',
        adaptive: '自适应',
      },
      toolInput: '输入',
      toolOutput: '输出',
      noOutput: '（无输出）',
      attachFile: '添加附件',
      maxAttachmentsReached: '每条消息最多 {{max}} 个文件，请先移除部分附件。',
      maxAttachmentsTruncated: '已忽略 {{dropped}} 个文件（每条最多 {{max}} 个）。',
      inputPlaceholder: '输入计划，@ 引用上下文，/ 命令',
      currentModel: '当前对话使用的模型',
      modelSearchPlaceholder: '按名称、提供商或 ID 搜索…',
      modelNoMatches: '没有匹配的模型',
      dropFiles: '将文件拖放到此处添加',
      voiceComingSoon: '语音输入（即将推出）',
      loadOlder: '正在加载更早的消息…',
      scrollToBottom: '回到底部',
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
