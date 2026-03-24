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
    sessions: {
      title: string;
      needToken: string;
      searchPlaceholder: string;
      filterAll: string;
      filterActive: string;
      filterPinned: string;
      filterArchived: string;
      totalSessions: string;
      activeSessions: string;
      pinnedSessions: string;
      archivedSessions: string;
      sessionCount: string;
      loadMore: string;
      noSessions: string;
      noSessionsDescription: string;
      continueChat: string;
      archive: string;
      unarchive: string;
      pin: string;
      unpin: string;
      export: string;
      delete: string;
      deleteSessionTitle: string;
      deleteSessionMessage: string;
      cancel: string;
      loading: string;
      loadError: string;
      gridView: string;
      listView: string;
      detailLoading: string;
      detailMessages: string;
      detailExport: string;
      close: string;
    };
    cron: {
      title: string;
      subtitle: string;
      needToken: string;
      statsRegion: string;
      jobsHeading: string;
      addJob: string;
      editJob: string;
      name: string;
      namePlaceholder: string;
      nameRequired: string;
      schedule: string;
      message: string;
      messagePlaceholder: string;
      create: string;
      runNow: string;
      delete: string;
      edit: string;
      enabled: string;
      disabled: string;
      running: string;
      nextRun: string;
      status: string;
      runHistoryTitle: string;
      runHistoryHint: string;
      detailRunHistory: string;
      colStarted: string;
      colJob: string;
      colDuration: string;
      colDetail: string;
      execStatusRunning: string;
      execStatusSuccess: string;
      execStatusFailed: string;
      execStatusCancelled: string;
      noRunsYet: string;
      confirmDelete: string;
      confirmRun: string;
      scheduleLabel: string;
      messageLabel: string;
      totalJobs: string;
      emptyStateTitle: string;
      emptyStateHint: string;
      emptyStateCta: string;
      channel: string;
      channelLocal: string;
      deliveryTargetLocalChannel: string;
      recipient: string;
      recipientPlaceholder: string;
      refreshList: string;
      refreshRecipientHint: string;
      selectRecipient: string;
      noRecentChatsOption: string;
      deliveryTarget: string;
      scheduleHintPreset: string;
      mode: string;
      modeDirect: string;
      modeAgent: string;
      modeDirectOption: string;
      modeAgentOption: string;
      agentLocalOnly: string;
      agentLocalOnlyHint: string;
      deliveryLocalOnly: string;
      model: string;
      save: string;
      failedToLoadJobs: string;
      scheduleRequired: string;
      chatIdRequired: string;
      failedToCreateJob: string;
      failedToUpdateJob: string;
      failedToToggleJob: string;
      actionFailed: string;
      enterManuallyOrSelect: string;
      noRecentChats: string;
      refresh: string;
      close: string;
      cancel: string;
      loading: string;
      schedulePresets: {
        custom: string;
        everyMinute: string;
        every5Minutes: string;
        every10Minutes: string;
        every15Minutes: string;
        every30Minutes: string;
        everyHour: string;
        every2Hours: string;
        every4Hours: string;
        every6Hours: string;
        every12Hours: string;
        everyDayMidnight: string;
        everyDay9AM: string;
        everyDay9PM: string;
      };
      timeLabels: {
        overdue: string;
        lessThanMinute: string;
        minutes: string;
        hours: string;
      };
      lastActiveLabels: {
        justNow: string;
        minutesAgo: string;
        hoursAgo: string;
        daysAgo: string;
      };
    };
    skills: {
      title: string;
      needToken: string;
      hint: string;
      refresh: string;
      refreshSuccess: string;
      reloadSuccess: string;
      reloadRuntime: string;
      uploadSection: string;
      dropHint: string;
      searchPlaceholder: string;
      noSearchResults: string;
      uploading: string;
      tableTitle: string;
      loading: string;
      empty: string;
      loadFailed: string;
      reloadFailed: string;
      uploadFailed: string;
      zipOnly: string;
      delete: string;
      deleteTitle: string;
      deleteMessage: string;
      deleteConfirm: string;
      deleteFailed: string;
      yes: string;
      no: string;
      cancel: string;
      source: { builtin: string; workspace: string; global: string };
      col: { name: string; description: string; source: string; managed: string; actions: string };
    };
    logs: {
      title: string;
      subtitle: string;
      needToken: string;
      filters: string;
      level: string;
      searchPlaceholder: string;
      module: string;
      allModules: string;
      timeRange: string;
      from: string;
      to: string;
      clear: string;
      refresh: string;
      autoRefresh: string;
      pause: string;
      liveHint: string;
      logFiles: string;
      filesEmpty: string;
      loadMore: string;
      showingCount: string;
      moreAvailable: string;
      noLogs: string;
      noLogsDescription: string;
      loading: string;
      loadError: string;
      details: string;
      close: string;
      time: string;
      message: string;
      metadata: string;
      statsRegion: string;
      statsHint: string;
      logDir: string;
      requestId: string;
      sessionId: string;
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
    sessions: {
      title: 'Sessions',
      needToken: 'Save a gateway token to manage sessions.',
      searchPlaceholder: 'Search sessions…',
      filterAll: 'All',
      filterActive: 'Active',
      filterPinned: 'Pinned',
      filterArchived: 'Archived',
      totalSessions: 'Total',
      activeSessions: 'Active',
      pinnedSessions: 'Pinned',
      archivedSessions: 'Archived',
      sessionCount: '{{count}} shown',
      loadMore: 'Load more',
      noSessions: 'No sessions yet',
      noSessionsDescription: 'Start a conversation in Chat; sessions will appear here.',
      continueChat: 'Continue in chat',
      archive: 'Archive',
      unarchive: 'Unarchive',
      pin: 'Pin',
      unpin: 'Unpin',
      export: 'Export JSON',
      delete: 'Delete',
      deleteSessionTitle: 'Delete session?',
      deleteSessionMessage: 'Delete “{{name}}”? This cannot be undone.',
      cancel: 'Cancel',
      loading: 'Loading…',
      loadError: 'Failed to load sessions',
      gridView: 'Grid',
      listView: 'List',
      detailLoading: 'Loading session…',
      detailMessages: 'Messages',
      detailExport: 'Export',
      close: 'Close',
    },
    cron: {
      title: 'Cron Jobs',
      subtitle: 'Schedule messages and agent turns on a fixed cadence.',
      needToken: 'Save a gateway token to manage cron jobs.',
      statsRegion: 'Overview',
      jobsHeading: 'Scheduled jobs',
      addJob: 'Add Cron Job',
      editJob: 'Edit Cron Job',
      name: 'Name *',
      namePlaceholder: 'My scheduled task',
      nameRequired: 'Name is required',
      schedule: 'Schedule (cron expression) *',
      message: 'Message *',
      messagePlaceholder: 'What should the assistant do?',
      create: 'Create Job',
      runNow: 'Run Now',
      delete: 'Delete',
      edit: 'Edit',
      enabled: 'Enabled',
      disabled: 'Disabled',
      running: 'Running',
      nextRun: 'Next Run',
      status: 'Status',
      runHistoryTitle: 'Run log',
      runHistoryHint: 'Completed runs are stored on disk (state/cron/runs). Use Refresh to update.',
      detailRunHistory: 'Recent runs',
      colStarted: 'Started',
      colJob: 'Job',
      colDuration: 'Duration',
      colDetail: 'Result',
      execStatusRunning: 'Running',
      execStatusSuccess: 'Success',
      execStatusFailed: 'Failed',
      execStatusCancelled: 'Skipped',
      noRunsYet: 'No executions recorded yet.',
      confirmDelete: 'Are you sure you want to delete this cron job?',
      confirmRun: 'Run this cron job now?',
      scheduleLabel: 'Schedule',
      messageLabel: 'Message',
      totalJobs: 'Total jobs',
      emptyStateTitle: 'No scheduled jobs yet',
      emptyStateHint: 'Create a job to send on a cron schedule—directly or via the agent.',
      emptyStateCta: 'Create your first job',
      channel: 'Channel',
      channelLocal: 'Local (no outbound)',
      deliveryTargetLocalChannel: 'Local channel — transcript or message stays on this machine',
      recipient: 'Recipient *',
      recipientPlaceholder: 'Telegram: numeric id, or pick from recent sessions',
      refreshList: 'Refresh',
      refreshRecipientHint: 'Reload list from recent sessions',
      selectRecipient: '— Select —',
      noRecentChatsOption: 'No recent sessions',
      deliveryTarget: 'Delivery',
      scheduleHintPreset: 'Select a preset or enter custom cron expression',
      mode: 'Mode',
      modeDirect: 'Send message directly to the channel without AI processing',
      modeAgent: 'Use AI agent to process the message, then send the response',
      modeDirectOption: 'Direct (send message directly)',
      modeAgentOption: 'AI Agent (process with AI then send)',
      agentLocalOnly: 'Local only (save transcript, no channel send)',
      agentLocalOnlyHint:
        'Runs the agent on this machine. Conversation is stored as a session (key cron:<job id>) with type cron; no Telegram or CLI delivery.',
      deliveryLocalOnly: 'Local only — transcript saved under session key cron:<job id>',
      model: 'Model',
      save: 'Save',
      failedToLoadJobs: 'Failed to load jobs',
      scheduleRequired: 'Schedule and message are required',
      chatIdRequired: 'Chat ID is required',
      failedToCreateJob: 'Failed to create job',
      failedToUpdateJob: 'Failed to save job',
      failedToToggleJob: 'Failed to toggle job',
      actionFailed: 'Action failed',
      enterManuallyOrSelect: 'Enter manually or select from recent chats',
      noRecentChats: 'No recent chats found. Enter chat ID manually (e.g., 123456789 for Telegram)',
      refresh: 'Refresh',
      close: 'Close',
      cancel: 'Cancel',
      loading: 'Loading…',
      schedulePresets: {
        custom: '-- Custom (enter below) --',
        everyMinute: 'Every minute',
        every5Minutes: 'Every 5 minutes (default)',
        every10Minutes: 'Every 10 minutes',
        every15Minutes: 'Every 15 minutes',
        every30Minutes: 'Every 30 minutes',
        everyHour: 'Every hour',
        every2Hours: 'Every 2 hours',
        every4Hours: 'Every 4 hours',
        every6Hours: 'Every 6 hours',
        every12Hours: 'Every 12 hours',
        everyDayMidnight: 'Every day at midnight',
        everyDay9AM: 'Every day at 9:00 AM',
        everyDay9PM: 'Every day at 9:00 PM',
      },
      timeLabels: {
        overdue: 'Overdue',
        lessThanMinute: 'Less than a minute',
        minutes: '{{count}} min',
        hours: '{{count}} hours',
      },
      lastActiveLabels: {
        justNow: 'just now',
        minutesAgo: '{{count}}m ago',
        hoursAgo: '{{count}}h ago',
        daysAgo: '{{count}}d ago',
      },
    },
    skills: {
      title: 'Skills',
      needToken: 'Save a gateway token to manage skills.',
      hint: 'Upload a .zip containing SKILL.md at the archive root or inside one folder (e.g. my-skill/SKILL.md). Managed skills are stored under ~/.xopcbot/skills. Reload updates the running agent’s skill list.',
      refresh: 'Refresh list',
      refreshSuccess: 'List refreshed.',
      reloadSuccess: 'Reloaded from disk and list updated.',
      reloadRuntime: 'Reload from disk',
      uploadSection: 'Install or update (zip)',
      dropHint: 'Drag and drop a .zip here, or click this area to choose a file.',
      searchPlaceholder: 'Search by name, description, folder…',
      noSearchResults: 'No skills match your search.',
      uploading: 'Uploading…',
      tableTitle: 'Loaded skills',
      loading: 'Loading…',
      empty: 'No skills loaded.',
      loadFailed: 'Failed to load skills',
      reloadFailed: 'Failed to reload skills',
      uploadFailed: 'Upload failed',
      zipOnly: 'Please choose a .zip file',
      delete: 'Delete',
      deleteTitle: 'Delete skill',
      deleteMessage: 'Remove folder "{{id}}" from managed skills? This cannot be undone.',
      deleteConfirm: 'Delete',
      deleteFailed: 'Failed to delete skill',
      yes: 'Yes',
      no: 'No',
      cancel: 'Cancel',
      source: {
        builtin: 'Bundled',
        workspace: 'Workspace',
        global: 'Global',
      },
      col: {
        name: 'Name',
        description: 'Description',
        source: 'Source',
        managed: 'Managed',
        actions: 'Actions',
      },
    },
    logs: {
      title: 'Logs',
      subtitle: 'Runtime diagnostics and history from the gateway.',
      needToken: 'Save a gateway token to view logs.',
      filters: 'Filters',
      level: 'Level',
      searchPlaceholder: 'Search message or module…',
      module: 'Module',
      allModules: 'All modules',
      timeRange: 'Time range',
      from: 'From',
      to: 'To',
      clear: 'Clear',
      refresh: 'Refresh',
      autoRefresh: 'Auto refresh',
      pause: 'Pause',
      liveHint: 'Refreshing every 5s',
      logFiles: 'Log files',
      filesEmpty: 'No log files on disk',
      loadMore: 'Load more',
      showingCount: '{{count}} entries loaded',
      moreAvailable: 'Earlier entries may be available',
      noLogs: 'No matching entries',
      noLogsDescription: 'Adjust filters or search, or try again later.',
      loading: 'Loading…',
      loadError: 'Failed to load logs',
      details: 'Log details',
      close: 'Close',
      time: 'Time',
      message: 'Message',
      metadata: 'Metadata',
      statsRegion: 'Sample (recent files)',
      statsHint: 'Counts are sampled from recent log files, not totals.',
      logDir: 'Directory',
      requestId: 'Request ID',
      sessionId: 'Session ID',
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
    sessions: {
      title: '会话',
      needToken: '请先保存网关 Token 后再管理会话。',
      searchPlaceholder: '搜索会话…',
      filterAll: '全部',
      filterActive: '活跃',
      filterPinned: '置顶',
      filterArchived: '归档',
      totalSessions: '总计',
      activeSessions: '活跃',
      pinnedSessions: '置顶',
      archivedSessions: '归档',
      sessionCount: '已显示 {{count}} 个',
      loadMore: '加载更多',
      noSessions: '暂无会话',
      noSessionsDescription: '在「对话」中开始聊天后，会话将显示在这里。',
      continueChat: '在对话中继续',
      archive: '归档',
      unarchive: '取消归档',
      pin: '置顶',
      unpin: '取消置顶',
      export: '导出 JSON',
      delete: '删除',
      deleteSessionTitle: '删除会话？',
      deleteSessionMessage: '确定删除「{{name}}」吗？此操作不可恢复。',
      cancel: '取消',
      loading: '加载中…',
      loadError: '加载会话失败',
      gridView: '网格',
      listView: '列表',
      detailLoading: '加载会话…',
      detailMessages: '消息',
      detailExport: '导出',
      close: '关闭',
    },
    cron: {
      title: '定时任务',
      subtitle: '按计划发送消息或执行代理回合。',
      needToken: '请先保存网关 Token 后再管理定时任务。',
      statsRegion: '概览',
      jobsHeading: '计划任务',
      addJob: '添加定时任务',
      editJob: '编辑定时任务',
      name: '名称 *',
      namePlaceholder: '我的定时任务',
      nameRequired: '请填写名称',
      schedule: '计划（cron 表达式）*',
      message: '消息 *',
      messagePlaceholder: '助手应该做什么？',
      create: '创建任务',
      runNow: '立即执行',
      delete: '删除',
      edit: '编辑',
      enabled: '已启用',
      disabled: '已禁用',
      running: '运行中',
      nextRun: '下次执行',
      status: '状态',
      runHistoryTitle: '执行记录',
      runHistoryHint: '已完成的执行会保存在本地（state/cron/runs）。点击刷新更新列表。',
      detailRunHistory: '最近执行',
      colStarted: '开始时间',
      colJob: '任务',
      colDuration: '耗时',
      colDetail: '结果',
      execStatusRunning: '运行中',
      execStatusSuccess: '成功',
      execStatusFailed: '失败',
      execStatusCancelled: '已跳过',
      noRunsYet: '暂无执行记录。',
      confirmDelete: '确定要删除此定时任务吗？',
      confirmRun: '立即执行此定时任务？',
      scheduleLabel: '计划',
      messageLabel: '消息',
      totalJobs: '任务总数',
      emptyStateTitle: '暂无定时任务',
      emptyStateHint: '创建任务即可按 cron 计划发送——直连渠道或经 AI 代理处理。',
      emptyStateCta: '创建第一个任务',
      channel: '渠道',
      channelLocal: '本地（不发出）',
      deliveryTargetLocalChannel: '本地渠道 — 内容仅保存在本机',
      recipient: '收件人 *',
      recipientPlaceholder: 'Telegram：填写数字 id，或从下方最近会话选择',
      refreshList: '刷新',
      refreshRecipientHint: '从最近会话重新加载列表',
      selectRecipient: '— 请选择 —',
      noRecentChatsOption: '暂无最近会话',
      deliveryTarget: '投递目标',
      scheduleHintPreset: '选择预设或输入自定义 cron 表达式',
      mode: '模式',
      modeDirect: '直接发送消息到渠道，不经过 AI 处理',
      modeAgent: '使用 AI 代理处理消息，然后发送回复',
      modeDirectOption: '直接发送（直接发送到渠道）',
      modeAgentOption: 'AI 代理（经过 AI 处理后发送）',
      agentLocalOnly: '仅本地运行（保存对话，不发送到渠道）',
      agentLocalOnlyHint:
        '在本机执行代理。对话会存为会话（键 cron:<任务 id>），类型为 cron；不向 Telegram/CLI 投递。',
      deliveryLocalOnly: '仅本地 — 对话保存在会话键 cron:<任务 id>',
      model: '模型',
      save: '保存',
      failedToLoadJobs: '加载任务失败',
      scheduleRequired: '计划表达式和消息为必填项',
      chatIdRequired: 'Chat ID 为必填项',
      failedToCreateJob: '创建任务失败',
      failedToUpdateJob: '保存任务失败',
      failedToToggleJob: '切换任务状态失败',
      actionFailed: '操作失败',
      enterManuallyOrSelect: '手动输入或从最近聊天中选择',
      noRecentChats: '未找到最近聊天。请手动输入 chat ID（例如：Telegram 为 123456789）',
      refresh: '刷新',
      close: '关闭',
      cancel: '取消',
      loading: '加载中…',
      schedulePresets: {
        custom: '-- 自定义（在下方输入） --',
        everyMinute: '每分钟',
        every5Minutes: '每 5 分钟（默认）',
        every10Minutes: '每 10 分钟',
        every15Minutes: '每 15 分钟',
        every30Minutes: '每 30 分钟',
        everyHour: '每小时',
        every2Hours: '每 2 小时',
        every4Hours: '每 4 小时',
        every6Hours: '每 6 小时',
        every12Hours: '每 12 小时',
        everyDayMidnight: '每天午夜',
        everyDay9AM: '每天早上 9 点',
        everyDay9PM: '每天晚上 9 点',
      },
      timeLabels: {
        overdue: '已过期',
        lessThanMinute: '不到 1 分钟',
        minutes: '{{count}} 分钟',
        hours: '{{count}} 小时',
      },
      lastActiveLabels: {
        justNow: '刚刚',
        minutesAgo: '{{count}} 分钟前',
        hoursAgo: '{{count}} 小时前',
        daysAgo: '{{count}} 天前',
      },
    },
    skills: {
      title: '技能',
      needToken: '请先保存网关 Token 后再管理技能。',
      hint: '上传包含 SKILL.md 的 .zip（根目录或单层文件夹，如 my-skill/SKILL.md）。已安装技能保存在 ~/.xopcbot/skills。「从磁盘重载」会刷新运行中代理的技能列表。',
      refresh: '刷新列表',
      refreshSuccess: '列表已刷新。',
      reloadSuccess: '已从磁盘重载并更新列表。',
      reloadRuntime: '从磁盘重载',
      uploadSection: '安装或更新（zip）',
      dropHint: '将 .zip 拖到此处，或点击此区域选择文件。',
      searchPlaceholder: '按名称、描述、文件夹搜索…',
      noSearchResults: '没有匹配的技能。',
      uploading: '上传中…',
      tableTitle: '已加载技能',
      loading: '加载中…',
      empty: '暂无技能。',
      loadFailed: '加载技能失败',
      reloadFailed: '重载失败',
      uploadFailed: '上传失败',
      zipOnly: '请选择 .zip 文件',
      delete: '删除',
      deleteTitle: '删除技能',
      deleteMessage: '确定删除已管理技能目录「{{id}}」？此操作不可恢复。',
      deleteConfirm: '删除',
      deleteFailed: '删除失败',
      yes: '是',
      no: '否',
      cancel: '取消',
      source: {
        builtin: '内置',
        workspace: '工作区',
        global: '全局',
      },
      col: {
        name: '名称',
        description: '描述',
        source: '来源',
        managed: '可管理',
        actions: '操作',
      },
    },
    logs: {
      title: '日志',
      subtitle: '网关运行时的诊断与历史记录。',
      needToken: '请先保存网关 Token 后再查看日志。',
      filters: '筛选',
      level: '级别',
      searchPlaceholder: '搜索消息或模块…',
      module: '模块',
      allModules: '全部模块',
      timeRange: '时间范围',
      from: '开始',
      to: '结束',
      clear: '清除',
      refresh: '刷新',
      autoRefresh: '自动刷新',
      pause: '暂停',
      liveHint: '每 5 秒自动刷新',
      logFiles: '日志文件',
      filesEmpty: '磁盘上暂无日志文件',
      loadMore: '加载更多',
      showingCount: '已加载 {{count}} 条',
      moreAvailable: '可能还有更早的条目',
      noLogs: '没有匹配的条目',
      noLogsDescription: '请调整筛选或搜索，或稍后再试。',
      loading: '加载中…',
      loadError: '加载日志失败',
      details: '日志详情',
      close: '关闭',
      time: '时间',
      message: '消息',
      metadata: '元数据',
      statsRegion: '抽样（近期文件）',
      statsHint: '数量为近期日志文件抽样统计，非全量。',
      logDir: '目录',
      requestId: '请求 ID',
      sessionId: '会话 ID',
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
