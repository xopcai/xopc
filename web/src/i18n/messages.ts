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
    sidebarCollapse: string;
    sidebarExpand: string;
    closeMenu: string;
    openMenu: string;
    /** App header: language & theme in overflow popover (small screens). */
    appBarPreferences: string;
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
    /** Sidebar IA: primary actions, task list, footer (logo + app menu). */
    sidebar: {
      newTask: string;
      tasksHeading: string;
      viewAllSessions: string;
      taskListEmpty: string;
      taskListNeedToken: string;
      taskListAddToken: string;
      taskListStartChat: string;
      appMenuAria: string;
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
      viewSteps_one: string;
      viewSteps_other: string;
      stepSearchedWeb: string;
      stepReadFile: string;
      stepDetails: string;
      composerRunStatusSending: string;
      composerRunStatusDefault: string;
      composerRunningTool: string;
      composerStageThinking: string;
      composerStageSearching: string;
      composerStageReading: string;
      composerStageWriting: string;
      composerStageExecuting: string;
      composerStageAnalyzing: string;
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
      attachmentPreviewClose: string;
      attachmentPreviewDownload: string;
      attachmentPreviewRemove: string;
      attachmentPreviewLoading: string;
      attachmentPreviewText: string;
      attachmentPreviewPdf: string;
      attachmentPreviewDocument: string;
      attachmentPreviewPresentation: string;
      attachmentPreviewSpreadsheet: string;
      attachmentPreviewNoText: string;
      attachmentPreviewMissingData: string;
      attachmentPreviewLoadError: string;
      attachmentPreviewMissingAuth: string;
      attachmentPreviewFailedPdf: string;
      attachmentPreviewFailedDocx: string;
      attachmentPreviewFailedExcel: string;
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
      startNewChat: string;
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
      layoutToggleGroup: string;
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
    agentSettings: {
      subtitle: string;
      sectionDesc: string;
      needToken: string;
      loadError: string;
      save: string;
      saving: string;
      saved: string;
      saveError: string;
      cardModelsTitle: string;
      cardModelsSubtitle: string;
      cardWorkspaceTitle: string;
      cardWorkspaceSubtitle: string;
      cardGenerationTitle: string;
      cardGenerationSubtitle: string;
      cardBehaviorTitle: string;
      cardBehaviorSubtitle: string;
      label: {
        model: string;
        imageModel: string;
        imageGenerationModel: string;
        mediaMaxMb: string;
        workspace: string;
        maxTokens: string;
        temperature: string;
        maxToolIterations: string;
        thinkingDefault: string;
        reasoningDefault: string;
        verboseDefault: string;
      };
      desc: {
        model: string;
        imageModel: string;
        imageGenerationModel: string;
        mediaMaxMb: string;
        workspace: string;
        maxTokens: string;
        temperature: string;
        maxToolIterations: string;
        thinkingDefault: string;
        reasoningDefault: string;
        verboseDefault: string;
      };
      reasoning: { off: string; on: string; stream: string };
      verbose: { off: string; on: string; full: string };
    };
    providersSettings: {
      subtitle: string;
      intro: string;
      docsLink: string;
      needToken: string;
      loadError: string;
      save: string;
      saving: string;
      saved: string;
      saveError: string;
      empty: string;
      categories: {
        common: string;
        specialty: string;
        enterprise: string;
        oauth: string;
      };
      configuredCount: string;
      metaMasked: string;
      metaWillSave: string;
      metaNotConfigured: string;
      placeholderKey: string;
      placeholderKeep: string;
      placeholderOverride: string;
      show: string;
      hide: string;
      copy: string;
      copied: string;
      oauth: string;
      revoke: string;
      revokeConfirm: string;
      oauthStarting: string;
      oauthProcessingCode: string;
      openAuthPage: string;
      cancelOAuth: string;
      pasteRedirectUrl: string;
      submitCode: string;
      envHint: string;
      oauthHint: string;
    };
    modelsSettings: {
      needToken: string;
      subtitle: string;
      docsLink: string;
      loadError: string;
      loadFileWarning: string;
      filePath: string;
      addProvider: string;
      validate: string;
      validating: string;
      validateError: string;
      save: string;
      saving: string;
      saved: string;
      saveError: string;
      reload: string;
      reloading: string;
      reloadError: string;
      showJson: string;
      hideJson: string;
      statsProviders: string;
      statsModels: string;
      unsavedHint: string;
      loading: string;
      jsonParseError: string;
      jsonReset: string;
      jsonApply: string;
      emptyTitle: string;
      emptyDesc: string;
      emptyCta: string;
      presetOllama: string;
      presetLmStudio: string;
      presetOpenRouter: string;
      presetLabel: string;
      presetCustom: string;
      addProviderTitle: string;
      addProviderSubtitle: string;
      providerIdLabel: string;
      providerIdPlaceholder: string;
      providerIdRequired: string;
      addProviderConfirm: string;
      cancel: string;
      close: string;
      baseUrl: string;
      apiType: string;
      apiKey: string;
      apiKeyPlaceholder: string;
      apiKeyHint: string;
      authHeader: string;
      testKey: string;
      show: string;
      hide: string;
      badgeShell: string;
      badgeEnv: string;
      badgeLiteral: string;
      removeProvider: string;
      removeProviderConfirm: string;
      modelsSection: string;
      modelsEmpty: string;
      addModel: string;
      editModel: string;
      removeModel: string;
      removeModelConfirm: string;
      addModelTitle: string;
      editModelTitle: string;
      modelProviderLabel: string;
      modelId: string;
      displayName: string;
      inputTypes: string;
      inputTextOnly: string;
      inputTextVision: string;
      reasoning: string;
      contextWindow: string;
      maxOutputTokens: string;
      costSection: string;
      costInput: string;
      costOutput: string;
      modelIdRequired: string;
      mustBePositive: string;
      addModelConfirm: string;
      saveModelConfirm: string;
      validationErrors: string;
      validationWarnings: string;
      testError: string;
      testOk: string;
    };
    channelsSettings: {
      needToken: string;
      subtitle: string;
      docsLink: string;
      loadError: string;
      loading: string;
      save: string;
      saving: string;
      saved: string;
      saveError: string;
      retry: string;
      unsavedHint: string;
      telegramTitle: string;
      telegramSubtitle: string;
      weixinTitle: string;
      weixinSubtitle: string;
      enableTelegramAria: string;
      enableWeixinAria: string;
      telegramToken: string;
      telegramTokenDesc: string;
      allowFromDm: string;
      allowFromDmDesc: string;
      advancedShow: string;
      advancedHide: string;
      apiRoot: string;
      proxy: string;
      dmPolicy: string;
      groupPolicy: string;
      replyToMode: string;
      streamMode: string;
      allowFromGroups: string;
      historyLimit: string;
      textChunkLimit: string;
      telegramDebug: string;
      multiAccountJson: string;
      multiAccountJsonDesc: string;
      weixinLoginCallout: string;
      weixinAllowFrom: string;
      weixinAllowFromDesc: string;
      weixinRouteTag: string;
      weixinRouteTagDesc: string;
      routeTagPlaceholder: string;
      weixinDebug: string;
      weixinDebugDesc: string;
      weixinAccountsJson: string;
      weixinAccountsJsonDesc: string;
      jsonObjectAccounts: string;
      jsonInvalid: string;
      copy: string;
      copied: string;
      show: string;
      hide: string;
      policy: {
        dm: Record<'pairing' | 'allowlist' | 'open' | 'disabled', string>;
        group: Record<'open' | 'disabled' | 'allowlist', string>;
        reply: Record<'off' | 'first' | 'all', string>;
        stream: Record<'off' | 'partial' | 'block', string>;
      };
    };
    voiceSettings: {
      needToken: string;
      subtitle: string;
      docsLink: string;
      loadError: string;
      loading: string;
      save: string;
      saving: string;
      saved: string;
      saveError: string;
      retry: string;
      unsavedHint: string;
      stt: {
        title: string;
        description: string;
        enable: string;
        enableDesc: string;
        provider: string;
        alibaba: string;
        openai: string;
        apiKey: string;
        apiKeyDesc: string;
        model: string;
        fallback: string;
        fallbackDesc: string;
      };
      tts: {
        title: string;
        description: string;
        enable: string;
        enableDesc: string;
        trigger: string;
        triggerOff: string;
        triggerAlways: string;
        triggerInbound: string;
        triggerTagged: string;
        triggerDescOff: string;
        triggerDescAlways: string;
        triggerDescInbound: string;
        triggerDescTagged: string;
        provider: string;
        providerOpenai: string;
        providerEdge: string;
        voice: string;
        edgeHint: string;
      };
      notes: {
        title: string;
        duration: string;
        envVars: string;
      };
    };
    gatewaySettings: {
      needToken: string;
      subtitle: string;
      docsLink: string;
      loadError: string;
      loading: string;
      save: string;
      saving: string;
      saved: string;
      saveError: string;
      retry: string;
      unsavedHint: string;
      tokenExpired: string;
      updateToken: string;
      changeToken: string;
      accessToken: string;
      tokenPlaceholder: string;
      tokenHelp: string;
      copy: string;
      copied: string;
      show: string;
      hide: string;
      listenHost: string;
      listenPort: string;
      listenHint: string;
      enableHeartbeat: string;
      heartbeatInterval: string;
      heartbeatHint: string;
      authModeNone: string;
    };
  }
> = {
  en: {
    appBrand: 'XOPCBOT Gateway',
    appSubtitle: 'Console',
    sidebarCollapse: 'Collapse sidebar',
    sidebarExpand: 'Expand sidebar',
    closeMenu: 'Close menu',
    openMenu: 'Open menu',
    appBarPreferences: 'Language and theme',
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
    sidebar: {
      newTask: 'New task',
      tasksHeading: 'Tasks',
      viewAllSessions: 'All sessions',
      taskListEmpty: 'No chats yet',
      taskListNeedToken: 'Save a gateway token to load your chats.',
      taskListAddToken: 'Add token',
      taskListStartChat: 'Start a chat',
      appMenuAria: 'App menu and settings',
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
      viewSteps_one: 'View {{count}} step',
      viewSteps_other: 'View {{count}} steps',
      stepSearchedWeb: 'Searched web',
      stepReadFile: 'Read file',
      stepDetails: 'Details',
      composerRunStatusSending: 'Sending…',
      composerRunStatusDefault: 'Working…',
      composerRunningTool: 'Running {{name}}',
      composerStageThinking: 'Thinking…',
      composerStageSearching: 'Searching…',
      composerStageReading: 'Reading…',
      composerStageWriting: 'Writing…',
      composerStageExecuting: 'Executing…',
      composerStageAnalyzing: 'Analyzing…',
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
      attachmentPreviewClose: 'Close',
      attachmentPreviewDownload: 'Download',
      attachmentPreviewRemove: 'Remove',
      attachmentPreviewLoading: 'Loading file…',
      attachmentPreviewText: 'Text',
      attachmentPreviewPdf: 'PDF',
      attachmentPreviewDocument: 'Document',
      attachmentPreviewPresentation: 'Presentation',
      attachmentPreviewSpreadsheet: 'Spreadsheet',
      attachmentPreviewNoText: 'No text content available',
      attachmentPreviewMissingData: 'Missing file data',
      attachmentPreviewLoadError: 'Error loading file',
      attachmentPreviewMissingAuth: 'Missing authentication',
      attachmentPreviewFailedPdf: 'Failed to load PDF',
      attachmentPreviewFailedDocx: 'Failed to load document',
      attachmentPreviewFailedExcel: 'Failed to load spreadsheet',
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
      startNewChat: 'Start New Chat',
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
      layoutToggleGroup: 'Session layout',
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
    agentSettings: {
      subtitle: 'Defaults for models, workspace, sampling, and how responses are shown.',
      sectionDesc:
        'Changes are written to your gateway config file. Some values apply on the next agent turn or session.',
      needToken: 'Save a gateway token to load and change agent defaults.',
      loadError: 'Failed to load settings',
      save: 'Save changes',
      saving: 'Saving…',
      saved: 'Saved',
      saveError: 'Failed to save',
      cardModelsTitle: 'Models',
      cardModelsSubtitle: 'Chat, vision, and image generation defaults',
      cardWorkspaceTitle: 'Workspace & attachments',
      cardWorkspaceSubtitle: 'Working directory and inbound media limits',
      cardGenerationTitle: 'Sampling & tools',
      cardGenerationSubtitle: 'Token budget, randomness, and tool loop depth',
      cardBehaviorTitle: 'Reasoning & output',
      cardBehaviorSubtitle: 'Thinking depth, traces, and verbosity',
      label: {
        model: 'Model',
        imageModel: 'Image model',
        imageGenerationModel: 'Image generation model',
        mediaMaxMb: 'Image load limit (MB)',
        workspace: 'Workspace',
        maxTokens: 'Max tokens',
        temperature: 'Temperature',
        maxToolIterations: 'Max tool iterations',
        thinkingDefault: 'Thinking level',
        reasoningDefault: 'Reasoning visibility',
        verboseDefault: 'Verbose mode',
      },
      desc: {
        model: 'Default model for new sessions.',
        imageModel: 'Optional. Used for image understanding / vision.',
        imageGenerationModel: 'Optional. For image_generate (e.g. openai/gpt-image-1).',
        mediaMaxMb: 'Max size when loading images in the image tool.',
        workspace: 'Working directory for agent files.',
        maxTokens: 'Maximum tokens in the model response.',
        temperature: 'Randomness (0–2).',
        maxToolIterations: 'Maximum tool calls per user message.',
        thinkingDefault: 'Default thinking level for new sessions.',
        reasoningDefault: 'Whether to surface model reasoning to users.',
        verboseDefault: 'How much detail the agent prints by default.',
      },
      reasoning: { off: 'Off', on: 'On', stream: 'Stream' },
      verbose: { off: 'Off', on: 'On', full: 'Full' },
    },
    providersSettings: {
      subtitle: 'Provider API keys and OAuth. Keys are stored via the gateway credential store.',
      intro: 'Expand a group, then a provider to set an API key or use OAuth where available.',
      docsLink: 'Model & provider docs',
      needToken: 'Save a gateway token to manage provider credentials.',
      loadError: 'Failed to load providers',
      save: 'Save changes',
      saving: 'Saving…',
      saved: 'Saved',
      saveError: 'Failed to save',
      empty: 'No providers available.',
      categories: {
        common: 'Common providers',
        specialty: 'Specialty providers',
        enterprise: 'Enterprise / cloud',
        oauth: 'OAuth only',
      },
      configuredCount: '{{count}} configured',
      metaMasked: 'Credential on file — enter a new key to replace.',
      metaWillSave: 'API key will be saved when you click Save changes.',
      metaNotConfigured: 'Not configured.',
      placeholderKey: 'API key',
      placeholderKeep: 'Leave empty to keep current',
      placeholderOverride: 'Enter new key to override',
      show: 'Show',
      hide: 'Hide',
      copy: 'Copy',
      copied: 'Copied',
      oauth: 'OAuth',
      revoke: 'Revoke',
      revokeConfirm: 'Revoke OAuth credentials for "{{name}}"?',
      oauthStarting: 'Starting OAuth…',
      oauthProcessingCode: 'Processing authorization…',
      openAuthPage: 'Open auth page',
      cancelOAuth: 'Cancel',
      pasteRedirectUrl:
        'Paste full redirect URL (e.g. http://127.0.0.1:…/oauth-callback?code=…&state=…)',
      submitCode: 'Submit',
      envHint: 'API key is set via environment variable. Enter a new key above to override.',
      oauthHint: 'Use OAuth for secure authentication, or enter an API key manually.',
    },
    modelsSettings: {
      needToken: 'Save a gateway token to edit models.json.',
      subtitle: 'Custom providers and models (models.json). Changes apply after save; reload picks up disk edits.',
      docsLink: 'Model & provider docs',
      loadError: 'Failed to load models.json',
      loadFileWarning: 'File warning',
      filePath: 'Path',
      addProvider: 'Add provider',
      validate: 'Validate',
      validating: 'Validating…',
      validateError: 'Validation request failed',
      save: 'Save',
      saving: 'Saving…',
      saved: 'Saved',
      saveError: 'Failed to save',
      reload: 'Reload',
      reloading: 'Reloading…',
      reloadError: 'Reload failed',
      showJson: 'Show JSON',
      hideJson: 'Hide JSON',
      statsProviders: '{{count}} providers',
      statsModels: '{{count}} models',
      unsavedHint: 'You have unsaved changes.',
      loading: 'Loading…',
      jsonParseError: 'Invalid JSON',
      jsonReset: 'Reset from editor',
      jsonApply: 'Apply JSON',
      emptyTitle: 'No custom providers',
      emptyDesc:
        'Add OpenAI-compatible endpoints (Ollama, LM Studio, OpenRouter, vLLM, etc.) and optional per-model overrides.',
      emptyCta: 'Add your first provider',
      presetOllama: 'Ollama',
      presetLmStudio: 'LM Studio',
      presetOpenRouter: 'OpenRouter',
      presetLabel: 'Preset',
      presetCustom: 'Custom',
      addProviderTitle: 'Add provider',
      addProviderSubtitle: 'Provider id must be unique (e.g. ollama, my-openai).',
      providerIdLabel: 'Provider ID',
      providerIdPlaceholder: 'e.g. ollama',
      providerIdRequired: 'Provider ID is required',
      addProviderConfirm: 'Add provider',
      cancel: 'Cancel',
      close: 'Close',
      baseUrl: 'Base URL',
      apiType: 'API type',
      apiKey: 'API key',
      apiKeyPlaceholder: 'sk-…, ENV_VAR, or !command',
      apiKeyHint: 'Literal key, ENV name (uppercase), or shell command prefixed with !',
      authHeader: 'Send Authorization header automatically',
      testKey: 'Test',
      show: 'Show',
      hide: 'Hide',
      badgeShell: 'shell',
      badgeEnv: 'env',
      badgeLiteral: 'literal',
      removeProvider: 'Remove provider',
      removeProviderConfirm: 'Remove provider "{{id}}" and its models?',
      modelsSection: 'Models',
      modelsEmpty: 'No custom models; built-in defaults apply where available.',
      addModel: 'Add model',
      editModel: 'Edit model',
      removeModel: 'Remove model',
      removeModelConfirm: 'Remove model "{{id}}"?',
      addModelTitle: 'Add model',
      editModelTitle: 'Edit model',
      modelProviderLabel: 'Provider',
      modelId: 'Model ID',
      displayName: 'Display name',
      inputTypes: 'Input types',
      inputTextOnly: 'Text only',
      inputTextVision: 'Text + vision',
      reasoning: 'Supports reasoning',
      contextWindow: 'Context window',
      maxOutputTokens: 'Max output tokens',
      costSection: 'Cost (per 1M tokens)',
      costInput: 'Input',
      costOutput: 'Output',
      modelIdRequired: 'Model ID is required',
      mustBePositive: 'Must be greater than 0',
      addModelConfirm: 'Add model',
      saveModelConfirm: 'Save changes',
      validationErrors: 'Validation issues',
      validationWarnings: 'Warnings',
      testError: 'Error',
      testOk: 'Resolved',
    },
    channelsSettings: {
      needToken: 'Save a gateway token to edit channel settings.',
      subtitle: 'Telegram and Weixin inbound channels. Changes are written to the gateway config file.',
      docsLink: 'Channel documentation',
      loadError: 'Failed to load channel settings',
      loading: 'Loading…',
      save: 'Save changes',
      saving: 'Saving…',
      saved: 'Saved',
      saveError: 'Failed to save',
      retry: 'Retry',
      unsavedHint: 'You have unsaved changes.',
      telegramTitle: 'Telegram',
      telegramSubtitle: 'Bot token, allowlists, and optional multi-account JSON.',
      weixinTitle: 'Weixin',
      weixinSubtitle: 'Inbound Weixin bridge; advanced routing and per-account JSON.',
      enableTelegramAria: 'Enable Telegram channel',
      enableWeixinAria: 'Enable Weixin channel',
      telegramToken: 'Bot token',
      telegramTokenDesc: 'From BotFather. Stored in the gateway config.',
      allowFromDm: 'Allow from (DM)',
      allowFromDmDesc: 'Comma-separated user IDs allowed to DM the bot (when policy uses allowlist).',
      advancedShow: 'Advanced options',
      advancedHide: 'Hide advanced options',
      apiRoot: 'API root',
      proxy: 'Proxy',
      dmPolicy: 'DM policy',
      groupPolicy: 'Group policy',
      replyToMode: 'Reply-to mode',
      streamMode: 'Stream mode',
      allowFromGroups: 'Allow from (groups)',
      historyLimit: 'History limit',
      textChunkLimit: 'Text chunk limit',
      telegramDebug: 'Debug mode',
      multiAccountJson: 'Multi-account (JSON)',
      multiAccountJsonDesc:
        'Optional. Per-account botToken or tokenFile, policies, and groups. Empty {} uses the single token above only.',
      weixinLoginCallout: 'Weixin login and bridge setup are configured outside this form (see documentation).',
      weixinAllowFrom: 'Allow from',
      weixinAllowFromDesc: 'Comma-separated wxid / openid allowlist when applicable.',
      weixinRouteTag: 'Route tag',
      weixinRouteTagDesc: 'Optional tag for routing; numeric or string.',
      routeTagPlaceholder: 'e.g. tag name or number',
      weixinDebug: 'Debug mode',
      weixinDebugDesc: 'Extra logging for the Weixin channel.',
      weixinAccountsJson: 'Accounts (JSON)',
      weixinAccountsJsonDesc: 'Per-account name, CDN base URL, route tag, and policies.',
      jsonObjectAccounts: 'Accounts must be a JSON object',
      jsonInvalid: 'Invalid JSON',
      copy: 'Copy',
      copied: 'Copied',
      show: 'Show',
      hide: 'Hide',
      policy: {
        dm: {
          pairing: 'Pairing',
          allowlist: 'Allowlist',
          open: 'Open',
          disabled: 'Disabled',
        },
        group: {
          open: 'Open',
          disabled: 'Disabled',
          allowlist: 'Allowlist',
        },
        reply: {
          off: 'Off',
          first: 'First',
          all: 'All',
        },
        stream: {
          off: 'Off',
          partial: 'Partial',
          block: 'Block',
        },
      },
    },
    voiceSettings: {
      needToken: 'Save a gateway token to edit voice settings.',
      subtitle: 'Speech-to-text and text-to-speech for channels. Keys can also be set via environment variables.',
      docsLink: 'Voice documentation',
      loadError: 'Failed to load voice settings',
      loading: 'Loading…',
      save: 'Save changes',
      saving: 'Saving…',
      saved: 'Saved',
      saveError: 'Failed to save',
      retry: 'Retry',
      unsavedHint: 'You have unsaved changes.',
      stt: {
        title: 'Speech-to-text (STT)',
        description: 'Transcribe inbound voice using Alibaba DashScope or OpenAI Whisper.',
        enable: 'Enable STT',
        enableDesc: 'When on, voice messages can be transcribed for the agent.',
        provider: 'STT provider',
        alibaba: 'Alibaba DashScope',
        openai: 'OpenAI',
        apiKey: 'API key',
        apiKeyDesc: 'Optional if the key is already in the environment.',
        model: 'Model',
        fallback: 'Fallback between providers',
        fallbackDesc: 'Try the other provider if the primary request fails.',
      },
      tts: {
        title: 'Text-to-speech (TTS)',
        description: 'Synthesize assistant replies as audio when enabled.',
        enable: 'Enable TTS',
        enableDesc: 'When on, TTS runs according to the trigger mode below.',
        trigger: 'Trigger',
        triggerOff: 'Off',
        triggerAlways: 'Always',
        triggerInbound: 'Inbound voice only',
        triggerTagged: 'Tagged ([[tts]])',
        triggerDescOff: 'TTS is completely disabled.',
        triggerDescAlways: 'Apply TTS to all assistant messages.',
        triggerDescInbound: 'Only reply with voice when the user sends voice.',
        triggerDescTagged: 'Only when the [[tts]] directive is used.',
        provider: 'TTS provider',
        providerOpenai: 'OpenAI TTS',
        providerEdge: 'Microsoft Edge (free)',
        voice: 'Voice',
        edgeHint: 'Microsoft Edge TTS — no API key required.',
      },
      notes: {
        title: 'Note',
        duration: 'Long audio is split automatically; quality depends on provider and model.',
        envVars: 'Environment variables: DASHSCOPE_API_KEY, OPENAI_API_KEY (when not set in this form).',
      },
    },
    gatewaySettings: {
      needToken: 'Save a gateway token to load and edit gateway options.',
      subtitle: 'HTTP API access token and heartbeat. Values are stored in the gateway config file.',
      docsLink: 'Gateway documentation',
      loadError: 'Failed to load gateway settings',
      loading: 'Loading…',
      save: 'Save changes',
      saving: 'Saving…',
      saved: 'Saved',
      saveError: 'Failed to save',
      retry: 'Retry',
      unsavedHint: 'You have unsaved changes.',
      tokenExpired: 'Your session token was rejected. Update the client token or fix the access token in config.',
      updateToken: 'Update client token',
      changeToken: 'Open token dialog',
      accessToken: 'Gateway access token',
      tokenPlaceholder: 'Token stored in config (optional if using env)',
      tokenHelp: 'Used to authenticate HTTP/WebSocket API requests. You can also set XOPCBOT_GATEWAY_TOKEN.',
      copy: 'Copy',
      copied: 'Copied',
      show: 'Show',
      hide: 'Hide',
      listenHost: 'Listen address',
      listenPort: 'Port',
      listenHint: 'Effective after gateway restart if changed outside this UI.',
      enableHeartbeat: 'Enable heartbeat',
      heartbeatInterval: 'Heartbeat interval (ms)',
      heartbeatHint: 'Interval for gateway heartbeat events (SSE / UI).',
      authModeNone: 'Auth mode is set to none — token in config may be ignored.',
    },
  },
  zh: {
    appBrand: 'XOPCBOT Gateway',
    appSubtitle: '控制台',
    sidebarCollapse: '收起侧边栏',
    sidebarExpand: '展开侧边栏',
    closeMenu: '关闭菜单',
    openMenu: '打开菜单',
    appBarPreferences: '语言与主题',
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
    sidebar: {
      newTask: '新任务',
      tasksHeading: '任务',
      viewAllSessions: '全部会话',
      taskListEmpty: '暂无会话',
      taskListNeedToken: '保存网关 Token 后即可在此查看最近会话。',
      taskListAddToken: '添加 Token',
      taskListStartChat: '开始对话',
      appMenuAria: '应用菜单与设置',
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
      viewSteps_one: '查看 {{count}} 步',
      viewSteps_other: '查看 {{count}} 步',
      stepSearchedWeb: '搜索网页',
      stepReadFile: '读取文件',
      stepDetails: '详情',
      composerRunStatusSending: '发送中…',
      composerRunStatusDefault: '处理中…',
      composerRunningTool: '执行：{{name}}',
      composerStageThinking: '思考中…',
      composerStageSearching: '搜索中…',
      composerStageReading: '阅读中…',
      composerStageWriting: '写作中…',
      composerStageExecuting: '执行中…',
      composerStageAnalyzing: '分析中…',
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
      attachmentPreviewClose: '关闭',
      attachmentPreviewDownload: '下载',
      attachmentPreviewRemove: '移除',
      attachmentPreviewLoading: '正在加载文件…',
      attachmentPreviewText: '文本',
      attachmentPreviewPdf: 'PDF',
      attachmentPreviewDocument: '文档',
      attachmentPreviewPresentation: '演示文稿',
      attachmentPreviewSpreadsheet: '表格',
      attachmentPreviewNoText: '无可用文本',
      attachmentPreviewMissingData: '缺少文件数据',
      attachmentPreviewLoadError: '加载文件失败',
      attachmentPreviewMissingAuth: '缺少身份验证',
      attachmentPreviewFailedPdf: '无法加载 PDF',
      attachmentPreviewFailedDocx: '无法加载文档',
      attachmentPreviewFailedExcel: '无法加载表格',
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
      startNewChat: '开始新对话',
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
      layoutToggleGroup: '会话布局',
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
    agentSettings: {
      subtitle: '模型、工作区、采样与输出方式的默认配置。',
      sectionDesc: '修改将写入网关配置文件；部分项在下一轮对话或新会话中生效。',
      needToken: '请先保存网关 Token 后再加载或修改代理默认项。',
      loadError: '加载设置失败',
      save: '保存更改',
      saving: '保存中…',
      saved: '已保存',
      saveError: '保存失败',
      cardModelsTitle: '模型',
      cardModelsSubtitle: '对话、视觉与图像生成默认模型',
      cardWorkspaceTitle: '工作区与附件',
      cardWorkspaceSubtitle: '工作目录与入站媒体大小限制',
      cardGenerationTitle: '采样与工具',
      cardGenerationSubtitle: 'Token 上限、随机性与工具循环深度',
      cardBehaviorTitle: '推理与输出',
      cardBehaviorSubtitle: '思考深度、推理可见性与详细程度',
      label: {
        model: '模型',
        imageModel: '图像理解模型',
        imageGenerationModel: '图像生成模型',
        mediaMaxMb: '图像加载上限 (MB)',
        workspace: '工作区',
        maxTokens: '最大 token',
        temperature: '温度',
        maxToolIterations: '最大工具迭代',
        thinkingDefault: '思考级别',
        reasoningDefault: '推理可见性',
        verboseDefault: '详细程度',
      },
      desc: {
        model: '新会话的默认模型。',
        imageModel: '可选，用于图像理解 / 视觉。',
        imageGenerationModel: '可选，用于 image_generate（如 openai/gpt-image-1）。',
        mediaMaxMb: '图像工具加载单张图片时的最大体积。',
        workspace: '代理读写文件的工作目录。',
        maxTokens: '模型回复的最大 token 数。',
        temperature: '随机性（0–2）。',
        maxToolIterations: '单条用户消息内最多工具调用轮数。',
        thinkingDefault: '新会话的默认思考级别。',
        reasoningDefault: '是否向用户展示模型推理过程。',
        verboseDefault: '代理默认输出的详细程度。',
      },
      reasoning: { off: '关闭', on: '开启', stream: '流式' },
      verbose: { off: '关闭', on: '开启', full: '完整' },
    },
    providersSettings: {
      subtitle: '提供商 API Key 与 OAuth。凭据由网关凭据存储保存。',
      intro: '展开分组与提供商，填写 API Key 或在支持时使用 OAuth。',
      docsLink: '模型与提供商文档',
      needToken: '请先保存网关 Token 后再管理提供商凭据。',
      loadError: '加载提供商失败',
      save: '保存更改',
      saving: '保存中…',
      saved: '已保存',
      saveError: '保存失败',
      empty: '暂无可用提供商。',
      categories: {
        common: '常用提供商',
        specialty: '专业 / 特色',
        enterprise: '企业 / 云端',
        oauth: '仅 OAuth',
      },
      configuredCount: '已配置 {{count}} 个',
      metaMasked: '已有凭据 — 输入新 Key 可覆盖。',
      metaWillSave: '点击「保存更改」后写入 API Key。',
      metaNotConfigured: '未配置。',
      placeholderKey: 'API Key',
      placeholderKeep: '留空则保留当前',
      placeholderOverride: '输入新 Key 覆盖',
      show: '显示',
      hide: '隐藏',
      copy: '复制',
      copied: '已复制',
      oauth: 'OAuth 登录',
      revoke: '撤销',
      revokeConfirm: '撤销「{{name}}」的 OAuth 凭据？',
      oauthStarting: '正在启动 OAuth…',
      oauthProcessingCode: '正在处理授权…',
      openAuthPage: '打开授权页',
      cancelOAuth: '取消',
      pasteRedirectUrl: '粘贴完整重定向 URL（含 code= 与 state=）',
      submitCode: '提交',
      envHint: 'API Key 来自环境变量。在上方输入新 Key 可覆盖。',
      oauthHint: '可使用 OAuth 安全登录，或手动填写 API Key。',
    },
    modelsSettings: {
      needToken: '请先保存网关 Token 后再编辑 models.json。',
      subtitle: '自定义提供商与模型（models.json）。保存后生效；重新加载可读取磁盘上的修改。',
      docsLink: '模型与提供商文档',
      loadError: '加载 models.json 失败',
      loadFileWarning: '文件提示',
      filePath: '路径',
      addProvider: '添加提供商',
      validate: '校验',
      validating: '校验中…',
      validateError: '校验请求失败',
      save: '保存',
      saving: '保存中…',
      saved: '已保存',
      saveError: '保存失败',
      reload: '重新加载',
      reloading: '加载中…',
      reloadError: '重新加载失败',
      showJson: '显示 JSON',
      hideJson: '隐藏 JSON',
      statsProviders: '{{count}} 个提供商',
      statsModels: '{{count}} 个模型',
      unsavedHint: '有未保存的更改。',
      loading: '加载中…',
      jsonParseError: 'JSON 无效',
      jsonReset: '从编辑器还原',
      jsonApply: '应用 JSON',
      emptyTitle: '暂无自定义提供商',
      emptyDesc: '可添加 OpenAI 兼容端点（Ollama、LM Studio、OpenRouter、vLLM 等）及可选的逐模型覆盖。',
      emptyCta: '添加第一个提供商',
      presetOllama: 'Ollama',
      presetLmStudio: 'LM Studio',
      presetOpenRouter: 'OpenRouter',
      presetLabel: '预设',
      presetCustom: '自定义',
      addProviderTitle: '添加提供商',
      addProviderSubtitle: '提供商 ID 须唯一（如 ollama、my-openai）。',
      providerIdLabel: '提供商 ID',
      providerIdPlaceholder: '例如 ollama',
      providerIdRequired: '请填写提供商 ID',
      addProviderConfirm: '添加',
      cancel: '取消',
      close: '关闭',
      baseUrl: 'Base URL',
      apiType: 'API 类型',
      apiKey: 'API Key',
      apiKeyPlaceholder: 'sk-…、环境变量名 或 !命令',
      apiKeyHint: '直接填写密钥、大写环境变量名，或以 ! 开头的 shell 命令',
      authHeader: '自动发送 Authorization 头',
      testKey: '测试',
      show: '显示',
      hide: '隐藏',
      badgeShell: 'shell',
      badgeEnv: 'env',
      badgeLiteral: '字面量',
      removeProvider: '删除提供商',
      removeProviderConfirm: '删除提供商「{{id}}」及其模型？',
      modelsSection: '模型',
      modelsEmpty: '无自定义模型；在可用处将使用内置默认。',
      addModel: '添加模型',
      editModel: '编辑模型',
      removeModel: '删除模型',
      removeModelConfirm: '删除模型「{{id}}」？',
      addModelTitle: '添加模型',
      editModelTitle: '编辑模型',
      modelProviderLabel: '提供商',
      modelId: '模型 ID',
      displayName: '显示名称',
      inputTypes: '输入类型',
      inputTextOnly: '仅文本',
      inputTextVision: '文本 + 视觉',
      reasoning: '支持推理',
      contextWindow: '上下文窗口',
      maxOutputTokens: '最大输出 token',
      costSection: '费用（每百万 token）',
      costInput: '输入',
      costOutput: '输出',
      modelIdRequired: '请填写模型 ID',
      mustBePositive: '必须大于 0',
      addModelConfirm: '添加模型',
      saveModelConfirm: '保存更改',
      validationErrors: '校验问题',
      validationWarnings: '警告',
      testError: '错误',
      testOk: '解析结果',
    },
    channelsSettings: {
      needToken: '请先保存网关 Token 后再编辑渠道设置。',
      subtitle: 'Telegram 与微信入站渠道。更改将写入网关配置文件。',
      docsLink: '渠道文档',
      loadError: '加载渠道设置失败',
      loading: '加载中…',
      save: '保存更改',
      saving: '保存中…',
      saved: '已保存',
      saveError: '保存失败',
      retry: '重试',
      unsavedHint: '有未保存的更改。',
      telegramTitle: 'Telegram',
      telegramSubtitle: 'Bot Token、白名单及可选的多账号 JSON。',
      weixinTitle: '微信',
      weixinSubtitle: '微信桥接入站；高级路由与分账号 JSON。',
      enableTelegramAria: '启用 Telegram 渠道',
      enableWeixinAria: '启用微信渠道',
      telegramToken: 'Bot Token',
      telegramTokenDesc: '来自 BotFather，保存在网关配置中。',
      allowFromDm: '允许私聊（用户 ID）',
      allowFromDmDesc: '逗号分隔的用户 ID（策略为白名单时生效）。',
      advancedShow: '高级选项',
      advancedHide: '收起高级选项',
      apiRoot: 'API 根地址',
      proxy: '代理',
      dmPolicy: '私聊策略',
      groupPolicy: '群组策略',
      replyToMode: '回复引用模式',
      streamMode: '流式模式',
      allowFromGroups: '允许群组（ID）',
      historyLimit: '历史条数上限',
      textChunkLimit: '文本分块上限',
      telegramDebug: '调试模式',
      multiAccountJson: '多账号（JSON）',
      multiAccountJsonDesc:
        '可选。每账号可配置 botToken 或 tokenFile、策略与群组。留空 {} 则仅使用上方单一 Token。',
      weixinLoginCallout: '微信登录与桥接需在表单外按文档配置。',
      weixinAllowFrom: '允许来源',
      weixinAllowFromDesc: '逗号分隔的 wxid / openid 白名单（如适用）。',
      weixinRouteTag: '路由标签',
      weixinRouteTagDesc: '可选路由标签，可为数字或字符串。',
      routeTagPlaceholder: '例如标签名或数字',
      weixinDebug: '调试模式',
      weixinDebugDesc: '为微信渠道输出更详细的日志。',
      weixinAccountsJson: '账号（JSON）',
      weixinAccountsJsonDesc: '分账号名称、CDN 地址、路由标签与策略。',
      jsonObjectAccounts: '账号必须为 JSON 对象',
      jsonInvalid: 'JSON 无效',
      copy: '复制',
      copied: '已复制',
      show: '显示',
      hide: '隐藏',
      policy: {
        dm: {
          pairing: '配对',
          allowlist: '白名单',
          open: '开放',
          disabled: '关闭',
        },
        group: {
          open: '开放',
          disabled: '关闭',
          allowlist: '白名单',
        },
        reply: {
          off: '关闭',
          first: '首条',
          all: '全部',
        },
        stream: {
          off: '关闭',
          partial: '部分',
          block: '阻塞',
        },
      },
    },
    voiceSettings: {
      needToken: '请先保存网关 Token 后再编辑语音设置。',
      subtitle: '渠道的语音转文字与文字转语音。API Key 也可通过环境变量配置。',
      docsLink: '语音文档',
      loadError: '加载语音设置失败',
      loading: '加载中…',
      save: '保存更改',
      saving: '保存中…',
      saved: '已保存',
      saveError: '保存失败',
      retry: '重试',
      unsavedHint: '有未保存的更改。',
      stt: {
        title: '语音转文字（STT）',
        description: '使用阿里云 DashScope 或 OpenAI Whisper 将入站语音转为文本。',
        enable: '启用 STT',
        enableDesc: '开启后，可将语音消息转写给代理使用。',
        provider: 'STT 提供商',
        alibaba: '阿里云 DashScope',
        openai: 'OpenAI',
        apiKey: 'API Key',
        apiKeyDesc: '若环境变量已配置密钥，此处可留空。',
        model: '模型',
        fallback: '提供商回退',
        fallbackDesc: '主提供商失败时尝试另一提供商。',
      },
      tts: {
        title: '文字转语音（TTS）',
        description: '在启用时把助手回复合成为语音。',
        enable: '启用 TTS',
        enableDesc: '开启后，按下方触发模式执行 TTS。',
        trigger: '触发',
        triggerOff: '关闭',
        triggerAlways: '始终',
        triggerInbound: '仅入站语音',
        triggerTagged: '标签（[[tts]]）',
        triggerDescOff: '完全关闭 TTS。',
        triggerDescAlways: '对助手消息尝试使用 TTS。',
        triggerDescInbound: '仅当用户发送语音时以语音回复。',
        triggerDescTagged: '仅在使用 [[tts]] 指令时。',
        provider: 'TTS 提供商',
        providerOpenai: 'OpenAI TTS',
        providerEdge: 'Microsoft Edge（免费）',
        voice: '音色',
        edgeHint: 'Microsoft Edge TTS — 无需 API Key。',
      },
      notes: {
        title: '说明',
        duration: '长音频会自动分段；效果取决于提供商与模型。',
        envVars: '环境变量：DASHSCOPE_API_KEY、OPENAI_API_KEY（未在表单填写时）。',
      },
    },
    gatewaySettings: {
      needToken: '请先保存网关 Token 后再加载或修改网关选项。',
      subtitle: 'HTTP API 访问令牌与心跳。配置写入网关配置文件。',
      docsLink: '网关文档',
      loadError: '加载网关设置失败',
      loading: '加载中…',
      save: '保存更改',
      saving: '保存中…',
      saved: '已保存',
      saveError: '保存失败',
      retry: '重试',
      unsavedHint: '有未保存的更改。',
      tokenExpired: '会话 Token 无效。请在客户端更新 Token，或修正配置文件中的访问令牌。',
      updateToken: '更新客户端 Token',
      changeToken: '打开 Token 对话框',
      accessToken: '网关访问令牌',
      tokenPlaceholder: '保存在配置中的令牌（若使用环境变量可留空）',
      tokenHelp: '用于 HTTP/WebSocket API 鉴权。也可通过环境变量 XOPCBOT_GATEWAY_TOKEN 提供。',
      copy: '复制',
      copied: '已复制',
      show: '显示',
      hide: '隐藏',
      listenHost: '监听地址',
      listenPort: '端口',
      listenHint: '若在 UI 外修改监听地址，需重启网关后生效。',
      enableHeartbeat: '启用心跳',
      heartbeatInterval: '心跳间隔（毫秒）',
      heartbeatHint: '网关心跳事件（SSE / UI）的间隔。',
      authModeNone: '当前认证模式为 none，配置文件中的令牌可能被忽略。',
    },
  },
};

export type ProvidersSettingsMessages = (typeof bundles)['en']['providersSettings'];
export type ModelsSettingsMessages = (typeof bundles)['en']['modelsSettings'];
export type ChannelsSettingsMessages = (typeof bundles)['en']['channelsSettings'];
export type VoiceSettingsMessages = (typeof bundles)['en']['voiceSettings'];
export type GatewaySettingsMessages = (typeof bundles)['en']['gatewaySettings'];

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
