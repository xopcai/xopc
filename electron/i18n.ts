export type ElectronUiLanguage = 'en' | 'zh';

export type ElectronMenuMessages = {
  app: {
    settings: string;
  };
  file: {
    label: string;
    newChat: string;
    quickCapture: string;
    search: string;
    settings: string;
  };
  edit: {
    label: string;
    undo: string;
    redo: string;
    cut: string;
    copy: string;
    paste: string;
    pasteAndMatchStyle: string;
    delete: string;
    selectAll: string;
  };
  view: {
    label: string;
    toggleSidebar: string;
    reload: string;
    forceReload: string;
    toggleDevTools: string;
    resetZoom: string;
    zoomIn: string;
    zoomOut: string;
    toggleFullscreen: string;
  };
  navigate: {
    label: string;
    back: string;
    forward: string;
  };
  agent: {
    label: string;
    agents: string;
    skills: string;
    automations: string;
    providers: string;
    models: string;
  };
  help: {
    label: string;
    documentation: string;
    releaseNotes: string;
    reportIssue: string;
    checkForUpdates: string;
    openLogs: string;
    developerTools: string;
  };
  window: {
    label: string;
    minimize: string;
    zoom: string;
    close: string;
    front: string;
    window: string;
  };
  tray: {
    newChat: string;
    showWindow: string;
    remoteAccess: string;
    settings: string;
    developerTools: string;
    quit: string;
    remoteAccessConnected: string;
    remoteAccessOff: string;
    remoteAccessReconnecting: string;
    remoteAccessError: string;
  };
};

const messages: Record<ElectronUiLanguage, ElectronMenuMessages> = {
  en: {
    app: {
      settings: 'Settings…',
    },
    file: {
      label: 'File',
      newChat: 'New Chat',
      quickCapture: 'Quick Capture',
      search: 'Search',
      settings: 'Settings…',
    },
    edit: {
      label: 'Edit',
      undo: 'Undo',
      redo: 'Redo',
      cut: 'Cut',
      copy: 'Copy',
      paste: 'Paste',
      pasteAndMatchStyle: 'Paste and Match Style',
      delete: 'Delete',
      selectAll: 'Select All',
    },
    view: {
      label: 'View',
      toggleSidebar: 'Toggle Sidebar',
      reload: 'Reload',
      forceReload: 'Force Reload',
      toggleDevTools: 'Toggle Developer Tools',
      resetZoom: 'Actual Size',
      zoomIn: 'Zoom In',
      zoomOut: 'Zoom Out',
      toggleFullscreen: 'Toggle Full Screen',
    },
    navigate: {
      label: 'Navigate',
      back: 'Back',
      forward: 'Forward',
    },
    agent: {
      label: 'Agent',
      agents: 'Agents…',
      skills: 'Skills…',
      automations: 'Automations…',
      providers: 'Providers…',
      models: 'Models…',
    },
    help: {
      label: 'Help',
      documentation: 'Documentation',
      releaseNotes: 'Release Notes',
      reportIssue: 'Report Issue',
      checkForUpdates: 'Check for Updates…',
      openLogs: 'Open Logs',
      developerTools: 'Developer Tools',
    },
    window: {
      label: 'Window',
      minimize: 'Minimize',
      zoom: 'Zoom',
      close: 'Close',
      front: 'Bring All to Front',
      window: 'Window',
    },
    tray: {
      newChat: 'New Chat',
      showWindow: 'Show Window',
      remoteAccess: 'Remote Access…',
      settings: 'Settings',
      developerTools: 'Developer Tools',
      quit: 'Quit',
      remoteAccessConnected: 'Remote Access: Connected ✓',
      remoteAccessOff: 'Remote Access: Off',
      remoteAccessReconnecting: 'Remote Access: Reconnecting…',
      remoteAccessError: 'Remote Access: Error',
    },
  },
  zh: {
    app: {
      settings: '设置…',
    },
    file: {
      label: '文件',
      newChat: '新建聊天',
      quickCapture: '快速记录',
      search: '搜索',
      settings: '设置…',
    },
    edit: {
      label: '编辑',
      undo: '撤销',
      redo: '重做',
      cut: '剪切',
      copy: '复制',
      paste: '粘贴',
      pasteAndMatchStyle: '粘贴并匹配样式',
      delete: '删除',
      selectAll: '全选',
    },
    view: {
      label: '视图',
      toggleSidebar: '切换侧边栏',
      reload: '重新加载',
      forceReload: '强制重新加载',
      toggleDevTools: '切换开发者工具',
      resetZoom: '实际大小',
      zoomIn: '放大',
      zoomOut: '缩小',
      toggleFullscreen: '切换全屏',
    },
    navigate: {
      label: '导航',
      back: '后退',
      forward: '前进',
    },
    agent: {
      label: '智能体',
      agents: '智能体…',
      skills: '技能…',
      automations: '自动化…',
      providers: '服务商…',
      models: '模型…',
    },
    help: {
      label: '帮助',
      documentation: '文档',
      releaseNotes: '更新说明',
      reportIssue: '反馈问题',
      checkForUpdates: '检查更新…',
      openLogs: '打开日志',
      developerTools: '开发者工具',
    },
    window: {
      label: '窗口',
      minimize: '最小化',
      zoom: '缩放',
      close: '关闭',
      front: '全部置于前台',
      window: '窗口',
    },
    tray: {
      newChat: '新建聊天',
      showWindow: '显示窗口',
      remoteAccess: '远程访问…',
      settings: '设置',
      developerTools: '开发者工具',
      quit: '退出',
      remoteAccessConnected: '远程访问：已连接 ✓',
      remoteAccessOff: '远程访问：关闭',
      remoteAccessReconnecting: '远程访问：正在重连…',
      remoteAccessError: '远程访问：错误',
    },
  },
};

export function electronUiLanguageFromLocaleTag(locale: string | undefined | null): ElectronUiLanguage {
  const tag = (locale ?? '').trim().toLowerCase().replace(/_/g, '-');
  if (!tag) return 'en';
  if (tag === 'en' || tag.startsWith('en-')) return 'en';
  return 'zh';
}

export function normalizeElectronUiLanguage(
  language: unknown,
  fallbackLocale?: string | null,
): ElectronUiLanguage {
  if (language === 'en' || language === 'zh') {
    return language;
  }
  return electronUiLanguageFromLocaleTag(fallbackLocale);
}

export function getElectronMenuMessages(language: ElectronUiLanguage): ElectronMenuMessages {
  return messages[language];
}
