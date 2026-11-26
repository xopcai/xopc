// swiftlint:disable file_length
import AVFoundation
import SwiftUI
import UIKit

// swiftlint:disable:next type_body_length
struct AppRootView: View {
    @Environment(\.scenePhase) private var scenePhase
    @Environment(\.colorScheme) private var colorScheme
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var appState = AppState()
    @State private var push = MobilePush.shared
    @State private var realtimeVoiceCall = RealtimeVoiceCall()
    @State private var projectChat = ProjectChatPresentation()
    @State private var personalAgent = PersonalAgentState()
    @State private var personalReadTarget: PersonalReadTarget?
    @State private var personalWorking = false
    @State private var hasPendingRecording = false
    @State private var settingsPresented = false
    @State private var sidebarOpen = false
    @State private var composerFocused = false
    @State private var keyboardVisible = false
    @State private var phoneVisible = false
    @State private var actionPanelVisible = false
    @State private var recentConversations: [ConversationSummary]?
    @State private var recentNextOffset: Int?
    @State private var recentScope: String?
    @State private var recentError = false
    @State private var recentLoading = false
    @State private var recentRevision = 0
    @State private var recentUpdatedAt: Date?
    @State private var recentDeleteFailures: Set<String> = []
    @State private var homeRetry = 0
    @State private var pendingAttention = 0
    @State private var defaultAgentID = "main"
    @State private var sidebarAgents: [String: AgentSummary] = [:]
    @State private var messageLinks = ChatMessageLinkRouter()
    @State private var music = GeneratedMusicPlayback.shared
    @State private var musicSourceToOpen: GeneratedMusicTrack?
    @AppStorage("app.language") private var language = AppLanguage.system.rawValue
    @AppStorage("app.appearance") private var appearance = AppAppearance.system.rawValue
    @AppStorage("app.colorPreset") private var colorPreset = MobileThemePreset.default.rawValue

    private var mobileTheme: MobileTheme {
        let mode = (AppAppearance(rawValue: appearance) ?? .system).colorScheme ?? colorScheme
        return MobileTheme(preset: MobileThemePreset(rawValue: colorPreset) ?? .default, dark: mode == .dark)
    }

    var body: some View {
        Group {
            if appState.gatewayConfiguration.token.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                GatewayProfileEditor(
                    onPair: appState.pairGateway,
                    canCancel: false,
                    onManage: appState.gatewayProfiles.isEmpty ? nil : { settingsPresented = true }
                )
            } else {
                homeShell
            }
        }
        .modifier(ExternalIntakeModifier(appState: appState))
        .mobileTextStyle(.body)
        .environment(\.openURL, OpenURLAction { url in
            if let target = ChatMessageLink.resolve(url.absoluteString) {
                if settingsPresented {
                    settingsPresented = false
                }
                messageLinks.open(target, appState: appState)
                return .handled
            }
            if url.absoluteString == UIApplication.openSettingsURLString || ChatMessageLink.externalURL(url) {
                return .systemAction(url)
            }
            return .discarded
        })
        .environment(\.locale, (AppLanguage(rawValue: language) ?? .system).locale)
        .preferredColorScheme((AppAppearance(rawValue: appearance) ?? .system).colorScheme)
        .sheet(isPresented: $music.expanded, onDismiss: openMusicSource) {
            GeneratedMusicPlayer(playback: music) { track in
                musicSourceToOpen = track
                music.expanded = false
            }
            .mobileSheetPreset(.large)
        }
        .onChange(of: appState.gatewayConfiguration) { music.validateScope(appState.gatewayConfiguration) }
        .modifier(VoiceCallPresentation(call: realtimeVoiceCall, active: !linkedProjectChat))
        .sheet(isPresented: $settingsPresented) {
            GatewayProfilesView(
                profiles: appState.gatewayProfiles,
                activeProfileID: appState.activeGatewayProfileID,
                storageError: appState.connectionStorageError,
                onPair: appState.pairGateway,
                onRefresh: appState.refreshGatewayProfile,
                onActivate: appState.activateGatewayProfile,
                onRename: appState.renameGatewayProfile,
                onRemove: appState.removeGatewayProfile
            )
            .mobileSheetPreset(.large)
        }
        .sheet(item: Binding(get: {
            if case .route("tasks", _) = messageLinks.destination {
                return nil
            }
            return messageLinks.destination
        }, set: { messageLinks.destination = $0 })) { link in
            ChatMessageLinkDestination(link: link, appState: appState, router: messageLinks, defaultAgentID: defaultAgentID)
                .mobileSheetPreset(.large)
                .modifier(ChatSidebarPresentation(isOpen: linkedProjectChat && projectChat.sidebarOpen,
                                                  canOpenBySwipe: false, onSetOpen: setSidebar) { sidebar })
                .modifier(VoiceCallPresentation(call: realtimeVoiceCall, active: linkedProjectChat))
        }
        .fullScreenCover(item: Binding(get: {
            if case .route("tasks", _) = messageLinks.destination {
                return messageLinks.destination
            }
            return nil
        }, set: { messageLinks.destination = $0 })) { link in
            ChatMessageLinkDestination(link: link, appState: appState, router: messageLinks, defaultAgentID: defaultAgentID)
        }
        .alert("无法打开链接", isPresented: Binding(get: { messageLinks.errorMessage != nil }, set: {
            if !$0 {
                messageLinks.errorMessage = nil
            }
        })) {
            Button("关闭", role: .cancel) { messageLinks.errorMessage = nil }
        } message: { Text(messageLinks.errorMessage ?? "") }
        // State initializers also run for discarded view values; refresh only the mounted view.
        .task { await appState.refreshGatewayOnForeground() }
        .task(id: appState.activeGatewayProfileID) {
            await push.restore(appState.gatewayConfiguration)
        }
        .task(id: push.token) {
            await push.sync(appState.gatewayConfiguration)
        }
        .task(id: push.pending.first) {
            while let route = push.pending.first, !Task.isCancelled {
                await openMobilePush(route)
                if push.pending.first == route {
                    try? await Task.sleep(for: .seconds(5))
                }
            }
        }
        .onChange(of: scenePhase) {
            Task {
                await DeviceEndpointPool.shared.notifyAppLifecycle(
                    active: scenePhase == .active,
                    background: scenePhase == .background
                )
            }
            if scenePhase == .active {
                Task {
                    await appState.refreshGatewayOnForeground()
                    await push.restore(appState.gatewayConfiguration)
                }
                Task { await realtimeVoiceCall.resumeAfterInterruption() }
            } else if scenePhase == .background {
                music.checkpoint()
            }
        }
        .onReceive(NotificationCenter.default.publisher(for: UIResponder.keyboardWillShowNotification)) { _ in
            keyboardVisible = true
        }
        .onReceive(NotificationCenter.default.publisher(for: UIResponder.keyboardWillHideNotification)) { _ in
            keyboardVisible = false
        }
        .onReceive(NotificationCenter.default.publisher(for: AVAudioSession.routeChangeNotification)) { notification in
            if notification.userInfo?[AVAudioSessionRouteChangeReasonKey] as? UInt ==
                AVAudioSession.RouteChangeReason.oldDeviceUnavailable.rawValue
            {
                music.pause()
            }
        }
        .onReceive(NotificationCenter.default.publisher(for: AVAudioSession.interruptionNotification)) { notification in
            guard let raw = notification.userInfo?[AVAudioSessionInterruptionTypeKey] as? UInt else { return }
            if raw == AVAudioSession.InterruptionType.began.rawValue {
                music.pause()
            }
            if raw == AVAudioSession.InterruptionType.ended.rawValue {
                Task { await realtimeVoiceCall.resumeAfterInterruption() }
            }
        }
        .environment(\.mobileTheme, mobileTheme)
        .environment(projectChat)
        .environment(realtimeVoiceCall)
        .tint(mobileTheme.action)
        .foregroundStyle(mobileTheme.foreground)
    }

    private func openMusicSource() {
        guard let track = musicSourceToOpen else { return }
        musicSourceToOpen = nil
        let configuration = appState.gatewayConfiguration
        guard track.configurationScope == ComposerDraftStore.accountScope(configuration) else { return }
        if let record = personalAgent.record(using: configuration), record.conversationId == track.conversationID {
            appState.openPersonalAgent(record)
        } else if appState.activeSessionConversation?.id != track.conversationID {
            appState.openConversation(id: track.conversationID, title: track.source, agentId: track.sourceAgentID ?? defaultAgentID)
        }
    }

    private var fullScreenOverlayActive: Bool {
        settingsPresented
            || messageLinks.destination != nil
            || music.expanded
            || (realtimeVoiceCall.phase != .idle && realtimeVoiceCall.expanded)
    }

    private var showBottomTabBar: Bool {
        appState.activeStack.isEmpty
            && !composerFocused
            && !keyboardVisible
            && !phoneVisible
            && !actionPanelVisible
            && !fullScreenOverlayActive
            && projectChat.conversationID == nil
    }

    private var showsShellMusicDock: Bool {
        guard projectChat.conversationID == nil else { return false }
        let showingInlineChatDock = !phoneVisible && (appState.isShowingAdaRoot || appState.activeSessionRoute != nil)
        return !showingInlineChatDock
    }

    private var homeShell: some View {
        ZStack {
            tabStack(for: .ada) { adaRootContainer }
            tabStack(for: .workbench) { workbenchRoot }
            tabStack(for: .notes) { notesRoot }
            tabStack(for: .library) { libraryRoot }
        }
        .safeAreaInset(edge: .bottom, spacing: 0) {
            VStack(spacing: 0) {
                if showsShellMusicDock {
                    GeneratedMusicDock(playback: music)
                }
                if showBottomTabBar {
                    FloatingTabBar(
                        configuration: appState.gatewayConfiguration,
                        selectedTab: appState.selectedTab,
                        personalAgent: personalAgent.record(using: appState.gatewayConfiguration),
                        personalUnread: personalAgent.unread(using: appState.gatewayConfiguration)?.unreadCount ?? 0,
                        personalWorking: personalWorking,
                        pendingAttention: pendingAttention,
                        hasPendingRecording: hasPendingRecording,
                        onSelect: { tab in
                            appState.switchTab(tab)
                        }
                    )
                }
            }
        }
        .modifier(ChatSidebarPresentation(isOpen: sidebarPresented && !linkedProjectChat, canOpenBySwipe: canDragSidebar,
                                          onSetOpen: setSidebar) { sidebar })
        .background(mobileTheme.canvas.ignoresSafeArea())
        .task(id: personalUnreadLoad) {
            let load = personalUnreadLoad
            guard load.foreground else { return }
            while !Task.isCancelled {
                await personalAgent.refreshUnread(using: load.configuration, viewed: load.viewed)
                do { try await Task.sleep(for: .seconds(30)) } catch { return }
            }
        }
        .task(id: SidebarAttentionLoad(configuration: appState.gatewayConfiguration, language: language)) {
            let configuration = appState.gatewayConfiguration
            while !Task.isCancelled {
                await loadAttention(using: configuration)
                do { try await Task.sleep(for: .seconds(30)) } catch { return }
            }
        }
        .task(id: PendingRecordingLoad(configuration: appState.gatewayConfiguration, active: scenePhase == .active)) {
            guard scenePhase == .active else { return }
            let configuration = appState.gatewayConfiguration
            let pending = try? await PendingVoiceNoteStore(gatewayURL: configuration.baseURL).load()
            guard !Task.isCancelled, configuration == appState.gatewayConfiguration else { return }
            hasPendingRecording = pending != nil
        }
        .task(id: appState.gatewayConfiguration) {
            await loadSidebarAgents(using: appState.gatewayConfiguration)
        }
        .task(id: HomeChatLoad(configuration: appState.gatewayConfiguration,
                               needsSelection: appState.personalConversation == nil, retry: homeRetry))
        {
            let configuration = appState.gatewayConfiguration
            await personalAgent.refresh(using: configuration)
            guard !Task.isCancelled, configuration == appState.gatewayConfiguration else { return }
            if let record = personalAgent.record(using: configuration), record.isReady {
                appState.syncPersonalAgent(record)
                return
            }
            guard personalAgent.errorMessage == nil else { return }
            await openPersonalAgent(navigateToAda: false)
        }
        .task(id: SidebarLoad(configuration: appState.gatewayConfiguration, revision: recentRevision)) {
            await loadRecent(using: appState.gatewayConfiguration)
        }
        .task(id: sidebarPresented) {
            guard sidebarPresented else { return }
            do { try await Task.sleep(for: .milliseconds(250)) } catch { return }
            let recentsAreStale = recentUpdatedAt.map { Date.now.timeIntervalSince($0) > 30 } ?? true
            if !recentLoading, recentsAreStale {
                recentRevision += 1
            }
            let configuration = appState.gatewayConfiguration
            async let agents: Void = loadSidebarAgents(using: configuration)
            await loadAttention(using: configuration)
            await agents
        }
        .onChange(of: ComposerDraftStore.accountScope(appState.gatewayConfiguration)) {
            setSidebar(false)
            recentUpdatedAt = nil
            recentConversations = nil
            recentDeleteFailures = []
            recentNextOffset = nil
            recentScope = nil
            recentError = false
            pendingAttention = 0
            personalWorking = false
            hasPendingRecording = false
            personalReadTarget = nil
            defaultAgentID = "main"
            sidebarAgents = [:]
        }
        .onChange(of: appState.sessionPromotionRevision) {
            recentUpdatedAt = nil
            recentRevision += 1
        }
        .onChange(of: appState.listCacheRevision) {
            recentUpdatedAt = nil
            recentConversations = nil
            recentNextOffset = nil
            recentScope = nil
            recentError = false
            recentRevision += 1
        }
    }

    @ViewBuilder
    private func tabStack(for tab: MobileTab, @ViewBuilder root: () -> some View) -> some View {
        let isSelected = appState.selectedTab == tab
        NavigationStack(path: appState.pathBinding(for: tab)) {
            root()
                .navigationDestination(for: HomeDestination.self) { route in
                    destination(route, in: tab)
                }
        }
        .opacity(isSelected ? 1 : 0)
        .allowsHitTesting(isSelected)
        .accessibilityHidden(!isSelected)
        .zIndex(isSelected ? 1 : 0)
    }

    @ViewBuilder private var adaRootContainer: some View {
        if #available(iOS 18, *) {
            adaRootScreen
                .toolbar(.hidden, for: .navigationBar)
                .containerBackground(mobileTheme.canvas, for: .navigation)
        } else {
            adaRootScreen
                .toolbar(.hidden, for: .navigationBar)
        }
    }

    private var adaRootScreen: some View {
        let configuration = appState.gatewayConfiguration
        let isAdaRootActive = appState.isShowingAdaRoot
        return AssistantView(
            configuration: configuration,
            isActive: isAdaRootActive,
            realtimeVoiceCall: realtimeVoiceCall,
            conversation: appState.personalConversation,
            personalAgent: personalAgent.record(using: configuration),
            onStartConversation: appState.startConversation,
            onStartScopedConversation: appState.startScopedConversation,
            onConversationUpdated: appState.updatePersonalConversation,
            onOpenSettings: { settingsPresented = true },
            onInputFocusChanged: { focused in
                if isAdaRootActive || !focused {
                    composerFocused = focused
                }
            },
            bottomComposerSpacing: showBottomTabBar ? 11 : 4,
            scrollToLatestToken: appState.retapRevision(for: .ada),
            onRunningStateChanged: { personalWorking = $0 },
            onOpenSidebar: { setSidebar(true) },
            onOpenProgress: { appState.switchTab(.workbench) },
            onOpenPersonalOverview: { appState.push(.personalOverview(allowsConversationSharing: $0), in: .ada) },
            onConversationUnavailable: { _ in },
            onPersonalReadTargetChanged: { personalReadTarget = $0 },
            personalUnread: personalUnreadLoad.viewed == nil ? nil : personalAgent.unread(using: configuration),
            pendingAttention: pendingAttention,
            sidebarOpen: sidebarOpen,
            homeChatError: personalAgent.errorMessage,
            onRetryHomeChat: { homeRetry += 1 },
            onPhoneVisibilityChanged: { phoneVisible = $0 },
            onActionPanelVisibilityChanged: { shown in
                if isAdaRootActive || !shown {
                    actionPanelVisible = shown
                }
            },
            externalIntake: appState.externalIntake,
            onExternalIntakeFinished: appState.externalIntakeFinished
        ) { composer in composer }
    }

    private var workbenchRoot: some View {
        let configuration = appState.gatewayConfiguration
        return WorkPagesView(
            configuration: configuration,
            initialPage: .progress,
            isTabActive: appState.selectedTab == .workbench && appState.path(for: .workbench).isEmpty,
            retapToken: appState.retapRevision(for: .workbench),
            onOpenSidebar: { setSidebar(true) },
            onNavigate: { route in appState.push(route, in: .workbench) },
            onOpenConversation: appState.openConversation
        ) {
            appState.switchTab(.library)
        }
    }

    private var notesRoot: some View {
        NotesView(
            configuration: appState.gatewayConfiguration,
            onOpenConversation: appState.openConversation,
            onOpenSidebar: { setSidebar(true) },
            retapToken: appState.retapRevision(for: .notes),
            onPendingVoiceNoteChanged: { hasPendingRecording = $0 }
        )
    }

    private var libraryRoot: some View {
        let configuration = appState.gatewayConfiguration
        return SpaceLibraryView(
            configuration: configuration,
            onOpenSource: { source in
                if source.kind == "task", let taskID = source.taskId {
                    appState.openTaskChat(taskID: taskID, in: .library)
                } else if source.kind == "automation", let runID = source.automationRunId {
                    appState.push(.libraryAutomationRun(runID), in: .library)
                } else {
                    appState.openConversation(id: source.conversationId, title: source.label ?? "", agentId: defaultAgentID)
                }
            },
            onUseInChat: { attachment, origin in
                try await appState.startLibraryConversation(
                    configuration: configuration,
                    agentID: defaultAgentID,
                    attachment: attachment,
                    origin: origin
                )
            },
            onOpenSidebar: { setSidebar(true) },
            retapToken: appState.retapRevision(for: .library)
        )
    }

    private var personalUnreadLoad: PersonalUnreadLoad {
        let canRead = appState.isShowingAdaRoot && !sidebarOpen && !settingsPresented && !phoneVisible &&
            messageLinks.destination == nil && (realtimeVoiceCall.phase == .idle || !realtimeVoiceCall.expanded) && !music.expanded &&
            personalReadTarget?.conversationID == appState.personalConversation?.id
        return PersonalUnreadLoad(configuration: appState.gatewayConfiguration, foreground: scenePhase == .active,
                                  sidebarOpen: sidebarOpen, viewed: canRead ? personalReadTarget : nil)
    }

    private var recentOrdinaryConversations: [ConversationSummary] {
        let currentScope = ComposerDraftStore.accountScope(appState.gatewayConfiguration)
        guard recentScope == currentScope, let recents = recentConversations else { return [] }
        let personalID = personalAgent.record(using: appState.gatewayConfiguration)?.conversationId
        return recents.filter { $0.id != personalID && $0.isRecentSidebarCandidate }
            .sorted {
                ($0.status == "pinned") == ($1.status == "pinned")
                    ? $0.updatedAt > $1.updatedAt : $0.status == "pinned"
            }
    }

    // swiftlint:disable:next cyclomatic_complexity function_body_length
    @ViewBuilder private func destination(_ route: HomeDestination, in tab: MobileTab) -> some View {
        let configuration = appState.gatewayConfiguration
        switch route {
        case let .sessionChat(sessionRoute):
            sessionChatScreen(route: sessionRoute, in: tab)
        case .conversations, .conversationSearch:
            ConversationsView(
                configuration: configuration,
                onSelect: { conversation in
                    appState.openFromSearch(ConversationSelection(summary: conversation))
                },
                onStartNew: startNew,
                personalConversationID: personalAgent.record(using: configuration)?.conversationId,
                onOpenSettings: { settingsPresented = true },
                startSearching: route == .conversationSearch,
                onDelete: appState.conversationUnavailable
            )
        case .progress:
            WorkPagesView(
                configuration: configuration,
                initialPage: .progress,
                isTabActive: appState.selectedTab == tab && appState.path(for: tab).last == .progress,
                onNavigate: { appState.push($0, in: tab) },
                onOpenConversation: appState.openConversation
            ) {
                appState.switchTab(.library)
            }
        case .projects:
            WorkPagesView(
                configuration: configuration,
                initialPage: .projects,
                isTabActive: appState.selectedTab == tab && appState.path(for: tab).last == .projects,
                onNavigate: { appState.push($0, in: tab) },
                onOpenConversation: appState.openConversation
            ) {
                appState.switchTab(.library)
            }
        case .automations:
            AutomationsView(configuration: configuration, onOpenConversation: appState.openConversation)
        case .notes:
            NotesView(configuration: configuration, onOpenConversation: appState.openConversation)
        case .library:
            SpaceLibraryView(configuration: configuration, onOpenSource: { source in
                if source.kind == "task", let taskID = source.taskId {
                    appState.openTaskChat(taskID: taskID, in: tab)
                } else if source.kind == "automation", let runID = source.automationRunId {
                    appState.push(.libraryAutomationRun(runID), in: tab)
                } else {
                    appState.openConversation(id: source.conversationId, title: source.label ?? "", agentId: defaultAgentID)
                }
            }, onUseInChat: { attachment, origin in
                try await appState.startLibraryConversation(configuration: configuration, agentID: defaultAgentID,
                                                            attachment: attachment, origin: origin)
            })
        case let .taskDetail(taskID), let .notificationTask(taskID):
            TaskConversationView(configuration: configuration, taskID: taskID, opensDetails: true) { nextTaskID in
                appState.openTaskChat(taskID: nextTaskID, in: tab)
            }
        case let .taskChat(taskID), let .libraryTask(taskID):
            TaskConversationView(configuration: configuration, taskID: taskID) { nextTaskID in
                appState.openTaskChat(taskID: nextTaskID, in: tab)
            }
        case let .projectDetail(projectID):
            ProjectDetailView(configuration: configuration, projectID: projectID, onOpenConversation: appState.openConversation)
        case let .automationDetail(automationID):
            AutomationDetailView(configuration: configuration, automationID: automationID, onOpenConversation: appState.openConversation)
        case let .noteDetail(noteID):
            NoteDetailView(configuration: configuration, noteID: noteID, onOpenConversation: appState.openConversation)
        case .files:
            FilesView(configuration: configuration)
        case let .libraryAutomationRun(runID):
            AutomationRunDetailView(configuration: configuration, runID: runID,
                                    initialRun: nil, onOpenConversation: appState.openConversation)
        case .aboutYou:
            UserUnderstandingView(configuration: configuration)
        case .personalGoals:
            PersonalGoalsView(configuration: configuration)
        case .capabilities:
            CapabilitiesView(configuration: configuration, personal: personalAgent.record(using: configuration),
                             onOpenAgent: { id, personal in
                                 if personal {
                                     Task { await openPersonalAgent(navigateToAda: true) }
                                 } else {
                                     appState.startConversation(agentId: id)
                                 }
                             },
                             onSetupChat: { prompt, language in
                                 appState.startCapabilityChat(agentId: defaultAgentID, prompt: prompt,
                                                              agentSetupLanguage: language)
                             },
                             onPersonalChanged: { Task { await personalAgent.refresh(using: configuration) } },
                             onOpenDeviceChat: { id, agentID in
                                 guard configuration == appState.gatewayConfiguration else { return }
                                 appState.openConversation(id: id, title: "", agentId: agentID)
                             },
                             onShareDeviceFile: { attachment in
                                 try await appState.startLibraryConversation(configuration: configuration, agentID: defaultAgentID,
                                                                             attachment: attachment, origin: nil)
                             },
                             onPairDevice: { settingsPresented = true })
        case let .personalOverview(allowsConversationSharing):
            if let agent = personalAgent.record(using: configuration),
               let conversation = appState.personalConversation, conversation.id == agent.conversationId
            {
                PersonalAgentOverview(configuration: configuration, agent: agent, conversation: conversation,
                                      attention: pendingAttention,
                                      allowsConversationSharing: allowsConversationSharing,
                                      onEdit: { updated in
                                          personalAgent.applyProfile(updated, using: configuration)
                                          appState.syncPersonalAgent(updated)
                                      },
                                      onModelSaved: appState.updatePersonalConversation,
                                      onOpenConversation: appState.openConversation)
            }
        case let .settingsSection(section):
            SettingsSectionView(configuration: configuration, section: section)
        case .settings:
            AppSettingsView(configuration: configuration,
                            gatewayName: appState.gatewayProfiles.first { $0.id == appState.activeGatewayProfileID }?.name ?? "Gateway",
                            onOpenGatewaySettings: { settingsPresented = true },
                            personalAgent: personalAgent.record(using: configuration),
                            personalAgentBusy: personalAgent.isLoading || personalAgent.isOpening,
                            personalAgentError: personalAgent.errorMessage,
                            onOpenPersonalAgent: { Task { await openPersonalAgent(navigateToAda: true) } },
                            onPersonalAgentSaved: { updated in
                                personalAgent.applyProfile(updated, using: configuration)
                                appState.syncPersonalAgent(updated)
                            })
        }
    }

    private func sessionChatScreen(route: SessionChatRoute, in tab: MobileTab) -> some View {
        let configuration = appState.gatewayConfiguration
        let conversation = appState.sessionConversation(for: route)
        let isTopOfActiveTab = appState.selectedTab == tab && appState.path(for: tab).last == .sessionChat(route)
        return AssistantView(
            configuration: configuration,
            isActive: isTopOfActiveTab,
            realtimeVoiceCall: realtimeVoiceCall,
            conversation: conversation,
            personalAgent: nil,
            onStartConversation: { agentID in
                appState.replaceTopSessionChat(.draft(agentId: agentID), in: tab)
            },
            onStartScopedConversation: { project, mode, agentID in
                let draft: ConversationSelection = project.map {
                    .projectDraft(project: $0, executionMode: mode, agentId: agentID)
                } ?? .draft(agentId: agentID)
                appState.replaceTopSessionChat(draft, in: tab)
            },
            onConversationUpdated: { updated in
                let sourceID = conversation?.id ?? updated.id
                appState.promoteSessionDraftInPlace(draftID: sourceID, to: updated)
                appState.updateSessionConversation(updated, for: route)
            },
            onOpenSettings: { settingsPresented = true },
            onInputFocusChanged: { _ in },
            bottomComposerSpacing: 4,
            backAccessibilityID: "session-chat-back",
            showsSessionConversationTitle: true,
            recentSwitchConversations: recentOrdinaryConversations,
            onSwitchConversation: { item in
                appState.replaceTopSessionChat(ConversationSelection(summary: item), in: tab)
            },
            onCreateNewConversation: {
                appState.replaceTopSessionChat(.draft(agentId: defaultAgentID), in: tab)
            },
            onOpenConversationList: { setSidebar(true) },
            onBack: { appState.pop(in: tab) },
            onConversationUnavailable: { id in
                guard configuration == appState.gatewayConfiguration else { return }
                appState.conversationUnavailable(id)
            },
            sidebarOpen: sidebarOpen,
            onPhoneVisibilityChanged: { phoneVisible = $0 },
            externalIntake: appState.externalIntake,
            onExternalIntakeFinished: appState.externalIntakeFinished
        ) { composer in composer }
            .toolbar(.hidden, for: .navigationBar)
    }

    private var sidebar: some View {
        let configuration = appState.gatewayConfiguration
        let currentScope = ComposerDraftStore.accountScope(configuration)
        let recents = recentScope == currentScope ? recentConversations : nil
        let selectedID = projectChat.conversationID ?? appState.activeSessionConversation?.id
        return ChatSidebarView(configuration: configuration,
                               personalConversationID: personalAgent.record(using: configuration)?.conversationId,
                               selectedID: selectedID,
                               recent: recents ?? [], agents: sidebarAgents, recentNextOffset: recents == nil ? nil : recentNextOffset,
                               recentLoading: recentLoading || (recents == nil && !recentError), recentError: recentError,
                               isPresented: sidebarPresented, onClose: { setSidebar(false) },
                               onNavigate: { route in leaveLinkedProject(); navigateFromSidebar(route) },
                               onConversation: { conversation in
                                   if projectChat.conversationID == conversation.id {
                                       setSidebar(false)
                                   } else {
                                       leaveLinkedProject()
                                       selectConversation(conversation)
                                   }
                               }, onNew: { leaveLinkedProject(); startNew() }, onRetry: { recentRevision += 1 },
                               onLoadMore: { Task { await loadRecent(using: configuration, more: true) } },
                               onRename: { item, name in
                                   try await changeSidebarConversation(item, name: name, using: configuration)
                               }, onPin: { item in
                                   try await changeSidebarConversation(item, using: configuration)
                               }, onDelete: { ids in
                                   await deleteSidebarConversations(ids, using: configuration)
                               })
                               .id(currentScope)
    }

    private func changeSidebarConversation(_ item: ConversationSummary, name: String? = nil,
                                           using configuration: GatewayConfiguration) async throws
    {
        let scope = ComposerDraftStore.accountScope(configuration)
        guard scope == ComposerDraftStore.accountScope(appState.gatewayConfiguration) else { throw CancellationError() }
        let gateway = GatewayClient(configuration: configuration)
        if let name {
            try await gateway.renameConversation(id: item.id, name: name)
        } else {
            try await gateway.mutateConversation(id: item.id, action: item.status == "pinned" ? .unpin : .pin)
        }
        guard scope == ComposerDraftStore.accountScope(appState.gatewayConfiguration) else { return }
        recentConversations = recentConversations?.map { row in
            guard row.id == item.id else { return row }
            var updated = row
            if let name {
                updated.name = name
            } else {
                updated.status = item.status == "pinned" ? "active" : "pinned"
            }
            return updated
        }
        if let name {
            appState.updateSessionConversationTitle(id: item.id, title: name)
        }
        await persistSidebarMutation(scope: scope)
    }

    private func deleteSidebarConversations(_ ids: [String], using configuration: GatewayConfiguration) async -> Set<String> {
        let scope = ComposerDraftStore.accountScope(configuration)
        let gateway = GatewayClient(configuration: configuration)
        var failed = Set(ids)
        for id in ids {
            guard scope == ComposerDraftStore.accountScope(appState.gatewayConfiguration) else { return failed }
            do {
                try await gateway.deleteConversation(id: id)
                failed.remove(id)
            } catch {
                continue
            }
        }
        guard scope == ComposerDraftStore.accountScope(appState.gatewayConfiguration) else { return failed }
        recentDeleteFailures = failed
        let deleted = Set(ids).subtracting(failed)
        guard !deleted.isEmpty else { return failed }
        recentConversations?.removeAll { deleted.contains($0.id) }
        for id in deleted {
            appState.conversationUnavailable(id)
        }
        await persistSidebarMutation(scope: scope)
        return failed
    }

    private func persistSidebarMutation(scope: String) async {
        MobileListCache.shared.remove(.conversations, scope: scope)
        recentRevision += 1
        if let recentConversations {
            await RecentConversationsStore.shared.write(recentConversations, scope: scope, requestedAt: .now)
        }
    }

    private func openMobilePush(_ route: String) async {
        guard scenePhase == .active else { return }
        guard let click = MobilePushClick.decode(route),
              let profile = appState.gatewayProfiles.first(where: {
                  GatewayPairingService.shared.gatewayID(profileID: $0.id) == click.gatewayId
              }) else { push.forget(route); return }
        if appState.activeGatewayProfileID != profile.id {
            guard appState.activateGatewayProfile(id: profile.id) else { return }
        }
        let configuration = appState.gatewayConfiguration
        do {
            let target = try await push.acknowledge(click.eventId, using: configuration)
            guard !Task.isCancelled, appState.activeGatewayProfileID == profile.id else { return }
            defer { push.forget(route) }
            guard let target else { return }
            setSidebar(false)
            openMobilePushTarget(target)
        } catch GatewayClientError.http(statusCode: 404, message: _) {
            push.forget(route)
        } catch {}
    }

    private func openMobilePushTarget(_ target: MobilePushTarget) {
        let configuration = appState.gatewayConfiguration
        let personalID = personalAgent.record(using: configuration)?.conversationId
        appState.openPushTarget(target, personalConversationID: personalID, defaultAgentID: defaultAgentID)
        if target.kind == "chat" || target.kind == "work_discovery",
           let id = target.conversationId, MobilePushClick.validID(id),
           id != personalID, id != appState.personalConversation?.id
        {
            Task {
                await hydratePushedSessionMetadata(id: id, using: configuration)
            }
        }
    }

    private func hydratePushedSessionMetadata(id: String, using configuration: GatewayConfiguration) async {
        guard let result: PushedSessionEnvelope = try? await GatewayClient(configuration: configuration)
            .request(path: "/api/sessions/\(id)/history", queryItems: [
                URLQueryItem(name: "view", value: "compact"), URLQueryItem(name: "limit", value: "1")
            ]),
            !Task.isCancelled, configuration == appState.gatewayConfiguration else { return }
        if let name = result.session.name?.trimmingCharacters(in: .whitespacesAndNewlines), !name.isEmpty {
            appState.updateSessionConversationTitle(id: result.session.key, title: name)
        }
    }

    private func navigateFromSidebar(_ route: HomeDestination) {
        setSidebar(false)
        appState.openSidebarDestination(route)
    }

    private func selectConversation(_ conversation: ConversationSummary) {
        setSidebar(false)
        appState.open(conversation)
    }

    private func startNew() {
        setSidebar(false)
        appState.startConversation(agentId: defaultAgentID)
    }

    private func openPersonalAgent(navigateToAda: Bool) async {
        let configuration = appState.gatewayConfiguration
        guard let record = await personalAgent.open(using: configuration), !Task.isCancelled,
              configuration == appState.gatewayConfiguration else { return }
        if navigateToAda {
            setSidebar(false)
            appState.openPersonalAgent(record)
        } else {
            appState.syncPersonalAgent(record)
        }
    }

    private var linkedProjectChat: Bool {
        guard case .route("projects", _) = messageLinks.destination else { return false }
        return projectChat.conversationID != nil
    }

    private var sidebarPresented: Bool {
        sidebarOpen || projectChat.sidebarOpen
    }

    private func leaveLinkedProject() {
        if linkedProjectChat {
            messageLinks.destination = nil
        }
    }

    private func setSidebar(_ open: Bool) {
        sidebarOpen = open && projectChat.conversationID == nil
        projectChat.sidebarOpen = open && projectChat.conversationID != nil
    }

    private var canDragSidebar: Bool {
        appState.activeStack.isEmpty
            && !sidebarOpen
            && !composerFocused
            && !keyboardVisible
            && !phoneVisible
            && !actionPanelVisible
            && !fullScreenOverlayActive
    }

    private func loadSidebarAgents(using configuration: GatewayConfiguration) async {
        guard let catalog = try? await GatewayClient(configuration: configuration).fetchAgents(),
              !Task.isCancelled, configuration == appState.gatewayConfiguration else { return }
        defaultAgentID = catalog.defaultId
        sidebarAgents = Dictionary(catalog.agents.map { ($0.id, $0) }, uniquingKeysWith: { first, _ in first })
    }

    private func restoreRecents(using configuration: GatewayConfiguration) async {
        let scope = ComposerDraftStore.accountScope(configuration)
        let cached = await RecentConversationsStore.shared.read(scope: scope)
        guard !Task.isCancelled, scope == ComposerDraftStore.accountScope(appState.gatewayConfiguration),
              let cached else { return }
        recentScope = scope
        recentConversations = cached
    }

    private func loadRecent(using configuration: GatewayConfiguration, more: Bool = false) async {
        let scope = ComposerDraftStore.accountScope(configuration)
        let revision = recentRevision
        guard configuration == appState.gatewayConfiguration else { return }
        let offset: Int
        if more {
            guard sidebarOpen, !recentLoading, recentScope == scope, let recentNextOffset else { return }
            offset = recentNextOffset
        } else {
            offset = 0
            recentNextOffset = nil
        }
        let isCurrentRequest = {
            !Task.isCancelled && revision == recentRevision && configuration == appState.gatewayConfiguration
        }
        let requestedAt = Date.now
        recentError = false
        recentLoading = true
        defer {
            if isCurrentRequest() {
                recentLoading = false
            }
        }
        if !more, recentScope != scope || recentConversations == nil {
            await restoreRecents(using: configuration)
        }
        guard !Task.isCancelled else { return }
        do {
            let page = try await GatewayClient(configuration: configuration).fetchSidebarConversations(startOffset: offset)
            guard isCurrentRequest() else { return }
            let retained = more ? recentConversations ?? [] : []
            var seen = Set(retained.map(\.id))
            recentScope = scope
            let fresh = page.items.filter { seen.insert($0.id).inserted }
            let failedRows = more ? [] : (recentConversations ?? []).filter {
                recentDeleteFailures.contains($0.id) && seen.insert($0.id).inserted
            }
            recentConversations = retained + fresh + failedRows
            recentNextOffset = page.nextOffset
            recentUpdatedAt = .now
            if !more {
                await RecentConversationsStore.shared.write(page.items, scope: scope, requestedAt: requestedAt)
            }
        } catch {
            guard !(error is CancellationError), isCurrentRequest() else { return }
            recentError = true
        }
    }

    private func loadAttention(using configuration: GatewayConfiguration) async {
        let resolvedLocale = (AppLanguage(rawValue: language) ?? .system).locale
        if let home = try? await GatewayClient(configuration: configuration).fetchHome(locale: resolvedLocale.identifier),
           !Task.isCancelled, configuration == appState.gatewayConfiguration
        {
            pendingAttention = home.needsUser.count
        }
    }
}

private struct HomeChatLoad: Hashable {
    let configuration: GatewayConfiguration
    let needsSelection: Bool
    let retry: Int
}

private struct SidebarAttentionLoad: Hashable {
    let configuration: GatewayConfiguration
    let language: String
}

private struct PendingRecordingLoad: Hashable {
    let configuration: GatewayConfiguration
    let active: Bool
}

private struct PersonalUnreadLoad: Hashable {
    let configuration: GatewayConfiguration
    let foreground: Bool
    let sidebarOpen: Bool
    let viewed: PersonalReadTarget?
}

private struct SidebarLoad: Hashable {
    let configuration: GatewayConfiguration
    let revision: Int
}

private struct PushedSessionIdentity: Decodable {
    let key: String
    let name: String?
    let agentId: String
}

private struct PushedSessionEnvelope: Decodable {
    let session: PushedSessionIdentity
}

#Preview {
    AppRootView()
}

private struct VoiceCallPresentation: ViewModifier {
    let call: RealtimeVoiceCall
    let active: Bool

    func body(content: Content) -> some View {
        content
            .overlay(alignment: .top) {
                if active, call.phase != .idle, !call.expanded {
                    RealtimeVoiceMiniBar(call: call)
                        .padding(.top, 58)
                        .zIndex(10)
                }
            }
            .fullScreenCover(isPresented: Binding(
                get: { active && call.phase != .idle && call.expanded },
                set: {
                    if !$0, active {
                        call.minimize()
                    }
                }
            )) {
                RealtimeVoiceCallView(call: call)
            }
    }
}
