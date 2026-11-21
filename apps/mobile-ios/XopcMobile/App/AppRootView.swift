// swiftlint:disable file_length
import AVFoundation
import SwiftUI

// swiftlint:disable:next type_body_length
struct AppRootView: View {
    @Environment(\.scenePhase) private var scenePhase
    @Environment(\.colorScheme) private var colorScheme
    @State private var appState = AppState()
    @State private var push = MobilePush.shared
    @State private var realtimeVoiceCall = RealtimeVoiceCall()
    @State private var personalAgent = PersonalAgentState()
    @State private var settingsPresented = false
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var sidebarOpen = false
    @State private var composerFocused = false
    @State private var phoneVisible = false
    @State private var actionPanelVisible = false
    @GestureState private var sidebarDrag: CGFloat = 0
    @State private var sidebarDismissDrag: CGFloat = 0
    @State private var reopenSidebar = false
    @State private var recentConversations: [ConversationSummary]?
    @State private var recentNextOffset: Int?
    @State private var recentScope: String?
    @State private var recentError = false
    @State private var recentLoading = false
    @State private var recentRevision = 0
    @State private var recentDeleteFailures: Set<String> = []
    @State private var homeRetry = 0
    @State private var pendingAttention = 0
    @State private var defaultAgentID = "main"
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
                messageLinks.open(target, appState: appState)
                return .handled
            }
            return ChatMessageLink.externalURL(url) ? .systemAction(url) : .discarded
        })
        .environment(\.locale, (AppLanguage(rawValue: language) ?? .system).locale)
        .preferredColorScheme((AppAppearance(rawValue: appearance) ?? .system).colorScheme)
        .sheet(isPresented: $music.expanded, onDismiss: openMusicSource) {
            GeneratedMusicPlayer(playback: music) { track in
                musicSourceToOpen = track
                music.expanded = false
            }
        }
        .onChange(of: appState.gatewayConfiguration) { music.validateScope(appState.gatewayConfiguration) }
        .overlay(alignment: .top) {
            if realtimeVoiceCall.phase != .idle, !realtimeVoiceCall.expanded {
                RealtimeVoiceMiniBar(call: realtimeVoiceCall)
                    .padding(.top, 58)
                    .zIndex(10)
            }
        }
        .fullScreenCover(isPresented: Binding(
            get: { realtimeVoiceCall.phase != .idle && realtimeVoiceCall.expanded },
            set: {
                if !$0 {
                    realtimeVoiceCall.minimize()
                }
            }
        )) {
            RealtimeVoiceCallView(call: realtimeVoiceCall)
        }
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
        }
        .sheet(item: Binding(get: {
            if case .route("tasks", _) = messageLinks.destination {
                return nil
            }
            return messageLinks.destination
        }, set: { messageLinks.destination = $0 })) { link in
            ChatMessageLinkDestination(link: link, appState: appState, router: messageLinks)
        }
        .fullScreenCover(item: Binding(get: {
            if case .route("tasks", _) = messageLinks.destination {
                return messageLinks.destination
            }
            return nil
        }, set: { messageLinks.destination = $0 })) { link in
            ChatMessageLinkDestination(link: link, appState: appState, router: messageLinks)
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
            if scenePhase == .active {
                Task {
                    await appState.refreshGatewayOnForeground()
                    await push.restore(appState.gatewayConfiguration)
                }
                Task { await realtimeVoiceCall.resumeAfterInterruption() }
            } else {
                music.checkpoint()
            }
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
        .tint(mobileTheme.action)
        .foregroundStyle(mobileTheme.foreground)
    }

    private func openMusicSource() {
        guard let track = musicSourceToOpen else { return }
        musicSourceToOpen = nil
        let configuration = appState.gatewayConfiguration
        guard track.configurationScope == ComposerDraftStore.accountScope(configuration),
              !appState.homePath.isEmpty || appState.selectedConversation?.id != track.conversationID else { return }
        if let record = personalAgent.record(using: configuration), record.conversationId == track.conversationID {
            appState.openPersonalConversation(record, remember: true)
        } else {
            appState.openConversation(id: track.conversationID, title: track.source, agentId: track.sourceAgentID ?? "main")
        }
    }

    private var homeShell: some View {
        GeometryReader { geometry in
            let width = min(350, geometry.size.width * 0.84)
            let reveal = sidebarOpen
                ? max(0, 1 + sidebarDismissDrag / max(1, width))
                : min(1, sidebarDrag / max(1, width))

            NavigationStack(path: $appState.homePath) {
                chatScreen
                    .toolbar(.hidden, for: .navigationBar)
                    .navigationDestination(for: HomeDestination.self, destination: destination)
            }
            .safeAreaInset(edge: .bottom, spacing: 0) {
                if !appState.homePath.isEmpty || phoneVisible {
                    GeneratedMusicDock(playback: music)
                }
            }
            .simultaneousGesture(sidebarGesture(width: width), including: canDragSidebar ? .all : .none)
            .accessibilityHidden(sidebarOpen)
            .overlay(alignment: .leading) {
                Color.black.opacity(0.4 * reveal).ignoresSafeArea()
                    .onTapGesture { setSidebar(false) }
                    .allowsHitTesting(sidebarOpen).accessibilityHidden(true)
            }
            .overlay(alignment: .leading) {
                if sidebarOpen || sidebarDrag > 0 {
                    sidebar.frame(width: width)
                        .offset(x: (reveal - 1) * width)
                        .background {
                            if sidebarOpen {
                                HorizontalSwipeCapture(leftOnly: true, onDrag: { sidebarDismissDrag = min(0, $0) },
                                                       onEnd: { finishSidebarDismiss($0, velocity: $1, width: width) })
                            }
                        }
                        .allowsHitTesting(sidebarOpen)
                        .accessibilityHidden(!sidebarOpen)
                        .transition(reduceMotion ? .opacity : .move(edge: .leading))
                }
            }
        }
        .background(mobileTheme.canvas.ignoresSafeArea())
        .task(id: SidebarAttentionLoad(configuration: appState.gatewayConfiguration, language: language)) {
            let configuration = appState.gatewayConfiguration
            while !Task.isCancelled {
                await loadAttention(using: configuration)
                do { try await Task.sleep(for: .seconds(30)) } catch { return }
            }
        }
        .task(id: appState.gatewayConfiguration) {
            let configuration = appState.gatewayConfiguration
            if let catalog = try? await GatewayClient(configuration: configuration).fetchAgents(),
               !Task.isCancelled, configuration == appState.gatewayConfiguration
            {
                defaultAgentID = catalog.defaultId
            }
        }
        .task(id: HomeChatLoad(configuration: appState.gatewayConfiguration,
                               needsSelection: appState.selectedConversation == nil, retry: homeRetry))
        {
            let configuration = appState.gatewayConfiguration
            await personalAgent.refresh(using: configuration)
            guard appState.selectedConversation == nil, !Task.isCancelled,
                  configuration == appState.gatewayConfiguration, personalAgent.errorMessage == nil else { return }
            await openPersonalAgent(remember: false)
        }
        .task(id: SidebarLoad(configuration: appState.gatewayConfiguration, revision: recentRevision)) {
            await loadRecent(using: appState.gatewayConfiguration)
        }
        .task(id: sidebarOpen) {
            if sidebarOpen {
                await loadAttention(using: appState.gatewayConfiguration)
            }
        }
        .onChange(of: ComposerDraftStore.accountScope(appState.gatewayConfiguration)) {
            setSidebar(false)
            reopenSidebar = false
            recentConversations = nil
            recentDeleteFailures = []
            recentNextOffset = nil
            recentScope = nil
            recentError = false
            pendingAttention = 0
            defaultAgentID = "main"
        }
        .onChange(of: appState.listCacheRevision) {
            recentConversations = nil
            recentNextOffset = nil
            recentScope = nil
            recentError = false
            recentRevision += 1
        }
        .onChange(of: appState.homePath) { old, current in
            if old == [.conversations] || old == [.conversationSearch] || old == [.progress] || old == [.automations],
               current.isEmpty, reopenSidebar
            {
                setSidebar(true)
            }
            if current.isEmpty {
                reopenSidebar = false
            }
        }
    }

    private var chatScreen: some View {
        let configuration = appState.gatewayConfiguration
        return AssistantView(
            configuration: configuration,
            isActive: appState.homePath.isEmpty,
            realtimeVoiceCall: realtimeVoiceCall,
            conversation: appState.selectedConversation,
            personalAgent: personalAgent.record(using: configuration),
            onStartConversation: appState.startConversation,
            onStartScopedConversation: appState.startScopedConversation,
            onConversationUpdated: appState.updateConversation,
            onOpenSettings: { settingsPresented = true },
            onInputFocusChanged: { composerFocused = $0 },
            onOpenSidebar: { setSidebar(true) },
            onOpenProgress: { navigate(.progress) },
            onOpenPersonalOverview: { navigate(.personalOverview(allowsConversationSharing: $0)) },
            onConversationUnavailable: { id in await recoverUnavailableConversation(id, using: configuration) },
            pendingAttention: pendingAttention,
            sidebarOpen: sidebarOpen,
            homeChatError: personalAgent.errorMessage,
            onRetryHomeChat: { homeRetry += 1 },
            onPhoneVisibilityChanged: { phoneVisible = $0 },
            onActionPanelVisibilityChanged: { actionPanelVisible = $0 },
            externalIntake: appState.externalIntake,
            onExternalIntakeFinished: appState.externalIntakeFinished
        ) { composer in composer }
    }

    private func recoverUnavailableConversation(_ id: String, using configuration: GatewayConfiguration) async {
        guard configuration == appState.gatewayConfiguration, appState.selectedConversation?.id == id else { return }
        do {
            let record: PersonalAgentRecord? = if let current = personalAgent.record(using: configuration) {
                current
            } else {
                try await GatewayClient(configuration: configuration).fetchPersonalAgent()
            }
            guard record?.conversationId != id, !Task.isCancelled, configuration == appState.gatewayConfiguration else { return }
            appState.conversationUnavailable(id)
        } catch {
            // Keep the selection retryable if the Gateway cannot identify the Personal Agent.
        }
    }

    // swiftlint:disable:next cyclomatic_complexity function_body_length
    @ViewBuilder private func destination(_ route: HomeDestination) -> some View {
        let configuration = appState.gatewayConfiguration
        switch route {
        case .conversations, .conversationSearch:
            ConversationsView(configuration: configuration, onSelect: selectConversation, onStartNew: startNew,
                              personalConversationID: personalAgent.record(using: configuration)?.conversationId,
                              onOpenSettings: { settingsPresented = true }, startSearching: route == .conversationSearch, onDelete: appState.conversationUnavailable)
        case .progress:
            WorkPagesView(configuration: configuration, initialPage: .progress, onOpenConversation: appState.openConversation)
        case .projects:
            WorkPagesView(configuration: configuration, initialPage: .projects, onOpenConversation: appState.openConversation)
        case .automations:
            AutomationsView(configuration: configuration, onOpenConversation: appState.openConversation)
        case .notes:
            NotesView(configuration: configuration, onOpenConversation: appState.openConversation)
        case .library:
            SpaceLibraryView(configuration: configuration, onOpenSource: { source in
                if source.kind == "task", let taskID = source.taskId {
                    appState.homePath.append(.libraryTask(taskID))
                } else if source.kind == "automation", let runID = source.automationRunId {
                    appState.homePath.append(.libraryAutomationRun(runID))
                } else {
                    appState.openConversation(id: source.conversationId, title: source.label ?? "", agentId: defaultAgentID)
                }
            }, onUseInChat: { attachment, origin in
                try await appState.startLibraryConversation(configuration: configuration, agentID: defaultAgentID,
                                                            attachment: attachment, origin: origin)
            })
        case let .notificationTask(taskID):
            TaskConversationView(configuration: configuration, taskID: taskID, opensDetails: true)
        case let .libraryTask(taskID):
            TaskConversationView(configuration: configuration, taskID: taskID)
        case let .libraryAutomationRun(runID):
            AutomationRunDetailView(configuration: configuration, runID: runID,
                                    initialRun: nil, onOpenConversation: appState.openConversation)
        case .capabilities:
            CapabilitiesView(configuration: configuration, personal: personalAgent.record(using: configuration),
                             onOpenAgent: { id, personal in
                                 if personal {
                                     Task { await openPersonalAgent(remember: true) }
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
               let conversation = appState.selectedConversation, conversation.id == agent.conversationId
            {
                PersonalAgentOverview(configuration: configuration, agent: agent, conversation: conversation,
                                      attention: pendingAttention,
                                      allowsConversationSharing: allowsConversationSharing,
                                      onEdit: { personalAgent.applyProfile($0, using: configuration) },
                                      onModelSaved: appState.updateConversation, onOpenConversation: appState.openConversation)
            }
        case .settings:
            AppSettingsView(configuration: configuration,
                            gatewayName: appState.gatewayProfiles.first { $0.id == appState.activeGatewayProfileID }?.name ?? "Gateway",
                            onOpenGatewaySettings: { settingsPresented = true },
                            personalAgent: personalAgent.record(using: configuration),
                            personalAgentBusy: personalAgent.isLoading || personalAgent.isOpening,
                            personalAgentError: personalAgent.errorMessage,
                            onOpenPersonalAgent: { Task { await openPersonalAgent(remember: true) } },
                            onPersonalAgentSaved: { personalAgent.applyProfile($0, using: configuration) })
        }
    }

    private var sidebar: some View {
        let configuration = appState.gatewayConfiguration
        let currentScope = ComposerDraftStore.accountScope(configuration)
        let recents = recentScope == currentScope ? recentConversations : nil
        return ChatSidebarView(configuration: configuration, personal: personalAgent.record(using: configuration),
                               openingPersonal: personalAgent.isOpening, selectedID: appState.selectedConversation?.id,
                               recent: recents ?? [], recentNextOffset: recents == nil ? nil : recentNextOffset,
                               recentLoading: recentLoading || (recents == nil && !recentError), recentError: recentError,
                               attention: pendingAttention, onClose: { setSidebar(false) }, onNavigate: navigate,
                               onPersonal: { Task { await openPersonalAgent(remember: true) } },
                               onConversation: selectConversation, onNew: startNew, onRetry: { recentRevision += 1 },
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
        if let name, var selected = appState.selectedConversation, selected.id == item.id {
            selected.title = name
            appState.updateConversation(selected)
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
        if let id = appState.selectedConversation?.id, deleted.contains(id) {
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
            appState.homePath.removeAll()
            setSidebar(false)
            openMobilePushTarget(target)
        } catch GatewayClientError.http(statusCode: 404, message: _) {
            push.forget(route)
        } catch {}
    }

    private func openMobilePushTarget(_ target: MobilePushTarget) {
        switch target.kind {
        case "task":
            if let id = target.taskId, MobilePushClick.validID(id) {
                navigate(.notificationTask(id))
            }
        case "automation_run":
            if let id = target.runId, MobilePushClick.validID(id) {
                navigate(.libraryAutomationRun(id))
            }
        case "chat", "work_discovery":
            if let id = target.conversationId, MobilePushClick.validID(id) {
                messageLinks.open(.route(page: "chat", itemID: id), appState: appState)
            }
        default: break
        }
    }

    private func navigate(_ route: HomeDestination) {
        reopenSidebar = route == .conversations || route == .conversationSearch || route == .progress || route == .automations
        setSidebar(false)
        appState.homePath.append(route)
    }

    private func selectConversation(_ conversation: ConversationSummary) {
        reopenSidebar = false
        setSidebar(false)
        appState.open(conversation)
    }

    private func startNew() {
        reopenSidebar = false
        setSidebar(false)
        appState.startConversation(agentId: defaultAgentID)
    }

    private func openPersonalAgent(remember: Bool) async {
        let configuration = appState.gatewayConfiguration
        let selection = appState.selectedConversation?.id
        let path = appState.homePath
        guard let record = await personalAgent.open(using: configuration), !Task.isCancelled,
              configuration == appState.gatewayConfiguration,
              appState.selectedConversation?.id == selection,
              !remember || appState.homePath == path else { return }
        if remember {
            reopenSidebar = false
            setSidebar(false)
        }
        appState.openPersonalConversation(record, remember: remember)
    }

    private func setSidebar(_ open: Bool) {
        if open, !sidebarOpen, !recentLoading {
            recentNextOffset = nil
            recentRevision += 1
        }
        withAnimation(reduceMotion ? nil : .easeOut(duration: 0.22)) { sidebarOpen = open }
    }

    private var canDragSidebar: Bool {
        appState.homePath.isEmpty && !sidebarOpen && !composerFocused && !phoneVisible && !actionPanelVisible
    }

    private func sidebarGesture(width: CGFloat) -> some Gesture {
        DragGesture(minimumDistance: 18, coordinateSpace: .global)
            .updating($sidebarDrag) { value, progress, _ in
                guard sidebarSwipe(value) else { return }
                progress = value.translation.width
            }
            .onEnded { value in
                guard sidebarSwipe(value) else { return }
                let distance = value.translation.width
                if distance >= min(width * 0.32, 96)
                    || (distance > 28 && value.predictedEndTranslation.width >= width * 0.55)
                {
                    setSidebar(true)
                }
            }
    }

    private func sidebarSwipe(_ value: DragGesture.Value) -> Bool {
        value.startLocation.x >= 24 && value.translation.width > abs(value.translation.height) * 1.5
    }

    private func finishSidebarDismiss(_ offset: CGFloat, velocity: CGFloat, width: CGFloat) {
        if -offset >= min(width * 0.32, 96) || (-offset >= 24 && -velocity >= 550) {
            setSidebar(false)
        }
        withAnimation(reduceMotion ? nil : .easeOut(duration: 0.22)) { sidebarDismissDrag = 0 }
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

private struct SidebarLoad: Hashable {
    let configuration: GatewayConfiguration
    let revision: Int
}

#Preview {
    AppRootView()
}
