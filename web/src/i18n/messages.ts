import type { StoredLanguage } from '@/lib/storage';

export type Tab =
  | 'chat'
  | 'sessions'
  | 'cron'
  | 'skills'
  | 'channels'
  | 'logs'
  | 'settingsAppearance'
  | 'settingsProviders'
  | 'settingsModels'
  | 'settingsChannels'
  | 'settingsVoice'
  | 'settingsGateway'
  | 'settingsHeartbeat'
  | 'settingsSearch'
  | 'settingsAgents';

export type SettingsSectionId =
  | 'appearance'
  | 'agent'
  | 'providers'
  | 'models'
  | 'channels'
  | 'voice'
  | 'gateway'
  | 'heartbeat'
  | 'search'
  | 'agents';

const bundles: Record<
  StoredLanguage,
  {
    appBrand: string;
    sidebarCollapse: string;
    sidebarExpand: string;
    closeMenu: string;
    openMenu: string;
    /** App header: language & theme in overflow popover (small screens). */
    appBarPreferences: string;
    nav: Record<Tab | 'management' | 'settings', string>;
    settingsSections: Record<SettingsSectionId, string>;
    /** Full-screen settings left rail — group headings above each block of links. */
    settingsNavGroups: Record<
      'interface' | 'agentAndModels' | 'voice' | 'gateway' | 'data',
      string
    >;
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
    /** Full-page connect prompt when no gateway token is stored (replaces modal on first visit). */
    gatewayLanding: {
      headline: string;
      subline: string;
      sessionExpired: string;
      stepOnboard: string;
      stepPaste: string;
      stepUrlHint: string;
      docsGatewayLink: string;
    };
    /** Desktop shell (Electron): first-run hints and gateway process messages. */
    electron: {
      setupBannerTitle: string;
      setupBannerBody: string;
      setupBannerLinkProviders: string;
      setupBannerLinkModels: string;
      setupBannerDismiss: string;
      gatewayExitTitle: string;
      gatewayExitBody: string;
    };
    connection: {
      connecting: string;
      online: string;
      reconnecting: string;
      offline: string;
      error: string;
      reconnect: string;
    };
    /** HTTP/API error fallbacks when the server returns a generic message. */
    api: {
      errorBadGateway: string;
      errorServiceUnavailable: string;
      errorGatewayTimeout: string;
      errorInternal: string;
      errorServer: string;
      errorNotFound: string;
      errorForbidden: string;
      errorRequest: string;
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
      taskSessionMenuAria: string;
      taskRename: string;
      taskCopyChatId: string;
      taskDeleteTask: string;
      taskRenameTitle: string;
      taskRenamePlaceholder: string;
      taskRenameSave: string;
      taskRenameCancel: string;
      /** Settings full-screen: return to main app (chat). */
      backToApp: string;
      /** Link to public documentation (opens in new tab). */
      helpDocs: string;
      /** Segmented filter above task list: Tasks (web) vs IM channels. */
      sessionChannelFilterAria: string;
      sessionTasksTab: string;
      sessionChannelsTab: string;
    };
    chat: {
      typeMessage: string;
      sendMessage: string;
      abort: string;
      needToken: string;
      loading: string;
      model: string;
      modelPlaceholder: string;
      /** Web chat: multi-agent picker (session `agentId`). */
      agent: string;
      agentPlaceholder: string;
      agentSearchPlaceholder: string;
      agentNoMatches: string;
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
      attachmentFileTooLarge: string;
      inputPlaceholder: string;
      currentModel: string;
      modelSearchPlaceholder: string;
      modelNoMatches: string;
      dropFiles: string;
      voiceRecording: string;
      voiceRecordingStop: string;
      voiceMicDenied: string;
      /** Composer hint while assistant is streaming (steering). */
      inputPlaceholderSteering: string;
      /** Stop current run and send the draft immediately (⌘/Ctrl+Enter). */
      steeringInterruptSend: string;
      /** aria-label for follow-up suggestion chip group. */
      followUpSuggestionsAria: string;
      followUpChipErrorHandling: string;
      followUpChipRefactorReadability: string;
      followUpChipShorterSummary: string;
      followUpChipMainRisks: string;
      followUpChipSimplerTerms: string;
      followUpChipConcreteExample: string;
      followUpChipWhatNext: string;
      /** Cursor-style queue above the composer while a run is active. */
      followUpQueueAria: string;
      followUpQueueHeading: string;
      followUpQueueClickToEdit: string;
      followUpQueueAttachmentOnly: string;
      followUpQueueEmptyPreview: string;
      followUpQueueDrag: string;
      followUpQueueMoveUp: string;
      followUpQueueMoveDown: string;
      followUpQueueSteerNow: string;
      followUpQueueRemove: string;
      followUpQueueAttachmentsNote: string;
      followUpQueueMaxReached: string;
      voicePlay: string;
      voicePause: string;
      voiceLoading: string;
      voiceMessage: string;
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
      /** Inline / bubble image opens fullscreen preview */
      attachmentPreviewImage: string;
      stepTimelineThinkingStreaming: string;
      stepTimelineThinkingDone: string;
      stepTimelineToolSearchRunning: string;
      stepTimelineToolSearchComplete: string;
      stepTimelineToolSearchError: string;
      stepTimelineToolGenericRunning: string;
      stepTimelineToolGenericComplete: string;
      stepTimelineToolGenericError: string;
      /** "Search sources · {{count}}" */
      searchSourcesHeading: string;
      /** Right drawer: agent thinking + tool execution log */
      executionDrawerTitle: string;
      executionDrawerClose: string;
      executionDrawerEmpty: string;
      /** Line above assistant reply; opens drawer when clicked */
      executionProgressDone: string;
      executionProgressRunning: string;
      /** Tooltip on elapsed time in the execution progress line */
      executionElapsedTitle: string;
      /** Assistant bubble: copy as plain text vs Markdown source */
      messageCopyPlainText: string;
      messageCopyMarkdown: string;
      messageCopied: string;
      commandPalette: {
        noResults: string;
        placeholder: string;
      };
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
      tabMyTasks: string;
      tabRunHistory: string;
      wakeBanner: string;
      keepAwake: string;
      wakeLockUnavailable: string;
      sortCreatedDesc: string;
      sortCreatedAsc: string;
      historyRangeDay: string;
      historyRangeWeek: string;
      historyRangeMonth: string;
      filterAllTasks: string;
      filterAllStatuses: string;
      emptyHistoryTitle: string;
      emptyHistoryHint: string;
      jobCardMenuAria: string;
      scheduleBadge: {
        everyMinute: string;
        everyNMinutes: string;
        everyNHours: string;
        hourly: string;
        dailyAt: string;
        weekdaysAt: string;
        weeklyOn: string;
        cronExpr: string;
      };
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
      schedulePicker: {
        scheduleTimeLabel: string;
        modeNoRepeat: string;
        modeInterval: string;
        intervalKindMinutes: string;
        intervalKindHours: string;
        modeHourly: string;
        modeDaily: string;
        modeWeekly: string;
        modeMonthly: string;
        modeCustom: string;
        minuteUnit: string;
        minuteAtHour: string;
        intervalMinutes: string;
        intervalHours: string;
        hourUnit: string;
        dayOfMonth: string;
        customCronHint: string;
        weekdays: [string, string, string, string, string, string, string];
      };
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
    workspace: {
      title: string;
      currentWorkspace: string;
      openFiles: string;
      preview: string;
      download: string;
      copyPath: string;
      pathCopied: string;
      edit: string;
      viewing: string;
      saved: string;
      saving: string;
      emptyDir: string;
      loadError: string;
      close: string;
      lastModified: string;
    };
    skills: {
      title: string;
      needToken: string;
      tagline: string;
      refresh: string;
      reloadRuntime: string;
      reloadDiskAria: string;
      skillsNavAria: string;
      tabBuiltin: string;
      tabUser: string;
      tabMarketplace: string;
      marketplacePlaceholder: string;
      sectionBuiltinList: string;
      filterAll: string;
      filterGlobal: string;
      filterWorkspace: string;
      filterExtra: string;
      sectionUser: string;
      installCta: string;
      installModalTitle: string;
      installModalDropHint: string;
      installModalReqTitle: string;
      installModalReq1: string;
      installModalReq2: string;
      installAction: string;
      installClose: string;
      searchPlaceholder: string;
      noSearchResults: string;
      uploading: string;
      loading: string;
      empty: string;
      loadFailed: string;
      reloadFailed: string;
      skillToggleFailed: string;
      uploadFailed: string;
      installSuccess: string;
      zipOnly: string;
      invalidFile: string;
      delete: string;
      deleteTitle: string;
      deleteMessage: string;
      deleteConfirm: string;
      deleteFailed: string;
      yes: string;
      no: string;
      cancel: string;
      source: { builtin: string; workspace: string; global: string; extra: string };
      col: { name: string; description: string; source: string; managed: string; actions: string };
      detailModalBanner: string;
      detailModalEnable: string;
      detailModalDisable: string;
      detailLoadFailed: string;
      detailCloseAria: string;
      hubRemote: string;
      hubKindGit: string;
      hubKindArchive: string;
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
      statsDetailTitle: string;
      logDir: string;
      requestId: string;
      sessionId: string;
      presetAll: string;
      presetErrors: string;
      presetWarnPlus: string;
      presetInfoPlus: string;
      presetVerbose: string;
      presetOther: string;
      levelPresetAria: string;
      refreshModeAria: string;
      refreshManual: string;
      refreshLive: string;
      filtersMore: string;
      filtersDialogTitle: string;
      filtersDialogDesc: string;
      filtersDone: string;
      levelCustom: string;
      levelCustomHint: string;
      copyMessage: string;
      copyJson: string;
      copied: string;
      levelNames: {
        trace: string;
        debug: string;
        info: string;
        warn: string;
        error: string;
        fatal: string;
      };
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
      cardBrowserTitle: string;
      cardBrowserSubtitle: string;
      browserEnabledOn: string;
      browserHeadlessOn: string;
      cardGenerationTitle: string;
      cardGenerationSubtitle: string;
      cardBehaviorTitle: string;
      cardBehaviorSubtitle: string;
      label: {
        model: string;
        modelFallbacks: string;
        imageModel: string;
        imageModelFallbacks: string;
        imageGenerationModel: string;
        imageGenerationModelFallbacks: string;
        mediaMaxMb: string;
        workspace: string;
        browserEnabled: string;
        browserHeadless: string;
        maxTokens: string;
        temperature: string;
        maxToolIterations: string;
        thinkingDefault: string;
        reasoningDefault: string;
        verboseDefault: string;
      };
      desc: {
        model: string;
        modelFallbacks: string;
        imageModel: string;
        imageModelFallbacks: string;
        imageGenerationModel: string;
        imageGenerationModelFallbacks: string;
        mediaMaxMb: string;
        workspace: string;
        browserEnabled: string;
        browserHeadless: string;
        maxTokens: string;
        temperature: string;
        maxToolIterations: string;
        thinkingDefault: string;
        reasoningDefault: string;
        verboseDefault: string;
      };
      addModelFallback: string;
      removeModelFallback: string;
      reasoning: { off: string; on: string; stream: string };
      verbose: { off: string; on: string; full: string };
    };
    agentsSettings: {
      title: string;
      subtitle: string;
      needToken: string;
      loadError: string;
      saveError: string;
      loading: string;
      tabOverview: string;
      tabDefaults: string;
      tabFiles: string;
      tabTools: string;
      tabSkills: string;
      tabChannels: string;
      tabCron: string;
      selectAgent: string;
      selectAgentHint: string;
      agent: string;
      defaultBadge: string;
      setDefault: string;
      editAgent: string;
      editAgentHint: string;
      displayName: string;
      workspacePath: string;
      modelPrimary: string;
      modelClear: string;
      save: string;
      removeFromConfig: string;
      purgeDisk: string;
      addAgent: string;
      addAgentHint: string;
      newName: string;
      newWorkspace: string;
      newModelOptional: string;
      create: string;
      addAgentAria: string;
      createModalCancel: string;
      closeDialogAria: string;
      filesHint: string;
      filesLoading: string;
      filesEmpty: string;
      pickFile: string;
      saveFile: string;
      filesBootstrapEdit: string;
      filesBootstrapPreview: string;
      filesAutoSaveHint: string;
      filesSavingStatus: string;
      missing: string;
      confirmDelete: string;
      confirmDeletePurge: string;
      toolsTitle: string;
      toolsHint: string;
      toolsSave: string;
      toolsClearEntry: string;
      toolsLockedByDefaults: string;
      toolDescriptions: {
        read_file: string;
        write_file: string;
        edit_file: string;
        list_dir: string;
        grep: string;
        find: string;
        shell: string;
        web_search: string;
        web_fetch: string;
        send_message: string;
        send_media: string;
        memory_search: string;
        memory_get: string;
        curated_memory: string;
        session_search: string;
        image: string;
        image_generate: string;
        extensions: string;
      };
      skillsTitle: string;
      skillsHint: string;
      skillsInherit: string;
      skillsCustomize: string;
      skillsSave: string;
      skillsCatalogLoading: string;
      skillsEmptyCatalog: string;
      skillsNoDescription: string;
      skillsDefaultsLabel: string;
      skillsEffectiveLabel: string;
      skillsAllFromCatalog: string;
      channelsTitle: string;
      channelsHint: string;
      channelsLoading: string;
      channelsNone: string;
      channelLabel: string;
      peerIdLabel: string;
      addBinding: string;
      removeBinding: string;
      cronTitle: string;
      cronHint: string;
      cronLoading: string;
      cronNone: string;
      cronColSchedule: string;
      cronColMessage: string;
      cronColSession: string;
      cronColAgent: string;
      cronAgentDefault: string;
      cronAgentClear: string;
    };
    providersSettings: {
      subtitle: string;
      intro: string;
      docsLink: string;
      modelsLink: string;
      rotateHint: string;
      needToken: string;
      loadError: string;
      save: string;
      saving: string;
      saved: string;
      noChangesSaved: string;
      saveError: string;
      empty: string;
      searchPlaceholder: string;
      unconfiguredOnly: string;
      noMatches: string;
      clearFilters: string;
      discard: string;
      unsavedHint: string;
      runtimeLabelPrefix: string;
      sourceAgent: string;
      sourceGateway: string;
      sourceOauth: string;
      sourceEnv: string;
      sourceModelsJson: string;
      sourceNone: string;
      testKey: string;
      testingKey: string;
      testOkLiteral: string;
      testOkEnv: string;
      testOkCommand: string;
      testFailed: string;
      revokeFailed: string;
      expandRowDetails: string;
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
      maskedStoredHint: string;
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
      presetZhipuCn: string;
      presetZaiGeneral: string;
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
      refresh: string;
      loadError: string;
      loading: string;
      save: string;
      saving: string;
      saved: string;
      saveError: string;
      retry: string;
      unsavedHint: string;
      /** Hub: card row action (Qoder-style). */
      hubConfigureButton: string;
      /** Hub: card row when channel has saved credentials. */
      hubConnectedBadge: string;
      enableChannelAria: string;
      menuMoreAria: string;
      menuEditConfig: string;
      menuRemoveConfig: string;
      removeChannelTitle: string;
      removeChannelConfirm: string;
      removeChannelAction: string;
      modalCancel: string;
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
      weixinQuickStartTitle: string;
      weixinStepLogin: string;
      weixinStepEnable: string;
      weixinStepPairing: string;
      weixinAdvancedHint: string;
      weixinAllowFrom: string;
      weixinAllowFromDesc: string;
      weixinRouteTag: string;
      weixinRouteTagDesc: string;
      routeTagPlaceholder: string;
      weixinDebug: string;
      weixinDebugDesc: string;
      weixinAccountsJson: string;
      weixinAccountsJsonDesc: string;
      weixinQrLoginTitle: string;
      weixinQrLoginDesc: string;
      weixinQrLoginButton: string;
      weixinQrLoginBusy: string;
      weixinQrLoginScanned: string;
      weixinQrLoginSuccess: string;
      weixinQrLoginCancel: string;
      weixinQrImageError: string;
      weixinQrOpenLink: string;
      weixinQrEncoding: string;
      weixinQrModalTitle: string;
      weixinQrModalSubtitle: string;
      weixinQrRegenerate: string;
      weixinQrModalCloseAria: string;
      /** How to configure this channel via CLI (same config file as the gateway). */
      telegramCliConfigHint: string;
      weixinCliConfigHint: string;
      /** `bindings`: which agent handles inbound for each channel account */
      agentRoutingTitle: string;
      agentRoutingHint: string;
      agentRoutingAccountLabel: string;
      agentRoutingAgentLabel: string;
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
    appearanceSettings: {
      pageTitle: string;
      subtitle: string;
      languageTitle: string;
      languageDescription: string;
      themeTitle: string;
      themeDescription: string;
      colorSchemeTitle: string;
      colorSchemeDescription: string;
      colorSchemeDefault: string;
      colorSchemeLightGreen: string;
      fontScaleTitle: string;
      fontScaleDescription: string;
      fontScaleCompact: string;
      fontScaleDefault: string;
      fontScaleLarge: string;
      langOptionEn: string;
      langOptionZh: string;
      themeOptionLight: string;
      themeOptionDark: string;
      themeOptionSystem: string;
      openFullPreferences: string;
      quickMenuHint: string;
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
      authModeNone: string;
    };
    heartbeatSettings: {
      needToken: string;
      subtitle: string;
      docsLink: string;
      loadError: string;
      loading: string;
      saveConfig: string;
      savingConfig: string;
      savedConfig: string;
      saveConfigError: string;
      triggerNow: string;
      triggering: string;
      triggered: string;
      triggerError: string;
      triggerHint: string;
      saveDoc: string;
      savingDoc: string;
      savedDoc: string;
      saveDocError: string;
      retry: string;
      unsavedConfig: string;
      unsavedDoc: string;
      workspaceLabel: string;
      configSection: string;
      docSection: string;
      docHint: string;
      enable: string;
      interval: string;
      intervalHint: string;
      intervalHintPreset: string;
      intervalSecondsLabel: string;
      intervalPresets: {
        custom: string;
        every30s: string;
        every1min: string;
        every5min: string;
        every10min: string;
        every15min: string;
        every30min: string;
        every1h: string;
        every2h: string;
      };
      deliveryTitle: string;
      channelNone: string;
      customChannelSuffix: string;
      deliveryHint: string;
      prompt: string;
      promptPlaceholder: string;
      promptHint: string;
      ackMaxChars: string;
      ackMaxCharsHint: string;
      ackDefaultPlaceholder: string;
      isolatedSession: string;
      isolatedSessionHint: string;
      activeHoursTitle: string;
      activeStart: string;
      activeEnd: string;
      activeTimezone: string;
      activeHoursHint: string;
      addActiveHours: string;
      clearActiveHours: string;
    };
    webSearchSettings: {
      title: string;
      subtitle: string;
      docsLink: string;
      needToken: string;
      loading: string;
      loadError: string;
      save: string;
      saving: string;
      saved: string;
      saveError: string;
      unsavedHint: string;
      sectionRegion: string;
      sectionRegionHint: string;
      sectionSearch: string;
      sectionSearchHint: string;
      regionLabel: string;
      regionDesc: string;
      regionAuto: string;
      regionCn: string;
      regionGlobal: string;
      maxResultsLabel: string;
      maxResultsDesc: string;
      providersTitle: string;
      addProvider: string;
      apiKeyLabel: string;
      apiKeyDesc: string;
      urlLabel: string;
      urlDesc: string;
      keyPlaceholder: string;
      keyPlaceholderMasked: string;
      disabled: string;
      footerHint: string;
      providerTypes: {
        brave: string;
        tavily: string;
        bing: string;
        searxng: string;
      };
    };
  }
> = {
  en: {
    appBrand: 'XOPC',
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
      cron: 'Scheduled Tasks',
      skills: 'Skills',
      channels: 'Channels',
      logs: 'Logs',
      settingsAppearance: 'Preferences',
      settingsProviders: 'Providers',
      settingsModels: 'Models',
      settingsChannels: 'Channels',
      settingsVoice: 'Voice',
      settingsGateway: 'Gateway',
      settingsHeartbeat: 'Heartbeat',
      settingsSearch: 'Web search',
      settingsAgents: 'Agents',
    },
    settingsSections: {
      appearance: 'Preferences',
      agent: 'Agent',
      providers: 'Providers',
      models: 'Models',
      channels: 'Channels',
      voice: 'Voice',
      gateway: 'Gateway',
      heartbeat: 'Heartbeat',
      search: 'Web search',
      agents: 'Agents',
    },
    settingsNavGroups: {
      gateway: 'Connection & service',
      agentAndModels: 'Providers & models',
      data: 'Sessions & logs',
      interface: 'General',
      voice: 'Voice',
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
    gatewayLanding: {
      headline: 'Connect to this gateway',
      subline:
        'The Web console needs the same token your server uses. Get it from setup or your config file, then paste it below.',
      sessionExpired: 'Your session expired or the token was rejected. Enter a valid gateway token to continue.',
      stepOnboard: 'Run xopc onboard (or onboard --gateway) and enable the Web console — the token is printed there.',
      stepPaste: 'Paste the token here and save. You can also open a link that ends with ?token=… from onboarding.',
      stepUrlHint: 'Opening a bookmark with ?token= in the URL saves it automatically (the address bar is cleaned afterward).',
      docsGatewayLink: 'Gateway guide',
    },
    electron: {
      setupBannerTitle: 'Finish setup to start chatting',
      setupBannerBody:
        'Add at least one model provider API key and choose a default model. You can change this anytime in Settings.',
      setupBannerLinkProviders: 'Provider keys',
      setupBannerLinkModels: 'Default model',
      setupBannerDismiss: 'Dismiss for this session',
      gatewayExitTitle: 'Local gateway stopped',
      gatewayExitBody: 'The assistant backend exited unexpectedly. Restart the app to continue.',
    },
    connection: {
      connecting: 'Connecting…',
      online: 'Online',
      reconnecting: 'Reconnecting…',
      offline: 'Offline',
      error: 'Connection error',
      reconnect: 'Reconnect',
    },
    api: {
      errorBadGateway: 'Bad gateway (502)',
      errorServiceUnavailable: 'Service unavailable (503)',
      errorGatewayTimeout: 'Gateway timeout (504)',
      errorInternal: 'Internal server error (500)',
      errorServer: 'Server error ({{status}})',
      errorNotFound: 'Not found (404)',
      errorForbidden: 'Forbidden (403)',
      errorRequest: 'Request failed ({{status}})',
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
      taskSessionMenuAria: 'Session actions',
      taskRename: 'Rename',
      taskCopyChatId: 'Copy chat ID',
      taskDeleteTask: 'Delete task',
      taskRenameTitle: 'Rename task',
      taskRenamePlaceholder: 'Session name',
      taskRenameSave: 'Save',
      taskRenameCancel: 'Cancel',
      backToApp: 'Back to app',
      helpDocs: 'Documentation',
      sessionChannelFilterAria: 'Filter tasks: web app or IM channels',
      sessionTasksTab: 'Tasks',
      sessionChannelsTab: 'Channels',
    },
    chat: {
      typeMessage: 'Type a message…',
      sendMessage: 'Send',
      abort: 'Abort',
      needToken: 'Save a gateway token to chat.',
      loading: 'Loading conversation…',
      model: 'Model',
      modelPlaceholder: 'Select a model…',
      agent: 'Agent',
      agentPlaceholder: 'Select an agent…',
      agentSearchPlaceholder: 'Search agents…',
      agentNoMatches: 'No matching agents',
      thinkingLevel: 'Thinking',
      newSession: 'New chat',
      welcomeTitle: 'Welcome to xopc',
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
      attachmentFileTooLarge: 'File "{{name}}" is too large (max {{maxSize}} per file).',
      inputPlaceholder: 'Plan, @ for context, / for commands',
      currentModel: 'Model used for this conversation',
      modelSearchPlaceholder: 'Search by name, provider, or ID…',
      modelNoMatches: 'No models match your search',
      dropFiles: 'Drop files here to attach',
      voiceRecording: 'Record voice',
      voiceRecordingStop: 'Stop recording',
      voiceMicDenied: 'Microphone access denied or unavailable.',
      inputPlaceholderSteering: 'Follow-up: Enter queues a row; click a row to edit here',
      steeringInterruptSend: 'Stop and send now (⌘↵ or Ctrl+↵)',
      followUpSuggestionsAria: 'Suggested follow-up questions',
      followUpChipErrorHandling: 'Add error handling and edge cases.',
      followUpChipRefactorReadability: 'Refactor for readability.',
      followUpChipShorterSummary: 'Give a shorter summary.',
      followUpChipMainRisks: 'What are the main risks?',
      followUpChipSimplerTerms: 'Explain that in simpler terms.',
      followUpChipConcreteExample: 'Give a concrete example.',
      followUpChipWhatNext: 'What should I do next?',
      followUpQueueAria: 'Follow-up queue (sent after this reply, in order)',
      followUpQueueHeading: 'Follow-ups',
      followUpQueueClickToEdit: 'Edit in composer',
      followUpQueueAttachmentOnly: '(attachment)',
      followUpQueueEmptyPreview: '(empty)',
      followUpQueueDrag: 'Drag to reorder',
      followUpQueueMoveUp: 'Move up',
      followUpQueueMoveDown: 'Move down',
      followUpQueueSteerNow: 'Inject as steering (tool boundary)',
      followUpQueueRemove: 'Remove from queue',
      followUpQueueAttachmentsNote: 'Rows with attachments cannot use ✨ steer; they send as full messages in order.',
      followUpQueueMaxReached: 'Follow-up queue is full (max {{max}}). Remove one or wait for the run to finish.',
      voicePlay: 'Play voice',
      voicePause: 'Pause',
      voiceLoading: 'Loading audio…',
      voiceMessage: 'Voice',
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
      attachmentPreviewImage: 'Preview image',
      stepTimelineThinkingStreaming: 'Thinking…',
      stepTimelineThinkingDone: 'Thinking complete',
      stepTimelineToolSearchRunning: 'Searching the web…',
      stepTimelineToolSearchComplete: 'Web search complete',
      stepTimelineToolSearchError: 'Web search failed',
      stepTimelineToolGenericRunning: '{{name}}…',
      stepTimelineToolGenericComplete: '{{name}} complete',
      stepTimelineToolGenericError: '{{name}} failed',
      searchSourcesHeading: 'Search sources · {{count}}',
      executionDrawerTitle: 'Execution',
      executionDrawerClose: 'Close',
      executionDrawerEmpty: 'No steps for this reply yet.',
      executionProgressDone: 'Thinking complete',
      executionProgressRunning: 'Thinking & tools…',
      executionElapsedTitle: 'Elapsed time for this run',
      messageCopyPlainText: 'Copy plain text',
      messageCopyMarkdown: 'Copy Markdown',
      messageCopied: 'Copied',
      commandPalette: {
        noResults: 'No matching commands or skills',
        placeholder: 'Search skills and commands…',
      },
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
      title: 'Scheduled Tasks',
      subtitle:
        'Tasks run automatically on schedule and can be triggered manually anytime. Describe what you want to do regularly in any chat to create one quickly.',
      needToken: 'Save a gateway token to manage scheduled tasks.',
      statsRegion: 'Overview',
      tabMyTasks: 'My Scheduled Tasks',
      tabRunHistory: 'Run History',
      wakeBanner:
        'Scheduled tasks only run while this device is awake. When the system or display sleeps, runs may be skipped.',
      keepAwake: 'Keep screen awake',
      wakeLockUnavailable: 'Screen wake lock is not available in this browser or context.',
      sortCreatedDesc: 'Created (newest first)',
      sortCreatedAsc: 'Created (oldest first)',
      historyRangeDay: 'Day',
      historyRangeWeek: 'Week',
      historyRangeMonth: 'Month',
      filterAllTasks: 'All tasks',
      filterAllStatuses: 'All statuses',
      emptyHistoryTitle: 'No execution records',
      emptyHistoryHint: 'Records will appear here once scheduled tasks start running.',
      jobCardMenuAria: 'Task actions',
      scheduleBadge: {
        everyMinute: 'Every minute',
        everyNMinutes: 'Every {{n}} minutes',
        everyNHours: 'Every {{n}} hours',
        hourly: 'Hourly',
        dailyAt: 'Daily, {{time}}',
        weekdaysAt: 'Weekdays, {{time}}',
        weeklyOn: '{{day}}, {{time}}',
        cronExpr: '{{expr}}',
      },
      jobsHeading: 'Scheduled jobs',
      addJob: 'New task',
      editJob: 'Edit task',
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
      runHistoryTitle: 'Run History',
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
      noRunsYet: 'No executions in this range.',
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
      schedulePicker: {
        scheduleTimeLabel: 'Scheduled time',
        modeNoRepeat: 'Does not repeat (yearly date)',
        modeInterval: 'Interval',
        intervalKindMinutes: 'Minutes',
        intervalKindHours: 'Hours',
        modeHourly: 'Every hour',
        modeDaily: 'Daily',
        modeWeekly: 'Weekly',
        modeMonthly: 'Monthly',
        modeCustom: 'Custom (cron)',
        minuteUnit: 'min',
        minuteAtHour: 'Minute',
        intervalMinutes: 'Interval in minutes',
        intervalHours: 'Interval in hours',
        hourUnit: 'h',
        dayOfMonth: 'Day of month',
        customCronHint: 'Five-field cron: minute hour day-of-month month day-of-week',
        weekdays: ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'],
      },
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
    workspace: {
      title: 'Project Files',
      currentWorkspace: 'Current Workspace',
      openFiles: 'Project Files',
      preview: 'Preview',
      download: 'Download',
      copyPath: 'Copy Path',
      pathCopied: 'Path copied',
      edit: 'Edit',
      viewing: 'Viewing',
      saved: 'Saved',
      saving: 'Saving…',
      emptyDir: 'No files',
      loadError: 'Failed to load',
      close: 'Close',
      lastModified: 'Modified',
    },
    skills: {
      title: 'Skills',
      needToken: 'Save a gateway token to manage skills.',
      tagline:
        'Install and manage skills to extend xopc in conversation. Managed skills live under ~/.xopc/skills.',
      refresh: 'Refresh list',
      reloadRuntime: 'Reload from disk',
      reloadDiskAria: 'Reload skills from disk',
      skillsNavAria: 'Skill sources',
      tabBuiltin: 'Built-in',
      tabUser: 'Installed',
      tabMarketplace: 'Marketplace',
      marketplacePlaceholder: 'The skill marketplace is coming soon.',
      sectionBuiltinList: 'Built-in skills',
      filterAll: 'All',
      filterGlobal: 'Global',
      filterWorkspace: 'Workspace',
      filterExtra: 'Extra',
      sectionUser: 'Your skills',
      installCta: 'Install skill',
      installModalTitle: 'Install skill',
      installModalDropHint: 'Drop a .zip or SKILL.md file, or click to choose.',
      installModalReqTitle: 'Requirements',
      installModalReq1: 'A .zip archive that contains SKILL.md',
      installModalReq2: 'Or drop a SKILL.md file directly',
      installAction: 'Install',
      installClose: 'Close',
      searchPlaceholder: 'Search skills',
      noSearchResults: 'No skills match your search.',
      uploading: 'Uploading…',
      loading: 'Loading…',
      empty: 'No skills loaded.',
      loadFailed: 'Failed to load skills',
      reloadFailed: 'Failed to reload skills',
      skillToggleFailed: 'Failed to update skill',
      uploadFailed: 'Upload failed',
      installSuccess: 'Skill installed.',
      zipOnly: 'Please choose a .zip file',
      invalidFile: 'Choose a .zip or SKILL.md file',
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
        extra: 'Extra',
      },
      col: {
        name: 'Name',
        description: 'Description',
        source: 'Source',
        managed: 'Managed',
        actions: 'Actions',
      },
      detailModalBanner: 'The following is the original SKILL.md for this skill.',
      detailModalEnable: 'Enable',
      detailModalDisable: 'Disable',
      detailLoadFailed: 'Failed to load SKILL.md',
      detailCloseAria: 'Close',
      hubRemote: 'Remote',
      hubKindGit: 'git',
      hubKindArchive: 'archive',
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
      statsDetailTitle: 'Level breakdown',
      logDir: 'Directory',
      requestId: 'Request ID',
      sessionId: 'Session ID',
      presetAll: 'All',
      presetErrors: 'Errors',
      presetWarnPlus: 'Warn+',
      presetInfoPlus: 'Info+',
      presetVerbose: 'Debug',
      presetOther: 'More',
      levelPresetAria: 'Filter by log level',
      refreshModeAria: 'Log refresh mode',
      refreshManual: 'Manual',
      refreshLive: 'Live',
      filtersMore: 'More filters',
      filtersDialogTitle: 'More filters',
      filtersDialogDesc: 'Time range and custom log levels.',
      filtersDone: 'Done',
      levelCustom: 'Custom levels',
      levelCustomHint: 'Toggle to include or exclude. No selection means all levels.',
      copyMessage: 'Copy message',
      copyJson: 'Copy JSON',
      copied: 'Copied',
      levelNames: {
        trace: 'trace',
        debug: 'debug',
        info: 'info',
        warn: 'warn',
        error: 'error',
        fatal: 'fatal',
      },
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
      cardBrowserTitle: 'Browser automation',
      cardBrowserSubtitle: 'Playwright tools (browser_navigate, snapshot, click, …)',
      browserEnabledOn: 'Enable browser tools',
      browserHeadlessOn: 'Run headless (no visible window)',
      cardGenerationTitle: 'Sampling & tools',
      cardGenerationSubtitle: 'Token budget, randomness, and tool loop depth',
      cardBehaviorTitle: 'Reasoning & output',
      cardBehaviorSubtitle: 'Thinking depth, traces, and verbosity',
      label: {
        model: 'Model',
        modelFallbacks: 'Fallback models',
        imageModel: 'Image model',
        imageModelFallbacks: 'Image understanding fallbacks',
        imageGenerationModel: 'Image generation model',
        imageGenerationModelFallbacks: 'Image generation fallbacks',
        mediaMaxMb: 'Image load limit (MB)',
        workspace: 'Workspace',
        browserEnabled: 'Browser tools',
        browserHeadless: 'Headless mode',
        maxTokens: 'Max tokens',
        temperature: 'Temperature',
        maxToolIterations: 'Max tool iterations',
        thinkingDefault: 'Thinking level',
        reasoningDefault: 'Reasoning visibility',
        verboseDefault: 'Verbose mode',
      },
      desc: {
        model: 'Default model for new sessions.',
        modelFallbacks:
          'Tried in order when the primary model returns an error after transient retries. Requires API keys for each provider.',
        imageModel: 'Optional. Used for image understanding / vision.',
        imageModelFallbacks:
          'When the chat model has no vision, these vision models describe inbound images (and for the image tool). Tried in order.',
        imageGenerationModel: 'Optional. For image_generate (e.g. openai/gpt-image-1).',
        imageGenerationModelFallbacks:
          'Tried in order when the primary image generation model fails (e.g. quota or provider error).',
        mediaMaxMb: 'Max size when loading images in the image tool.',
        workspace: 'Working directory for agent files.',
        browserEnabled:
          'Exposes Playwright browser_* tools to the model. Install Chromium once on the gateway host: npx playwright install chromium.',
        browserHeadless:
          'When off, Chromium shows a window on the gateway machine (useful for debugging). When on, runs in the background.',
        maxTokens: 'Maximum tokens in the model response.',
        temperature: 'Randomness (0–2).',
        maxToolIterations: 'Maximum tool calls per user message.',
        thinkingDefault: 'Default thinking level for new sessions.',
        reasoningDefault:
          'Whether to surface model reasoning in the chat UI. Per-session overrides (e.g. /reasoning) take precedence until cleared.',
        verboseDefault:
          'Agent verbosity for logs/tool detail elsewhere — not the reasoning/thinking panel. Use Reasoning visibility to hide reasoning.',
      },
      addModelFallback: 'Add fallback model',
      removeModelFallback: 'Remove fallback model',
      reasoning: { off: 'Off', on: 'On', stream: 'Stream' },
      verbose: { off: 'Off', on: 'On', full: 'Full' },
    },
    agentsSettings: {
      title: 'Agents',
      subtitle:
        'Manage agents.list entries: workspaces, default routing, persona bootstrap files.',
      needToken: 'Save a gateway token to manage agents.',
      loadError: 'Failed to load agents',
      saveError: 'Request failed',
      loading: 'Loading…',
      tabOverview: 'Agents',
      tabDefaults: 'Defaults',
      tabFiles: 'Bootstrap files',
      tabTools: 'Tools',
      tabSkills: 'Skills',
      tabChannels: 'Channels',
      tabCron: 'Cron',
      selectAgent: 'Agent',
      selectAgentHint: 'Choose an entry to edit or inspect bootstrap Markdown under ~/.xopc/agents/<id>/bootstrap/.',
      agent: 'Agent',
      defaultBadge: 'default',
      setDefault: 'Set as default',
      editAgent: 'Edit entry',
      editAgentHint: 'Updates agents.list on the gateway. Paths are expanded (~ → home).',
      displayName: 'Display name',
      workspacePath: 'Markdown workspace',
      modelPrimary: 'Model (primary)',
      modelClear: 'Clear',
      save: 'Save changes',
      removeFromConfig: 'Remove from config',
      purgeDisk: 'Remove + delete data',
      addAgent: 'Add agent',
      addAgentHint: 'Same as CLI agents add: creates directories and seeds bootstrap templates.',
      newName: 'Name / id seed',
      newWorkspace: 'Workspace directory (required)',
      newModelOptional: 'Model (optional)',
      create: 'Create agent',
      addAgentAria: 'Add agent',
      createModalCancel: 'Cancel',
      closeDialogAria: 'Close',
      filesHint:
        'Editable persona files (SOUL, IDENTITY, …). Changes save automatically after you stop typing; use Preview to render Markdown.',
      filesLoading: 'Loading file list…',
      filesEmpty: 'No files yet.',
      pickFile: 'Select a file to edit.',
      saveFile: 'Save file',
      filesBootstrapEdit: 'Edit',
      filesBootstrapPreview: 'Preview',
      filesAutoSaveHint: 'Auto-saves when you pause typing.',
      filesSavingStatus: 'Saving…',
      missing: 'missing',
      confirmDelete: 'Remove this agent from config? Bindings referencing it will be stripped.',
      confirmDeletePurge:
        'Remove this agent and delete its workspace + ~/.xopc/agents/<id> data? This cannot be undone.',
      toolsTitle: 'Built-in tools',
      toolsHint:
        'Per-agent tool disables (merged with agents.defaults). Tools already disabled in defaults cannot be re-enabled here.',
      toolsSave: 'Save tool disables',
      toolsClearEntry: 'Clear per-agent disables',
      toolsLockedByDefaults: 'disabled in defaults',
      toolDescriptions: {
        read_file:
          'Read text and small files inside the agent workspace (paths are restricted to the workspace sandbox).',
        write_file: 'Create new files or overwrite existing ones under the workspace.',
        edit_file: 'Change existing files using locate-and-replace or patch-style edits.',
        list_dir: 'List files and subfolders in a workspace directory.',
        grep: 'Search file contents with regular expressions (similar to ripgrep).',
        find: 'Find files by name or glob pattern under the workspace.',
        shell:
          'Run shell commands with workspace context — high impact; turn off for read-only or safer agents.',
        web_search: 'Search the public web for facts and pages newer than the model may know.',
        web_fetch: 'Fetch a URL and read its text content for the model.',
        send_message:
          'Send outbound chat messages on connected channels (e.g. Telegram, CLI, gateway) when the agent replies.',
        send_media: 'Send images or other media attachments through those channels.',
        memory_search: 'Search indexed memories and notes stored for this agent.',
        memory_get: 'Load a specific memory entry or chunk by id.',
        curated_memory: 'Read or update curated markdown memories under the agent home directory.',
        session_search: 'Search across saved conversation transcripts and per-session summaries.',
        image: 'Analyze or describe images (vision) from the workspace or the current turn.',
        image_generate: 'Generate images using the configured image / image-generation model.',
        extensions: 'Expose tools registered by enabled extensions — disable to block all extension tools.',
      },
      skillsTitle: 'Skill allowlist',
      skillsHint:
        'Optional allowlist for <available_skills>. Inherit uses agents.defaults only; customize sets this agent’s skills array.',
      skillsInherit: 'Inherit defaults',
      skillsCustomize: 'Customize allowlist',
      skillsSave: 'Save skills',
      skillsCatalogLoading: 'Loading skill catalog…',
      skillsEmptyCatalog: 'No skills in catalog.',
      skillsNoDescription: 'No description in SKILL.md metadata.',
      skillsDefaultsLabel: 'Defaults allowlist:',
      skillsEffectiveLabel: 'Effective allowlist:',
      skillsAllFromCatalog: '(all catalog skills)',
      channelsTitle: 'Routing bindings',
      channelsHint:
        'config.bindings rows for this agent. Removing a rule updates the full bindings array on the gateway.',
      channelsLoading: 'Loading bindings…',
      channelsNone: 'No bindings target this agent.',
      channelLabel: 'Channel',
      peerIdLabel: 'Peer id (optional)',
      addBinding: 'Add binding',
      removeBinding: 'Remove',
      cronTitle: 'Scheduled jobs',
      cronHint:
        'Isolated cron jobs can pin an agent id for the session key. Jobs without an agent id use the default agent and appear when that agent is selected.',
      cronLoading: 'Loading cron jobs…',
      cronNone: 'No matching jobs.',
      cronColSchedule: 'Schedule',
      cronColMessage: 'Message',
      cronColSession: 'Session',
      cronColAgent: 'Agent',
      cronAgentDefault: 'Default agent',
      cronAgentClear: 'Reset to default',
    },
    providersSettings: {
      subtitle: 'Provider API keys and OAuth. Keys you save here go to the gateway credential store.',
      intro:
        'Search or open a group, expand a provider, paste a new key, then Save changes. OAuth opens in your browser when you choose it.',
      docsLink: 'Model & provider docs',
      modelsLink: 'Custom providers (models.json)',
      rotateHint: 'Rotating a key: expand the provider, paste the new secret, Save changes — no restart needed.',
      needToken: 'Save a gateway token to manage provider credentials.',
      loadError: 'Failed to load providers',
      save: 'Save changes',
      saving: 'Saving…',
      saved: 'Saved',
      noChangesSaved: 'No new keys to save.',
      saveError: 'Failed to save',
      empty: 'No providers available.',
      searchPlaceholder: 'Search providers…',
      unconfiguredOnly: 'Unconfigured only',
      noMatches: 'No providers match your filters.',
      clearFilters: 'Clear filters',
      discard: 'Discard',
      unsavedHint: 'You have unsaved changes.',
      runtimeLabelPrefix: 'Runtime credential:',
      sourceAgent: 'agent private profile',
      sourceGateway: 'saved in gateway (this console)',
      sourceOauth: 'OAuth token',
      sourceEnv: 'environment variable',
      sourceModelsJson: 'models.json',
      sourceNone: 'none',
      testKey: 'Test value',
      testingKey: 'Testing…',
      testOkLiteral: 'Value accepted (direct key or text).',
      testOkEnv: 'Environment variable resolves.',
      testOkCommand: 'Command resolved successfully.',
      testFailed: 'Check failed.',
      revokeFailed: 'Revoke failed.',
      expandRowDetails: 'Show credential fields',
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
      maskedStoredHint: 'Stored credential is not shown. Enter a new key above to replace it.',
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
      presetZhipuCn: 'Zhipu GLM (China · Coding API)',
      presetZaiGeneral: 'Zhipu GLM (International · general API)',
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
      refresh: 'Refresh',
      loadError: 'Failed to load channel settings',
      loading: 'Loading…',
      save: 'Save changes',
      saving: 'Saving…',
      saved: 'Saved',
      saveError: 'Failed to save',
      retry: 'Retry',
      unsavedHint: 'You have unsaved changes.',
      hubConfigureButton: 'Configure',
      hubConnectedBadge: 'Connected',
      enableChannelAria: 'Enable or disable this channel',
      menuMoreAria: 'More actions',
      menuEditConfig: 'Edit configuration',
      menuRemoveConfig: 'Remove configuration',
      removeChannelTitle: 'Remove configuration?',
      removeChannelConfirm:
        'Remove {{name}} settings and clear saved credentials on the gateway? You can configure again later.',
      removeChannelAction: 'Remove',
      modalCancel: 'Cancel',
      telegramTitle: 'Telegram',
      telegramSubtitle: 'Bot token, allowlists, and optional multi-account JSON.',
      weixinTitle: 'Weixin',
      weixinSubtitle:
        'Sign in with WeChat via QR (browser or CLI), then enable below. Credentials stay on the gateway host.',
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
      weixinQuickStartTitle: 'Quick start',
      weixinStepLogin:
        'Use “Sign in with WeChat (QR)” below in this console, or on the gateway host run: xopc channels login --channel weixin (repo: pnpm run dev -- channels login --channel weixin).',
      weixinStepEnable: 'Turn on Weixin below and save.',
      weixinStepPairing:
        'After QR login, DMs work immediately. Use allowlist DM policy only if you want to restrict who can message the bot.',
      weixinAdvancedHint: 'Optional: allowlist, route tag, streaming, and per-account JSON—only if you need them.',
      weixinAllowFrom: 'Allow from',
      weixinAllowFromDesc:
        'When DM policy is allowlist: comma-separated wxid / openid. Default pairing allows all contacts after QR login.',
      weixinRouteTag: 'Route tag',
      weixinRouteTagDesc: 'Optional tag for routing; numeric or string.',
      routeTagPlaceholder: 'e.g. tag name or number',
      weixinDebug: 'Debug mode',
      weixinDebugDesc: 'Extra logging for the Weixin channel.',
      weixinAccountsJson: 'Accounts (JSON)',
      weixinAccountsJsonDesc: 'Per-account name, CDN base URL, route tag, and policies.',
      weixinQrLoginTitle: 'Browser QR login',
      weixinQrLoginDesc:
        'Starts a login on the gateway. Scan with WeChat; when it succeeds, settings refresh automatically.',
      weixinQrLoginButton: 'Sign in with WeChat (QR)',
      weixinQrLoginBusy: 'Starting…',
      weixinQrLoginScanned: 'Scanned — confirm in WeChat',
      weixinQrLoginSuccess: 'Weixin connected.',
      weixinQrLoginCancel: 'Dismiss QR',
      weixinQrImageError:
        'Could not render the QR code here. You can open the link in a new tab, or tap Regenerate to try again.',
      weixinQrOpenLink: 'Open in new tab',
      weixinQrEncoding: 'Rendering QR…',
      weixinQrModalTitle: 'Scan to sign in',
      weixinQrModalSubtitle: 'Use WeChat to scan the QR code below to connect.',
      weixinQrRegenerate: 'Regenerate QR code',
      weixinQrModalCloseAria: 'Close',
      telegramCliConfigHint:
        'CLI (same config file as this gateway; override path with XOPC_CONFIG or --config):\n• Interactive: xopc onboard --channels\n• Or set TELEGRAM_BOT_TOKEN in the environment and/or edit channels.telegram in the JSON file.',
      weixinCliConfigHint:
        'CLI on the host that should hold credentials (override config path with XOPC_CONFIG or --config):\n• xopc channels login --channel weixin\n• Optional: --account <id>, --timeout <ms>, --credentials-only (save token files without merging config JSON).',
      agentRoutingTitle: 'Agent routing',
      agentRoutingHint:
        'Maps each channel account to an agent via config `bindings`. Inbound messages use a session key for that agent.',
      agentRoutingAccountLabel: 'Account',
      agentRoutingAgentLabel: 'Agent',
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
      subtitle: 'HTTP API access token and listen address. Values are stored in the gateway config file.',
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
      tokenHelp: 'Used to authenticate HTTP/WebSocket API requests. You can also set XOPC_GATEWAY_TOKEN.',
      copy: 'Copy',
      copied: 'Copied',
      show: 'Show',
      hide: 'Hide',
      listenHost: 'Listen address',
      listenPort: 'Port',
      listenHint: 'Effective after gateway restart if changed outside this UI.',
      authModeNone: 'Auth mode is set to none — token in config may be ignored.',
    },
    heartbeatSettings: {
      needToken: 'Save a gateway token to load and edit heartbeat options.',
      subtitle:
        'Periodic agent wake, optional delivery to a channel, and HEARTBEAT.md in your workspace. Stored in the gateway config file and workspace.',
      docsLink: 'Heartbeat documentation',
      loadError: 'Failed to load heartbeat settings',
      loading: 'Loading…',
      saveConfig: 'Save configuration',
      savingConfig: 'Saving…',
      savedConfig: 'Configuration saved',
      saveConfigError: 'Failed to save configuration',
      triggerNow: 'Run now',
      triggering: 'Queuing…',
      triggered: 'Heartbeat queued',
      triggerError: 'Failed to trigger heartbeat',
      triggerHint:
        'Queues one heartbeat run (same as the timer). Skipped if HEARTBEAT.md is empty, outside active hours, or heartbeat is disabled.',
      saveDoc: 'Save HEARTBEAT.md',
      savingDoc: 'Saving…',
      savedDoc: 'Document saved',
      saveDocError: 'Failed to save HEARTBEAT.md',
      retry: 'Retry',
      unsavedConfig: 'You have unsaved configuration changes.',
      unsavedDoc: 'You have unsaved changes to HEARTBEAT.md.',
      workspaceLabel: 'Workspace',
      configSection: 'Heartbeat configuration',
      docSection: 'HEARTBEAT.md',
      docHint:
        'Tasks and reminders read by the agent on each heartbeat. Leave empty or comment-only to skip LLM calls and save tokens.',
      enable: 'Enable heartbeat',
      interval: 'Interval',
      intervalHint: 'Minimum 1 second. Saved to the gateway as milliseconds.',
      intervalHintPreset: 'Quick preset or type seconds in the field.',
      intervalSecondsLabel: 'Seconds',
      intervalPresets: {
        custom: 'Custom',
        every30s: 'Every 30 seconds',
        every1min: 'Every 1 minute',
        every5min: 'Every 5 minutes',
        every10min: 'Every 10 minutes',
        every15min: 'Every 15 minutes',
        every30min: 'Every 30 minutes',
        every1h: 'Every 1 hour',
        every2h: 'Every 2 hours',
      },
      deliveryTitle: 'Delivery (optional)',
      channelNone: '— None —',
      customChannelSuffix: 'custom',
      deliveryHint:
        'Both channel and chat id are required to send non-silent replies somewhere. Otherwise the reply is only logged.',
      prompt: 'Custom system prompt (optional)',
      promptPlaceholder: 'Override the default heartbeat instruction…',
      promptHint: 'Leave empty to use the built-in default prompt.',
      ackMaxChars: 'Max reply length before treating as silent (ackMaxChars)',
      ackMaxCharsHint: 'Leave empty for server default (300).',
      ackDefaultPlaceholder: 'Default',
      isolatedSession: 'Use a fresh session key each run',
      isolatedSessionHint: 'Avoids mixing heartbeat context with the main chat session.',
      activeHoursTitle: 'Active hours (optional)',
      activeStart: 'Start',
      activeEnd: 'End',
      activeTimezone: 'Timezone (IANA)',
      activeHoursHint: 'Restrict heartbeats to this window. Clear to run any time.',
      addActiveHours: 'Add active hours',
      clearActiveHours: 'Clear active hours',
    },
    webSearchSettings: {
      title: 'Web search',
      subtitle:
        'Configure region and search providers for the web_search tool. Without API keys, a built-in HTML fallback is used.',
      docsLink: 'Gateway documentation',
      needToken: 'Save a gateway token to edit web search settings.',
      loading: 'Loading…',
      loadError: 'Failed to load web search settings',
      save: 'Save',
      saving: 'Saving…',
      saved: 'Saved',
      saveError: 'Failed to save',
      unsavedHint: 'You have unsaved changes.',
      sectionRegion: 'Region',
      sectionRegionHint:
        'Controls which zero-config HTML fallback is used when no API provider succeeds (China → Bing; otherwise DuckDuckGo).',
      sectionSearch: 'Search providers',
      sectionSearchHint:
        'Providers are tried in order. Keys are stored in the gateway config file. Leave the list empty to use only the HTML fallback.',
      regionLabel: 'Fallback region',
      regionDesc:
        'Auto uses your system timezone. Override if you are on a VPN or need a specific fallback.',
      regionAuto: 'Auto (timezone)',
      regionCn: 'China (Bing HTML fallback)',
      regionGlobal: 'Global (DuckDuckGo HTML fallback)',
      maxResultsLabel: 'Default max results',
      maxResultsDesc: 'Used when the model does not pass a count (1–50).',
      providersTitle: 'Providers (ordered)',
      addProvider: 'Add provider',
      apiKeyLabel: 'API key',
      apiKeyDesc: 'Optional for some setups. Leave masked to keep the saved value.',
      urlLabel: 'Instance URL',
      urlDesc: 'SearXNG base URL (e.g. http://localhost:8080). No trailing slash required.',
      keyPlaceholder: 'API key or env var name',
      keyPlaceholderMasked: '•••••••• (unchanged)',
      disabled: 'Skip',
      footerHint:
        'HTML fallbacks depend on third-party pages and may change. For production, use a supported search API (Brave, Tavily, Bing, or self-hosted SearXNG).',
      providerTypes: {
        brave: 'Brave Search API',
        tavily: 'Tavily',
        bing: 'Bing Web Search API',
        searxng: 'SearXNG',
      },
    },
    appearanceSettings: {
      pageTitle: 'Preferences',
      subtitle:
        'Language, appearance, and text size for daily use. Stored in this browser only.',
      languageTitle: 'Language',
      languageDescription: 'Choose the interface language.',
      themeTitle: 'Theme',
      themeDescription: 'Light, dark, or follow your system setting.',
      colorSchemeTitle: 'Color scheme',
      colorSchemeDescription: 'Visual style of the interface.',
      colorSchemeDefault: 'Default',
      colorSchemeLightGreen: 'Light green',
      fontScaleTitle: 'Conversation text size',
      fontScaleDescription: 'Adjust text size in chat and reading areas.',
      fontScaleCompact: 'Small',
      fontScaleDefault: 'Medium',
      fontScaleLarge: 'Large',
      langOptionEn: 'English',
      langOptionZh: '中文',
      themeOptionLight: 'Light',
      themeOptionDark: 'Dark',
      themeOptionSystem: 'System',
      openFullPreferences: 'Open all settings',
      quickMenuHint: 'Language, theme, and text size',
    },
  },
  zh: {
    appBrand: 'XOPC',
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
      channels: '即时通讯',
      logs: '日志',
      settingsAppearance: '偏好设置',
      settingsProviders: '服务商',
      settingsModels: '模型',
      settingsChannels: '即时通讯',
      settingsVoice: '语音',
      settingsGateway: '网关',
      settingsHeartbeat: '心跳',
      settingsSearch: '网络搜索',
      settingsAgents: '智能体',
    },
    settingsSections: {
      appearance: '偏好设置',
      agent: '智能体',
      providers: '服务商',
      models: '模型',
      channels: '即时通讯',
      voice: '语音',
      gateway: '网关',
      heartbeat: '心跳',
      search: '网络搜索',
      agents: '智能体',
    },
    settingsNavGroups: {
      gateway: '连接与服务',
      agentAndModels: '服务商与模型',
      data: '会话与日志',
      interface: '通用',
      voice: '语音',
    },
    token: {
      title: '需要身份验证',
      description: '请输入网关访问令牌以继续。',
      gatewayUrl: '网关地址',
      tokenLabel: '访问令牌',
      placeholder: '网关访问令牌（例如 ea4c67bf…）',
      save: '保存',
      show: '显示',
      hide: '隐藏',
    },
    gatewayLanding: {
      headline: '连接网关',
      subline: '网页控制台需使用与网关相同的访问令牌。请从初始化向导或配置文件中获取，并在下方粘贴。',
      sessionExpired: '登录已失效或访问令牌被拒绝，请重新输入有效的网关访问令牌。',
      stepOnboard: '在终端运行 xopc onboard（或 xopc onboard --gateway）并启用网页控制台，向导会打印访问令牌。',
      stepPaste: '将访问令牌粘贴到下方并保存。也可直接打开向导给出的带 ?token= 的链接。',
      stepUrlHint: '若使用带 ?token= 的链接打开，访问令牌会自动保存（随后地址栏会去掉参数）。',
      docsGatewayLink: '网关说明',
    },
    electron: {
      setupBannerTitle: '完成设置后即可对话',
      setupBannerBody: '请至少配置一家模型服务商的 API 密钥，并选择默认模型。之后可随时在设置中修改。',
      setupBannerLinkProviders: '服务商与密钥',
      setupBannerLinkModels: '默认模型',
      setupBannerDismiss: '本次会话不再提示',
      gatewayExitTitle: '本地网关已停止',
      gatewayExitBody: '助手后端进程异常退出，请重启应用后再试。',
    },
    connection: {
      connecting: '连接中…',
      online: '在线',
      reconnecting: '重连中…',
      offline: '离线',
      error: '连接异常',
      reconnect: '重连',
    },
    api: {
      errorBadGateway: '网关错误 (502)',
      errorServiceUnavailable: '服务不可用 (503)',
      errorGatewayTimeout: '网关超时 (504)',
      errorInternal: '服务器内部错误 (500)',
      errorServer: '服务器错误 ({{status}})',
      errorNotFound: '未找到 (404)',
      errorForbidden: '禁止访问 (403)',
      errorRequest: '请求失败 ({{status}})',
    },
    sidebar: {
      newTask: '新建对话',
      tasksHeading: '对话',
      viewAllSessions: '全部会话',
      taskListEmpty: '暂无会话',
      taskListNeedToken: '保存网关访问令牌后即可在此查看最近会话。',
      taskListAddToken: '填写访问令牌',
      taskListStartChat: '开始对话',
      appMenuAria: '应用菜单与设置',
      taskSessionMenuAria: '会话操作',
      taskRename: '重命名',
      taskCopyChatId: '复制会话 ID',
      taskDeleteTask: '删除对话',
      taskRenameTitle: '重命名对话',
      taskRenamePlaceholder: '会话名称',
      taskRenameSave: '保存',
      taskRenameCancel: '取消',
      backToApp: '返回应用',
      helpDocs: '帮助文档',
      sessionChannelFilterAria: '按来源筛选：网页对话或即时通讯',
      sessionTasksTab: '对话',
      sessionChannelsTab: '即时通讯',
    },
    chat: {
      typeMessage: '输入消息…',
      sendMessage: '发送',
      abort: '停止',
      needToken: '请先保存网关访问令牌后再对话。',
      loading: '加载对话中…',
      model: '模型',
      modelPlaceholder: '选择模型…',
      agent: '智能体',
      agentPlaceholder: '选择智能体…',
      agentSearchPlaceholder: '搜索智能体…',
      agentNoMatches: '没有匹配的智能体',
      thinkingLevel: '思考级别',
      newSession: '新对话',
      welcomeTitle: '欢迎使用 xopc',
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
      composerStageWriting: '撰写中…',
      composerStageExecuting: '执行中…',
      composerStageAnalyzing: '分析中…',
      attachFile: '添加附件',
      maxAttachmentsReached: '每条消息最多 {{max}} 个文件，请先移除部分附件。',
      maxAttachmentsTruncated: '已忽略 {{dropped}} 个文件（每条最多 {{max}} 个）。',
      attachmentFileTooLarge: '文件「{{name}}」过大（单文件最大 {{maxSize}}）。',
      inputPlaceholder: '输入计划，@ 引用上下文，/ 命令',
      currentModel: '当前对话使用的模型',
      modelSearchPlaceholder: '按名称、服务商或 ID 搜索…',
      modelNoMatches: '没有匹配的模型',
      dropFiles: '将文件拖放到此处添加',
      voiceRecording: '录制语音',
      voiceRecordingStop: '停止录音',
      voiceMicDenied: '无法使用麦克风（权限被拒绝或设备不可用）。',
      inputPlaceholderSteering: '后续问题：Enter 加入队列；点击队列一行在此编辑',
      steeringInterruptSend: '停止当前回复并立即发送（⌘↵ 或 Ctrl+↵）',
      followUpSuggestionsAria: '建议的后续问题',
      followUpChipErrorHandling: '补充错误处理和边界情况。',
      followUpChipRefactorReadability: '重构以提高可读性。',
      followUpChipShorterSummary: '给一段更短的摘要。',
      followUpChipMainRisks: '主要风险有哪些？',
      followUpChipSimplerTerms: '用更通俗的话解释一下。',
      followUpChipConcreteExample: '举一个具体例子。',
      followUpChipWhatNext: '我接下来该做什么？',
      followUpQueueAria: '后续问题队列（本轮结束后按顺序发送）',
      followUpQueueHeading: '后续问题',
      followUpQueueClickToEdit: '在输入框中编辑',
      followUpQueueAttachmentOnly: '（附件）',
      followUpQueueEmptyPreview: '（空）',
      followUpQueueDrag: '拖动排序',
      followUpQueueMoveUp: '上移',
      followUpQueueMoveDown: '下移',
      followUpQueueSteerNow: '在工具间隙注入引导内容',
      followUpQueueRemove: '从队列移除',
      followUpQueueAttachmentsNote: '含附件的队列项无法使用 ✨ 引导注入，将按顺序作为整条消息发送。',
      followUpQueueMaxReached: '后续问题队列已满（最多 {{max}} 条）。请删除一条或等当前回复结束。',
      voicePlay: '播放语音',
      voicePause: '暂停',
      voiceLoading: '正在加载音频…',
      voiceMessage: '语音',
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
      attachmentPreviewImage: '预览图片',
      stepTimelineThinkingStreaming: '正在思考…',
      stepTimelineThinkingDone: '思考完成',
      stepTimelineToolSearchRunning: '搜索网络中…',
      stepTimelineToolSearchComplete: '搜索网络完成',
      stepTimelineToolSearchError: '搜索失败',
      stepTimelineToolGenericRunning: '{{name}}中…',
      stepTimelineToolGenericComplete: '{{name}}完成',
      stepTimelineToolGenericError: '{{name}}失败',
      searchSourcesHeading: '搜索来源 · {{count}}',
      executionDrawerTitle: '执行过程',
      executionDrawerClose: '关闭',
      executionDrawerEmpty: '暂无执行步骤。',
      executionProgressDone: '已完成思考',
      executionProgressRunning: '思考与工具执行中…',
      executionElapsedTitle: '本次执行已耗时',
      messageCopyPlainText: '复制纯文本',
      messageCopyMarkdown: '复制 Markdown 格式',
      messageCopied: '已复制',
      commandPalette: {
        noResults: '没有匹配的命令或技能',
        placeholder: '搜索技能与命令…',
      },
    },
    sessions: {
      title: '会话',
      needToken: '请先保存网关访问令牌后再管理会话。',
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
      subtitle:
        '任务会按计划自动执行，也可随时手动触发。在任意对话里描述你想定期做的事，即可快速创建任务。',
      needToken: '请先保存网关访问令牌后再管理定时任务。',
      statsRegion: '概览',
      tabMyTasks: '我的定时任务',
      tabRunHistory: '运行记录',
      wakeBanner:
        '定时任务仅在设备保持唤醒时运行；系统或屏幕休眠时，执行可能会被跳过。',
      keepAwake: '保持屏幕常亮',
      wakeLockUnavailable: '当前浏览器或环境不支持屏幕唤醒锁。',
      sortCreatedDesc: '创建时间（新→旧）',
      sortCreatedAsc: '创建时间（旧→新）',
      historyRangeDay: '日',
      historyRangeWeek: '周',
      historyRangeMonth: '月',
      filterAllTasks: '全部任务',
      filterAllStatuses: '全部状态',
      emptyHistoryTitle: '暂无执行记录',
      emptyHistoryHint: '定时任务开始运行后，记录将显示在这里。',
      jobCardMenuAria: '任务操作',
      scheduleBadge: {
        everyMinute: '每分钟',
        everyNMinutes: '每 {{n}} 分钟',
        everyNHours: '每 {{n}} 小时',
        hourly: '每小时',
        dailyAt: '每天 {{time}}',
        weekdaysAt: '工作日 {{time}}',
        weeklyOn: '{{day}} {{time}}',
        cronExpr: '{{expr}}',
      },
      jobsHeading: '计划任务',
      addJob: '新建任务',
      editJob: '编辑任务',
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
      runHistoryTitle: '运行记录',
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
      noRunsYet: '该时间范围内暂无执行记录。',
      confirmDelete: '确定要删除此定时任务吗？',
      confirmRun: '立即执行此定时任务？',
      scheduleLabel: '计划',
      messageLabel: '消息',
      totalJobs: '任务总数',
      emptyStateTitle: '暂无定时任务',
      emptyStateHint: '创建任务即可按 cron 计划发送——直连即时通讯或经 AI 智能体处理。',
      emptyStateCta: '创建第一个任务',
      channel: '即时通讯',
      channelLocal: '本地（不发出）',
      deliveryTargetLocalChannel: '本地即时通讯 — 内容仅保存在本机',
      recipient: '接收方 *',
      recipientPlaceholder: 'Telegram：填写数字形式的会话 ID，或从下方最近会话中选择',
      refreshList: '刷新',
      refreshRecipientHint: '从最近会话重新加载列表',
      selectRecipient: '— 请选择 —',
      noRecentChatsOption: '暂无最近会话',
      deliveryTarget: '投递目标',
      scheduleHintPreset: '选择预设或输入自定义 cron 表达式',
      schedulePicker: {
        scheduleTimeLabel: '计划时间',
        modeNoRepeat: '不重复',
        modeInterval: '间隔',
        intervalKindMinutes: '分钟',
        intervalKindHours: '小时',
        modeHourly: '每小时',
        modeDaily: '每天',
        modeWeekly: '每周',
        modeMonthly: '每月',
        modeCustom: '自定义表达式',
        minuteUnit: '分',
        minuteAtHour: '分钟',
        intervalMinutes: '间隔分钟数',
        intervalHours: '间隔小时数',
        hourUnit: '小时',
        dayOfMonth: '日期',
        customCronHint: '标准五段 cron：分 时 日 月 周',
        weekdays: ['一', '二', '三', '四', '五', '六', '日'],
      },
      mode: '模式',
      modeDirect: '直接发送消息到即时通讯，不经过 AI 处理',
      modeAgent: '由 AI 智能体处理消息并生成回复后发送',
      modeDirectOption: '直接发送（发到即时通讯）',
      modeAgentOption: 'AI 智能体（先由模型处理再发送）',
      agentLocalOnly: '仅本地运行（保存对话，不发送到即时通讯）',
      agentLocalOnlyHint:
        '在本机运行智能体。对话会存为会话（键 cron:<任务 id>），类型为 cron；不向 Telegram/CLI 投递。',
      deliveryLocalOnly: '仅本地 — 对话保存在会话键 cron:<任务 id>',
      model: '模型',
      save: '保存',
      failedToLoadJobs: '加载任务失败',
      scheduleRequired: '计划表达式和消息为必填项',
      chatIdRequired: '会话 ID 为必填项',
      failedToCreateJob: '创建任务失败',
      failedToUpdateJob: '保存任务失败',
      failedToToggleJob: '切换任务状态失败',
      actionFailed: '操作失败',
      enterManuallyOrSelect: '手动输入或从最近聊天中选择',
      noRecentChats: '未找到最近会话。请手动填写会话 ID（例如 Telegram 为 123456789）',
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
    workspace: {
      title: '项目文件',
      currentWorkspace: '当前工作区',
      openFiles: '项目文件',
      preview: '预览',
      download: '下载',
      copyPath: '复制路径',
      pathCopied: '路径已复制',
      edit: '编辑',
      viewing: '查看中',
      saved: '已保存',
      saving: '保存中…',
      emptyDir: '暂无文件',
      loadError: '加载失败',
      close: '关闭',
      lastModified: '修改时间',
    },
    skills: {
      title: '技能',
      needToken: '请先保存网关访问令牌后再管理技能。',
      tagline: '安装与管理技能，在对话中扩展 xopc 的能力。技能保存在 ~/.xopc/skills。',
      refresh: '刷新列表',
      reloadRuntime: '从磁盘重载',
      reloadDiskAria: '从磁盘重载技能',
      skillsNavAria: '技能分区',
      tabBuiltin: '内置',
      tabUser: '用户安装',
      tabMarketplace: '技能广场',
      marketplacePlaceholder: '技能广场即将上线，敬请期待。',
      sectionBuiltinList: '内置技能',
      filterAll: '全部',
      filterGlobal: '全局',
      filterWorkspace: '工作区',
      filterExtra: '扩展',
      sectionUser: '已安装',
      installCta: '安装技能',
      installModalTitle: '安装技能',
      installModalDropHint: '拖放 .zip 或 SKILL.md 文件，或点击选择',
      installModalReqTitle: '文件要求',
      installModalReq1: '包含 SKILL.md 文件的 .zip 压缩包',
      installModalReq2: '或直接拖入 SKILL.md 文件',
      installAction: '安装',
      installClose: '关闭',
      searchPlaceholder: '搜索技能',
      noSearchResults: '没有匹配的技能。',
      uploading: '上传中…',
      loading: '加载中…',
      empty: '暂无技能。',
      loadFailed: '加载技能失败',
      reloadFailed: '重载失败',
      skillToggleFailed: '更新技能状态失败',
      uploadFailed: '上传失败',
      installSuccess: '技能已安装。',
      zipOnly: '请选择 .zip 文件',
      invalidFile: '请选择 .zip 或 SKILL.md 文件',
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
        extra: '扩展',
      },
      col: {
        name: '名称',
        description: '描述',
        source: '来源',
        managed: '可管理',
        actions: '操作',
      },
      detailModalBanner: '以下内容来自该技能的 SKILL.md 原文',
      detailModalEnable: '启用',
      detailModalDisable: '停用',
      detailLoadFailed: '无法加载 SKILL.md',
      detailCloseAria: '关闭',
      hubRemote: '远程',
      hubKindGit: 'git',
      hubKindArchive: '归档',
    },
    logs: {
      title: '日志',
      subtitle: '网关运行时的诊断与历史记录。',
      needToken: '请先保存网关访问令牌后再查看日志。',
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
      statsDetailTitle: '各级别数量',
      logDir: '目录',
      requestId: '请求 ID',
      sessionId: '会话 ID',
      presetAll: '全部',
      presetErrors: '错误',
      presetWarnPlus: '警告+',
      presetInfoPlus: '信息+',
      presetVerbose: '调试',
      presetOther: '更多',
      levelPresetAria: '按日志级别筛选',
      refreshModeAria: '日志刷新方式',
      refreshManual: '手动',
      refreshLive: '实时',
      filtersMore: '更多筛选',
      filtersDialogTitle: '更多筛选',
      filtersDialogDesc: '时间范围与自定义日志级别。',
      filtersDone: '完成',
      levelCustom: '自定义级别',
      levelCustomHint: '点选以包含或排除；全部不选表示所有级别。',
      copyMessage: '复制消息',
      copyJson: '复制 JSON',
      copied: '已复制',
      levelNames: {
        trace: '跟踪',
        debug: '调试',
        info: '信息',
        warn: '警告',
        error: '错误',
        fatal: '致命',
      },
    },
    agentSettings: {
      subtitle: '模型、工作区、采样与输出方式的默认配置。',
      sectionDesc: '修改将写入网关配置文件；部分项在下一轮对话或新会话中生效。',
      needToken: '请先保存网关访问令牌后再加载或修改智能体默认项。',
      loadError: '加载设置失败',
      save: '保存更改',
      saving: '保存中…',
      saved: '已保存',
      saveError: '保存失败',
      cardModelsTitle: '模型',
      cardModelsSubtitle: '对话、视觉与图像生成默认模型',
      cardWorkspaceTitle: '工作区与附件',
      cardWorkspaceSubtitle: '工作目录与入站媒体大小限制',
      cardBrowserTitle: '浏览器自动化',
      cardBrowserSubtitle: 'Playwright 工具（browser_navigate、快照、点击等）',
      browserEnabledOn: '启用浏览器工具',
      browserHeadlessOn: '无头模式（不显示浏览器窗口）',
      cardGenerationTitle: '采样与工具',
      cardGenerationSubtitle: '输出上限（Token）、随机性与工具调用轮数',
      cardBehaviorTitle: '推理与输出',
      cardBehaviorSubtitle: '思考深度、推理可见性与详细程度',
      label: {
        model: '模型',
        modelFallbacks: '备用模型',
        imageModel: '图像理解模型',
        imageModelFallbacks: '图像理解备用模型',
        imageGenerationModel: '图像生成模型',
        imageGenerationModelFallbacks: '图像生成备用模型',
        mediaMaxMb: '图像加载上限 (MB)',
        workspace: '工作区',
        browserEnabled: '浏览器工具',
        browserHeadless: '无头模式',
        maxTokens: '最大 Token 数',
        temperature: '温度',
        maxToolIterations: '最大工具调用轮数',
        thinkingDefault: '思考级别',
        reasoningDefault: '推理可见性',
        verboseDefault: '详细程度',
      },
      desc: {
        model: '新会话的默认模型。',
        modelFallbacks:
          '主模型在瞬时重试后仍失败时，按顺序尝试。各服务商均需配置 API Key。',
        imageModel: '可选，用于图像理解 / 视觉。',
        imageModelFallbacks:
          '当对话模型不支持视觉时，按顺序用这些视觉模型描述入站图片（也用于图像工具）。',
        imageGenerationModel: '可选，用于 image_generate（如 openai/gpt-image-1）。',
        imageGenerationModelFallbacks: '主图像生成模型失败时按顺序尝试（如配额或服务商错误）。',
        mediaMaxMb: '图像工具加载单张图片时的最大体积。',
        workspace: '智能体读写文件的工作目录。',
        browserEnabled:
          '向模型暴露 Playwright 的 browser_* 工具。请在网关所在机器执行一次：npx playwright install chromium。',
        browserHeadless:
          '关闭时会在网关机器上显示 Chromium 窗口（便于调试）；开启时在后台运行。',
        maxTokens: '模型回复的最大 Token 数。',
        temperature: '随机性（0–2）。',
        maxToolIterations: '单条用户消息内最多进行多少轮工具调用。',
        thinkingDefault: '新会话的默认思考级别。',
        reasoningDefault:
          '是否在聊天界面展示模型推理。若会话曾设置 /reasoning 等，会覆盖此默认直至清除会话配置。',
        verboseDefault:
          '智能体在日志与工具细节上的详细程度，不控制聊天中的推理/思考区块；若要隐藏推理请使用「推理可见性」。',
      },
      addModelFallback: '添加备用模型',
      removeModelFallback: '移除备用模型',
      reasoning: { off: '关闭', on: '开启', stream: '流式' },
      verbose: { off: '关闭', on: '开启', full: '完整' },
    },
    agentsSettings: {
      title: '智能体管理',
      subtitle: '管理 agents.list：工作区、默认路由与 Bootstrap 人设文件。',
      needToken: '请先保存网关访问令牌后再管理智能体。',
      loadError: '加载智能体列表失败',
      saveError: '请求失败',
      loading: '加载中…',
      tabOverview: '智能体列表',
      tabDefaults: '全局默认',
      tabFiles: 'Bootstrap 人设',
      tabTools: '工具',
      tabSkills: '技能',
      tabChannels: '通道',
      tabCron: '定时',
      selectAgent: '智能体',
      selectAgentHint: '选择要编辑的条目；人设 Markdown 位于 ~/.xopc/agents/<id>/bootstrap/。',
      agent: '智能体',
      defaultBadge: '默认',
      setDefault: '设为默认',
      editAgent: '编辑条目',
      editAgentHint: '将更新网关配置中的 agents.list；路径会展开 ~ 为用户目录。',
      displayName: '显示名称',
      workspacePath: 'Markdown 工作区',
      modelPrimary: '模型（主）',
      modelClear: '清除',
      save: '保存更改',
      removeFromConfig: '从配置移除',
      purgeDisk: '移除并删除数据',
      addAgent: '添加智能体',
      addAgentHint: '与 CLI「agents add」相同：创建目录并写入 Bootstrap 模板。',
      newName: '名称 / id 种子',
      newWorkspace: '工作区目录（必填）',
      newModelOptional: '模型（可选）',
      create: '创建智能体',
      addAgentAria: '添加智能体',
      createModalCancel: '取消',
      closeDialogAria: '关闭',
      filesHint:
        '可编辑的人设文件（SOUL、IDENTITY 等）。停笔后会自动保存；可用「预览」查看 Markdown 渲染效果。',
      filesLoading: '正在加载文件列表…',
      filesEmpty: '暂无文件。',
      pickFile: '请选择要编辑的文件。',
      saveFile: '保存文件',
      filesBootstrapEdit: '编辑',
      filesBootstrapPreview: '预览',
      filesAutoSaveHint: '停笔后自动保存。',
      filesSavingStatus: '保存中…',
      missing: '缺失',
      confirmDelete: '从配置中移除此智能体？相关路由绑定会被清除。',
      confirmDeletePurge:
        '移除此智能体并删除其工作区与 ~/.xopc/agents/<id> 数据？此操作不可恢复。',
      toolsTitle: '内置工具',
      toolsHint:
        '按智能体禁用工具（与 agents.defaults 合并）。已在默认配置中禁用的工具不能在此处单独启用。',
      toolsSave: '保存工具禁用',
      toolsClearEntry: '清除本智能体的额外禁用',
      toolsLockedByDefaults: '已在默认中禁用',
      toolDescriptions: {
        read_file: '读取工作区内的文本与小文件（路径限制在工作区沙箱内）。',
        write_file: '在工作区创建新文件或覆盖已有文件。',
        edit_file: '通过定位替换或补丁式编辑修改已有文件。',
        list_dir: '列出工作区某目录下的文件与子目录。',
        grep: '用正则搜索文件内容（类似 ripgrep）。',
        find: '按文件名或 glob 在工作区内查找文件。',
        shell: '在与工作区关联的环境中执行 shell 命令，权限高；只读或更保守的智能体可关闭。',
        web_search: '检索公开网页，获取模型训练截止之后的事实与资料。',
        web_fetch: '请求 URL 并读取页面文本供模型使用。',
        send_message: '在已连接的通道上发送出站聊天内容（如 Telegram、CLI、网关等）。',
        send_media: '通过通道发送图片或其他媒体附件。',
        memory_search: '搜索为本智能体建立的记忆与笔记索引。',
        memory_get: '按 ID 读取某条记忆或片段。',
        curated_memory: '读取或更新智能体主目录下的精选 Markdown 记忆。',
        session_search: '在已保存的会话记录与按会话摘要中搜索。',
        image: '分析或描述图片（视觉），可来自工作区或当前对话。',
        image_generate: '使用已配置的图像 / 文生图模型生成图片。',
        extensions: '启用扩展注册的工具；关闭则屏蔽所有扩展工具。',
      },
      skillsTitle: '技能白名单',
      skillsHint:
        '可选的 <available_skills> 白名单。「继承默认」仅使用 agents.defaults；「自定义」写入本智能体的 skills 数组。',
      skillsInherit: '继承默认',
      skillsCustomize: '自定义白名单',
      skillsSave: '保存技能',
      skillsCatalogLoading: '正在加载技能目录…',
      skillsEmptyCatalog: '目录中暂无技能。',
      skillsNoDescription: 'SKILL.md 元数据中暂无描述。',
      skillsDefaultsLabel: '默认白名单：',
      skillsEffectiveLabel: '生效白名单：',
      skillsAllFromCatalog: '（全部目录技能）',
      channelsTitle: '路由绑定',
      channelsHint: '指向本智能体的 config.bindings。删除规则会更新网关上的完整 bindings 数组。',
      channelsLoading: '正在加载绑定…',
      channelsNone: '没有指向该智能体的绑定。',
      channelLabel: '通道',
      peerIdLabel: '对端 ID（可选）',
      addBinding: '添加绑定',
      removeBinding: '移除',
      cronTitle: '定时任务',
      cronHint:
        '隔离会话的定时任务可指定 agentId 作为会话键。未指定 agentId 的任务使用默认智能体，并在选中该智能体时显示。',
      cronLoading: '正在加载定时任务…',
      cronNone: '没有匹配的任务。',
      cronColSchedule: '计划',
      cronColMessage: '消息',
      cronColSession: '会话',
      cronColAgent: '智能体',
      cronAgentDefault: '默认智能体',
      cronAgentClear: '恢复默认',
    },
    providersSettings: {
      subtitle: '服务商 API Key 与 OAuth。在此保存的密钥写入网关凭据存储。',
      intro:
        '可搜索或展开分组，再展开具体服务商，粘贴新密钥后点「保存更改」。支持 OAuth 时，在浏览器中完成授权。',
      docsLink: '模型与服务商文档',
      modelsLink: '自定义服务商（models.json）',
      rotateHint: '日常轮换密钥：展开对应服务商 → 粘贴新密钥 → 保存更改，一般无需重启。',
      needToken: '请先保存网关访问令牌后再管理服务商凭据。',
      loadError: '加载服务商列表失败',
      save: '保存更改',
      saving: '保存中…',
      saved: '已保存',
      noChangesSaved: '没有需要保存的新密钥。',
      saveError: '保存失败',
      empty: '暂无可用服务商。',
      searchPlaceholder: '搜索服务商…',
      unconfiguredOnly: '仅显示未配置',
      noMatches: '没有符合筛选条件的服务商。',
      clearFilters: '清除筛选',
      discard: '放弃更改',
      unsavedHint: '有未保存的更改。',
      runtimeLabelPrefix: '当前生效凭据：',
      sourceAgent: '智能体私有凭据',
      sourceGateway: '网关已保存（本页写入）',
      sourceOauth: 'OAuth 令牌',
      sourceEnv: '环境变量',
      sourceModelsJson: 'models.json',
      sourceNone: '无',
      testKey: '测试输入值',
      testingKey: '测试中…',
      testOkLiteral: '格式有效（明文或文本）。',
      testOkEnv: '环境变量可解析。',
      testOkCommand: '命令解析成功。',
      testFailed: '检查未通过。',
      revokeFailed: '撤销失败。',
      expandRowDetails: '展开凭据与操作',
      categories: {
        common: '常用服务商',
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
      maskedStoredHint: '已保存的凭据不会显示。在上方输入新 Key 可覆盖。',
      oauthHint: '可使用 OAuth 安全登录，或手动填写 API Key。',
    },
    modelsSettings: {
      needToken: '请先保存网关访问令牌后再编辑 models.json。',
      subtitle: '自定义服务商与模型（models.json）。保存后生效；重新加载可读取磁盘上的修改。',
      docsLink: '模型与服务商文档',
      loadError: '加载 models.json 失败',
      loadFileWarning: '文件提示',
      filePath: '路径',
      addProvider: '添加服务商',
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
      statsProviders: '{{count}} 个服务商',
      statsModels: '{{count}} 个模型',
      unsavedHint: '有未保存的更改。',
      loading: '加载中…',
      jsonParseError: 'JSON 无效',
      jsonReset: '从编辑器还原',
      jsonApply: '应用 JSON',
      emptyTitle: '暂无自定义服务商',
      emptyDesc: '可添加 OpenAI 兼容端点（Ollama、LM Studio、OpenRouter、vLLM 等）及可选的逐模型覆盖。',
      emptyCta: '添加第一家服务商',
      presetOllama: 'Ollama',
      presetLmStudio: 'LM Studio',
      presetOpenRouter: 'OpenRouter',
      presetZhipuCn: '智谱 GLM（国内 · Coding 端点）',
      presetZaiGeneral: '智谱 GLM（国际 · 通用 API）',
      presetLabel: '预设',
      presetCustom: '自定义',
      addProviderTitle: '添加服务商',
      addProviderSubtitle: '服务商 ID 须唯一（如 ollama、my-openai）。',
      providerIdLabel: '服务商 ID',
      providerIdPlaceholder: '例如 ollama',
      providerIdRequired: '请填写服务商 ID',
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
      removeProvider: '删除服务商',
      removeProviderConfirm: '删除服务商「{{id}}」及其模型？',
      modelsSection: '模型',
      modelsEmpty: '无自定义模型；在可用处将使用内置默认。',
      addModel: '添加模型',
      editModel: '编辑模型',
      removeModel: '删除模型',
      removeModelConfirm: '删除模型「{{id}}」？',
      addModelTitle: '添加模型',
      editModelTitle: '编辑模型',
      modelProviderLabel: '服务商',
      modelId: '模型 ID',
      displayName: '显示名称',
      inputTypes: '输入类型',
      inputTextOnly: '仅文本',
      inputTextVision: '文本 + 视觉',
      reasoning: '支持推理',
      contextWindow: '上下文窗口',
      maxOutputTokens: '最大输出 Token 数',
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
      needToken: '请先保存网关访问令牌后再编辑即时通讯设置。',
      subtitle: 'Telegram 与微信消息入站。更改将写入网关配置文件。',
      docsLink: '即时通讯文档',
      refresh: '刷新',
      loadError: '加载即时通讯设置失败',
      loading: '加载中…',
      save: '保存更改',
      saving: '保存中…',
      saved: '已保存',
      saveError: '保存失败',
      retry: '重试',
      unsavedHint: '有未保存的更改。',
      hubConfigureButton: '配置',
      hubConnectedBadge: '已连接',
      enableChannelAria: '启用或停用该通道',
      menuMoreAria: '更多操作',
      menuEditConfig: '编辑配置',
      menuRemoveConfig: '移除配置',
      removeChannelTitle: '移除配置？',
      removeChannelConfirm: '将移除 {{name}} 的网关配置并清除已保存的凭据？之后可重新配置。',
      removeChannelAction: '移除',
      modalCancel: '取消',
      telegramTitle: 'Telegram',
      telegramSubtitle: 'Bot Token、白名单及可选的多账号 JSON。',
      weixinTitle: '微信',
      weixinSubtitle: '用微信扫码登录（网页或命令行）后在此启用。凭据保存在运行网关的本机。',
      enableTelegramAria: '启用 Telegram 即时通讯',
      enableWeixinAria: '启用微信即时通讯',
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
      weixinQuickStartTitle: '最简步骤',
      weixinStepLogin:
        '在本页使用下方「微信扫码登录」，或在网关所在机器执行：xopc channels login --channel weixin（源码目录：pnpm run dev -- channels login --channel weixin）。',
      weixinStepEnable: '下方打开「启用微信」并保存。',
      weixinStepPairing: '扫码登录后即可正常收发；仅在需要限制谁可私聊时，将私聊策略改为白名单并配置允许来源。',
      weixinAdvancedHint: '可选：白名单、路由标签、流式与分账号 JSON——仅在需要时展开。',
      weixinAllowFrom: '允许来源',
      weixinAllowFromDesc: '私聊策略为白名单时使用，逗号分隔的 wxid / openid。默认配对在扫码后即可与任意联系人私聊。',
      weixinRouteTag: '路由标签',
      weixinRouteTagDesc: '可选路由标签，可为数字或字符串。',
      routeTagPlaceholder: '例如标签名或数字',
      weixinDebug: '调试模式',
      weixinDebugDesc: '为微信即时通讯输出更详细的日志。',
      weixinAccountsJson: '账号（JSON）',
      weixinAccountsJsonDesc: '分账号名称、CDN 地址、路由标签与策略。',
      weixinQrLoginTitle: '网页扫码登录',
      weixinQrLoginDesc: '在网关上发起登录，使用微信扫码；成功后本页会自动刷新配置。',
      weixinQrLoginButton: '微信扫码登录',
      weixinQrLoginBusy: '正在启动…',
      weixinQrLoginScanned: '已扫码，请在微信中确认',
      weixinQrLoginSuccess: '微信已连接。',
      weixinQrLoginCancel: '关闭二维码',
      weixinQrImageError:
        '无法在页面内生成二维码，可在新标签页打开链接完成扫码，或点击「重新生成」重试。',
      weixinQrOpenLink: '新标签页打开',
      weixinQrEncoding: '正在生成二维码…',
      weixinQrModalTitle: '扫码登录',
      weixinQrModalSubtitle: '请使用微信扫描下方二维码完成连接',
      weixinQrRegenerate: '重新生成',
      weixinQrModalCloseAria: '关闭',
      telegramCliConfigHint:
        '命令行配置（与网关使用同一配置文件；路径可用 XOPC_CONFIG 或全局 --config 覆盖）：\n• 交互向导：xopc onboard --channels\n• 或在环境中设置 TELEGRAM_BOT_TOKEN，并直接编辑 JSON 中的 channels.telegram。',
      weixinCliConfigHint:
        '在应保存凭据的机器上使用命令行（配置文件路径同上）：\n• xopc channels login --channel weixin\n• 可选：--account <id>、--timeout <ms>、--credentials-only（仅写 token 文件，不合并主配置 JSON）。',
      agentRoutingTitle: '智能体路由',
      agentRoutingHint:
        '在配置 `bindings` 中为每个即时通讯账号指定智能体；入站消息会使用对应智能体的会话键。',
      agentRoutingAccountLabel: '账号',
      agentRoutingAgentLabel: '智能体',
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
      needToken: '请先保存网关访问令牌后再编辑语音设置。',
      subtitle: '即时通讯场景的语音转写与语音合成。API Key 也可通过环境变量配置。',
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
        enableDesc: '开启后，可将语音消息转写给智能体使用。',
        provider: 'STT 服务商',
        alibaba: '阿里云 DashScope',
        openai: 'OpenAI',
        apiKey: 'API Key',
        apiKeyDesc: '若环境变量已配置密钥，此处可留空。',
        model: '模型',
        fallback: '服务商回退',
        fallbackDesc: '主服务商失败时尝试备用服务商。',
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
        provider: 'TTS 服务商',
        providerOpenai: 'OpenAI TTS',
        providerEdge: 'Microsoft Edge（免费）',
        voice: '音色',
        edgeHint: 'Microsoft Edge TTS — 无需 API Key。',
      },
      notes: {
        title: '说明',
        duration: '长音频会自动分段；效果取决于服务商与模型。',
        envVars: '环境变量：DASHSCOPE_API_KEY、OPENAI_API_KEY（未在表单填写时）。',
      },
    },
    gatewaySettings: {
      needToken: '请先保存网关访问令牌后再加载或修改网关选项。',
      subtitle: 'HTTP API 访问令牌与监听地址。配置写入网关配置文件。',
      docsLink: '网关文档',
      loadError: '加载网关设置失败',
      loading: '加载中…',
      save: '保存更改',
      saving: '保存中…',
      saved: '已保存',
      saveError: '保存失败',
      retry: '重试',
      unsavedHint: '有未保存的更改。',
      tokenExpired: '会话访问令牌无效。请在客户端更新访问令牌，或修正配置文件中的访问令牌。',
      updateToken: '更新客户端访问令牌',
      changeToken: '打开访问令牌对话框',
      accessToken: '网关访问令牌',
      tokenPlaceholder: '保存在配置中的访问令牌（若使用环境变量可留空）',
      tokenHelp: '用于 HTTP/WebSocket API 鉴权。也可通过环境变量 XOPC_GATEWAY_TOKEN 提供。',
      copy: '复制',
      copied: '已复制',
      show: '显示',
      hide: '隐藏',
      listenHost: '监听地址',
      listenPort: '端口',
      listenHint: '若在 UI 外修改监听地址，需重启网关后生效。',
      authModeNone: '当前认证模式为 none，配置文件中的令牌可能被忽略。',
    },
    heartbeatSettings: {
      needToken: '请先保存网关访问令牌后再加载或修改心跳选项。',
      subtitle:
        '定时唤醒智能体、可选投递到即时通讯，以及工作区中的 HEARTBEAT.md。配置写入网关配置文件与工作区文件。',
      docsLink: '心跳机制文档',
      loadError: '加载心跳设置失败',
      loading: '加载中…',
      saveConfig: '保存配置',
      savingConfig: '保存中…',
      savedConfig: '配置已保存',
      saveConfigError: '保存配置失败',
      triggerNow: '立即触发',
      triggering: '排队中…',
      triggered: '已加入心跳队列',
      triggerError: '触发心跳失败',
      triggerHint:
        '与定时器相同的一次心跳（会受 HEARTBEAT.md、活跃时段与是否启用心跳影响）。',
      saveDoc: '保存 HEARTBEAT.md',
      savingDoc: '保存中…',
      savedDoc: '文档已保存',
      saveDocError: '保存 HEARTBEAT.md 失败',
      retry: '重试',
      unsavedConfig: '有未保存的配置更改。',
      unsavedDoc: 'HEARTBEAT.md 有未保存的更改。',
      workspaceLabel: '工作区',
      configSection: '心跳配置',
      docSection: 'HEARTBEAT.md',
      docHint:
        '每次心跳时智能体会读取的任务与提醒。若留空或仅有注释，将跳过 LLM 调用以节省用量。',
      enable: '启用心跳',
      interval: '间隔',
      intervalHint: '最短 1 秒；保存到网关配置时为毫秒。',
      intervalHintPreset: '快速选择，或在左侧输入秒数。',
      intervalSecondsLabel: '秒',
      intervalPresets: {
        custom: '自定义',
        every30s: '每 30 秒',
        every1min: '每 1 分钟',
        every5min: '每 5 分钟',
        every10min: '每 10 分钟',
        every15min: '每 15 分钟',
        every30min: '每 30 分钟',
        every1h: '每 1 小时',
        every2h: '每 2 小时',
      },
      deliveryTitle: '投递（可选）',
      channelNone: '— 无 —',
      customChannelSuffix: '自定义',
      deliveryHint: '需同时填写即时通讯与会话 ID 才会发送非静默回复；否则仅记录日志。',
      prompt: '自定义系统提示（可选）',
      promptPlaceholder: '覆盖默认心跳指令…',
      promptHint: '留空则使用内置默认提示。',
      ackMaxChars: '视为静默前的最大回复长度（ackMaxChars）',
      ackMaxCharsHint: '留空则使用服务端默认值（300）。',
      ackDefaultPlaceholder: '默认',
      isolatedSession: '每次使用新的会话键',
      isolatedSessionHint: '避免与主对话会话混淆上下文。',
      activeHoursTitle: '活跃时段（可选）',
      activeStart: '开始',
      activeEnd: '结束',
      activeTimezone: '时区（IANA）',
      activeHoursHint: '仅在该时间窗口内运行心跳。清除则不限时段。',
      addActiveHours: '添加活跃时段',
      clearActiveHours: '清除活跃时段',
    },
    webSearchSettings: {
      title: '网络搜索',
      subtitle:
        '为 web_search 工具配置地区与搜索提供方。未配置 API 时将使用内置 HTML 兜底。',
      docsLink: '网关文档',
      needToken: '请先保存网关访问令牌后再编辑网络搜索。',
      loading: '加载中…',
      loadError: '加载网络搜索设置失败',
      save: '保存',
      saving: '保存中…',
      saved: '已保存',
      saveError: '保存失败',
      unsavedHint: '有未保存的更改。',
      sectionRegion: '地区',
      sectionRegionHint:
        '在无可用 API 时，用于选择内置 HTML 兜底（国内优先必应，否则 DuckDuckGo）。',
      sectionSearch: '搜索提供方',
      sectionSearchHint:
        '按列表顺序依次尝试。密钥写在网关配置文件中。列表为空则仅使用 HTML 兜底。',
      regionLabel: '兜底地区',
      regionDesc: '自动根据系统时区判断。若使用代理或需固定策略，可手动覆盖。',
      regionAuto: '自动（时区）',
      regionCn: '中国（必应 HTML 兜底）',
      regionGlobal: '全球（DuckDuckGo HTML 兜底）',
      maxResultsLabel: '默认结果条数',
      maxResultsDesc: '模型未指定 count 时使用（1–50）。',
      providersTitle: '提供方（按顺序）',
      addProvider: '添加提供方',
      apiKeyLabel: 'API 密钥',
      apiKeyDesc: '部分场景可选。留空且显示为已掩码时保留原值。',
      urlLabel: '实例地址',
      urlDesc: 'SearXNG 根地址（如 http://localhost:8080），无需末尾斜杠。',
      keyPlaceholder: '密钥或环境变量名',
      keyPlaceholderMasked: '••••••••（未修改）',
      disabled: '跳过',
      footerHint:
        'HTML 兜底依赖第三方页面，可能随站点改版变化。生产环境建议使用正式搜索 API（Brave、Tavily、必应或自建 SearXNG）。',
      providerTypes: {
        brave: 'Brave Search API',
        tavily: 'Tavily',
        bing: 'Bing Web Search API',
        searxng: 'SearXNG',
      },
    },
    appearanceSettings: {
      pageTitle: '偏好设置',
      subtitle: '语言、界面外观与对话字号等日常使用的显示行为，仅保存在本浏览器。',
      languageTitle: '语言',
      languageDescription: '选择界面语言。',
      themeTitle: '主题亮暗',
      themeDescription: '浅色、深色，或跟随系统。',
      colorSchemeTitle: '配色方案',
      colorSchemeDescription: '界面的视觉风格。',
      colorSchemeDefault: '默认',
      colorSchemeLightGreen: '浅绿',
      fontScaleTitle: '对话字号',
      fontScaleDescription: '调整对话与阅读区域的文字大小。',
      fontScaleCompact: '小',
      fontScaleDefault: '中',
      fontScaleLarge: '大',
      langOptionEn: 'English',
      langOptionZh: '中文',
      themeOptionLight: '浅色',
      themeOptionDark: '深色',
      themeOptionSystem: '跟随系统',
      openFullPreferences: '打开全部设置',
      quickMenuHint: '语言、主题与字号',
    },
  },
};

export type ProvidersSettingsMessages = (typeof bundles)['en']['providersSettings'];
export type ModelsSettingsMessages = (typeof bundles)['en']['modelsSettings'];
export type ChannelsSettingsMessages = (typeof bundles)['en']['channelsSettings'];
export type VoiceSettingsMessages = (typeof bundles)['en']['voiceSettings'];
export type GatewaySettingsMessages = (typeof bundles)['en']['gatewaySettings'];
export type HeartbeatSettingsMessages = (typeof bundles)['en']['heartbeatSettings'];
export type WebSearchSettingsMessages = (typeof bundles)['en']['webSearchSettings'];
export type AgentsSettingsMessages = (typeof bundles)['en']['agentsSettings'];
export type ChatMessages = (typeof bundles)['en']['chat'];

export function messages(lang: StoredLanguage) {
  return bundles[lang];
}

export function tabLabel(lang: StoredLanguage, tab: Tab): string {
  const m = messages(lang);
  return m.nav[tab];
}
