import PhotosUI
import SwiftUI

// swiftlint:disable file_length
// swiftlint:disable:next type_body_length
struct AssistantView<Dock: View>: View {
    @Environment(\.mobileTheme) private var mobileTheme
    let configuration: GatewayConfiguration
    let isActive: Bool
    let realtimeVoiceCall: RealtimeVoiceCall
    let conversation: ConversationSelection?
    let personalAgent: PersonalAgentRecord?
    let onStartConversation: (String) -> Void
    let onStartScopedConversation: (ProjectRecord?, String?, String) -> Void
    let onConversationUpdated: (ConversationSelection) -> Void
    let onOpenSettings: () -> Void
    let onInputFocusChanged: (Bool) -> Void
    var showsFloatingHeader = true
    var bottomComposerSpacing: CGFloat = 4
    var backAccessibilityID = "project-chat-close"
    var showsSessionConversationTitle = true
    var scrollToLatestToken = 0
    var onRunningStateChanged: ((Bool) -> Void)?
    var onBack: (() -> Void)?
    var onOpenSidebar: (() -> Void)?
    var onOpenProgress: () -> Void = {}
    var onOpenPersonalOverview: (Bool) -> Void = { _ in }
    var onConversationUnavailable: (String) async -> Void = { _ in }
    var onPersonalReadTargetChanged: (PersonalReadTarget?) -> Void = { _ in }
    var personalUnread: PersonalUnreadSnapshot?
    var pendingAttention = 0
    var sidebarOpen = false
    var homeChatError: String?
    var onRetryHomeChat: () -> Void = {}
    var onPhoneVisibilityChanged: (Bool) -> Void = { _ in }
    var onActionPanelVisibilityChanged: (Bool) -> Void = { _ in }
    var sessionActionsRequest = 0
    var messageSearchRequest = 0
    var automationSetup = false
    var externalIntake: ExternalIntakeBatch?
    var onExternalIntakeFinished: (UUID, String?) -> Void = { _, _ in }
    let bottomDock: (AssistantComposer) -> Dock

    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.locale) private var locale
    @Environment(\.colorScheme) private var colorScheme
    @Environment(\.scenePhase) private var scenePhase

    @FocusState private var composerFocused: Bool
    @State var state = AssistantState()
    @State var draft = ""
    @State var composerDraftScope: String?
    @State var intakeReceipts: [UUID] = []
    @State var composerSaveTask: Task<Void, Never>?
    @State var attachments: [MessageAttachment] = []
    @State var references: [ContextReference] = []
    @State var attachmentError: String?
    @State private var showingPhotoPicker = false
    @State private var showingFilePicker = false
    @State private var showingCameraPicker = false
    @State private var voiceMode = false
    @State private var showingReferencePicker = false
    @State private var referenceKind = ContextReferenceKind.note
    @State private var isActionPanelExpanded = false
    @State private var showingSessionActions = false
    @State private var sessionSheetDestination: AssistantSheetDestination = .actions
    @State private var options = AssistantOptionsState()
    @State private var draftProjectName: String?
    @State private var sharingConversation = false
    @State private var showingAgentPicker = false
    @State private var selectedPickerAgent: String?
    @State private var selectedPickerProjectAgent: (ProjectRecord, String)?
    @State private var searchAfterOptions = false
    @State private var showingMessageSearch = false
    @State private var executionPresentation: ExecutionActivityPresentation?
    private let readAloud = ChatReadAloud.shared
    @State private var readAloudOwner = UUID()
    @State private var assistantAudio = AssistantAudioAutoplay()
    @State private var generatedMedia = GeneratedMediaState()
    @State private var presentedGeneratedVideo: GeneratedMediaCard?
    private let music = GeneratedMusicPlayback.shared
    @State private var visibleMusicCardIDs: Set<String> = []
    @State private var startingVoice = false
    @State private var voiceStartError: String?
    @State private var voiceMaterializationIDs: [String: String] = [:]
    @State private var isAtBottom = true
    @State private var pendingStart: PendingConversationStart?
    @State private var timelineHeight: CGFloat = 0
    @State private var chatTopInset: CGFloat = 0
    @State private var personalHeaderHeight: CGFloat = 0
    @State private var ordinaryHeaderHeight: CGFloat = 0
    @State private var positionedTimeline = false
    @State private var timelineConversationID: String?
    @State private var readingHistory = ChatReadingHistory()
    @State private var timelineScrollCommands = ChatTimelineScrollCommands()
    @State private var stickyMusicHeight: CGFloat = 0
    @State private var followingBottom = true
    @State private var bottomJumpID: UUID?
    @State private var userScrollingMessages = false

    @State private var desktopChatTarget: DesktopChatTarget?
    @State private var desktopTargetRetry = 0
    @State private var chatConnectionPhase: ChatConnectionPhase = .reconnecting
    @State private var chatConnectionNoticeStage = 0
    @State private var chatConnectionRetry = 0

    var canSendOnChatConnection: Bool {
        chatConnectionPhase == .connected
    }

    private var chatConnectionObservation: ChatConnectionObservationKey {
        .init(configuration: configuration, active: isActive && scenePhase != .background && conversation != nil)
    }

    @State private var reselectingDesktop = false
    @State private var phone = PhoneWorkspaceModel()
    @State private var showingPhone = false
    @State private var backgroundPauseTask: Task<Void, Never>?
    @State private var conversationSuspendedInBackground = false

    var body: some View {
        PhoneConversationPages(showingPhone: showingPhone, canPage: phone.summary?.available == true && phone.live?.ownControl != true,
                               onPage: { showingPhone = $0 }, phone: phone) { chatBody }
            .task(id: PhoneObservationKey(configuration: configuration, conversationID: conversation?.id,
                                          active: isActive && scenePhase == .active))
            {
                guard isActive, scenePhase == .active, let conversation, !conversation.isDraft else { phone.leave(); return }
                await phone.observe(configuration: configuration, conversationID: conversation.id, visible: showingPhone)
            }
            .task(id: desktopTargetObservationKey) { await observeDesktopTarget() }
            .onChange(of: showingPhone) {
                phone.setVisible(showingPhone)
                onPhoneVisibilityChanged(showingPhone)
            }
            .onChange(of: state.isRunActive, initial: true) { onRunningStateChanged?(state.isRunActive) }
            .onChange(of: conversation?.id) { showingPhone = false }
            .onChange(of: personalReadTarget, initial: true) { onPersonalReadTargetChanged(personalReadTarget) }
            .task(id: unreadHistoryToLoad) {
                guard unreadHistoryToLoad != nil, let conversation else { return }
                await state.refreshUnreadHistory(conversation, using: GatewayClient(configuration: configuration))
            }
            .onDisappear { phone.leave(); onPhoneVisibilityChanged(false) }
    }

    private var personalReadTarget: PersonalReadTarget? {
        guard isActive, !showingPhone, !showingMessageSearch, let conversation, !conversation.isDraft,
              personalAgent?.conversationId == conversation.id, state.isCurrentConversation(conversation.id),
              !state.isLoadingHistory, state.errorMessage == nil,
              let transcriptID = state.historyTranscriptID(for: conversation) else { return nil }
        return PersonalReadTarget(conversationID: conversation.id, transcriptID: transcriptID,
                                  lastSeq: state.loadedHistorySeq ?? 0)
    }

    private var unreadHistoryToLoad: PersonalUnreadSnapshot? {
        guard let viewed = personalReadTarget, let personalUnread, personalUnread.unreadCount > 0,
              personalUnread.conversationId == viewed.conversationID,
              personalUnread.transcriptId != viewed.transcriptID || personalUnread.lastSeq > viewed.lastSeq else { return nil }
        return personalUnread
    }

    private var desktopTargetObservationKey: String {
        "\(ComposerDraftStore.accountScope(configuration))|\(conversation?.id ?? "")|\(isActive && scenePhase == .active)|\(desktopTargetRetry)"
    }

    private func observeDesktopTarget() async {
        desktopChatTarget = nil
        guard isActive, scenePhase == .active, let conversation, !conversation.isDraft else { return }
        let client = GatewayClient(configuration: configuration)
        while !Task.isCancelled {
            do {
                let response: GatewayEnvelope<DesktopChatTarget> = try await client
                    .request(path: "/api/endpoint-tools/targets/\(conversation.id)")
                guard !Task.isCancelled, let target = response.payload, target.deviceName != nil else { return }
                desktopChatTarget = target
                try await Task.sleep(for: .seconds(5))
            } catch { return }
        }
    }

    private func reselectDesktopTarget(_ endpointID: String) async {
        guard let conversation, !reselectingDesktop else { return }
        reselectingDesktop = true
        defer { reselectingDesktop = false }
        do {
            let _: IgnoredResponse = try await GatewayClient(configuration: configuration)
                .request(path: "/api/endpoint-tools/targets/\(conversation.id)", method: "PUT",
                         body: JSONEncoder().encode(DesktopChatTargetSelection(endpointId: endpointID)))
        } catch {}
        desktopTargetRetry += 1
    }

    @ViewBuilder
    private func desktopTargetBadge(_ target: DesktopChatTarget, name: String) -> some View {
        let label = AppLocalization.string("device_execution_target", locale: locale)
        let statusKey = switch target.deviceState {
        case "offline": "device_execution_offline"
        case "authorization_required": "device_execution_authorization"
        case "reselect": "device_execution_reselect"
        default: ""
        }
        let suffix = statusKey.isEmpty ? "" : " · " + AppLocalization.string(statusKey, locale: locale)
        let title = label + " · " + name + suffix
        Group {
            if let endpointID = target.reselectEndpointId {
                Button { Task { await reselectDesktopTarget(endpointID) } } label: {
                    Label(title, systemImage: "laptopcomputer")
                        .lineLimit(1)
                        .font(.caption.weight(.medium))
                        .foregroundStyle(mobileTheme.action)
                        .padding(.horizontal, 10).padding(.vertical, 5).frame(minHeight: 32)
                        .contentShape(.rect)
                }
                .buttonStyle(MobilePressStyle(radius: mobileTheme.corner(12), restingBackground: mobileTheme.card))
                .disabled(reselectingDesktop || state.isRunActive || state.isSending)
                .accessibilityLabel(Text(verbatim: title)).accessibilityIdentifier("chat-execution-device")
            } else {
                Label(title, systemImage: "laptopcomputer")
                    .lineLimit(1)
                    .font(.caption.weight(.medium))
                    .foregroundStyle(mobileTheme.secondary)
                    .padding(.horizontal, 10).padding(.vertical, 5).frame(minHeight: 32)
                    .background(mobileTheme.card, in: .rect(cornerRadius: mobileTheme.corner(12)))
                    .accessibilityElement(children: .ignore)
                    .accessibilityLabel(Text(verbatim: title)).accessibilityIdentifier("chat-execution-device")
            }
        }
    }

    private var chatLayout: some View {
        VStack(spacing: 0) {
            content
                .accessibilityHidden(!isActive)
                .frame(maxWidth: .infinity, maxHeight: .infinity)
                .clipped()
                .contentShape(.rect)
                .simultaneousGesture(TapGesture().onEnded { composerFocused = false },
                                     including: composerFocused ? .all : .none)
                .modifier(ChatScrollEdgeEffect())
                .ignoresSafeArea(.container, edges: .top)
            VStack(spacing: 0) {
                if chatConnectionObservation.active, !showingPhone {
                    ChatConnectionNotice(phase: chatConnectionPhase, stage: chatConnectionNoticeStage,
                                         syncFailed: state.historyConnectionError, onRetry: retryChatConnection)
                        .padding(.horizontal, 12)
                }
                if readAloud.owner == readAloudOwner, readAloud.state == .failed, let error = readAloud.errorMessage {
                    TransientComposerFeedback(message: error) { readAloud.stop() }
                        .padding(.horizontal, 20)
                } else if readAloud.owner == readAloudOwner, readAloud.state != .idle {
                    readAloudBar
                }
                if isActive, !showingPhone, showsFloatingHeader,
                   music.track?.conversationID != conversation?.id || !mediaCards.contains(where: { $0.id == music.track?.id })
                {
                    GeneratedMusicDock(playback: music)
                }
                if conversation != nil {
                    if let conversation, !conversation.isDraft, isActive, !showingPhone {
                        ConversationMcpAction(configuration: configuration, conversationID: conversation.id, activeRun: state.isRunActive)
                    }
                    if state.clarification != nil {
                        clarificationCard
                            .padding(.horizontal, 12)
                            .padding(.bottom, 8)
                            .onAppear { composerFocused = false }
                    } else {
                        bottomDock(composer).padding(.bottom, bottomComposerSpacing)
                    }
                }
            }
        }
        .background(mobileTheme.canvas.ignoresSafeArea())
        .onGeometryChange(for: CGFloat.self) { $0.safeAreaInsets.top } action: { chatTopInset = $0 }
        .overlay(alignment: .top) {
            mobileTheme.canvas
                .frame(height: chatTopInset)
                .offset(y: -chatTopInset)
                .allowsHitTesting(false)
                .accessibilityHidden(true)
        }
        .overlay(alignment: .top) {
            if showsFloatingHeader {
                VStack(spacing: isPersonalConversation ? 4 : 6) {
                    floatingHeader.padding(.horizontal, 12)
                        .onGeometryChange(for: CGFloat.self) { $0.size.height } action: { height in
                            if isPersonalConversation {
                                personalHeaderHeight = height
                            } else {
                                ordinaryHeaderHeight = height
                            }
                        }
                    if pinsPlayingMusic {
                        GeneratedMusicDock(playback: music, sticky: true)
                            .onGeometryChange(for: CGFloat.self) { $0.size.height } action: { stickyMusicHeight = $0 }
                    }
                }
                .padding(.top, 8)
                .padding(.bottom, isPersonalConversation ? 6 : 8)
                .frame(maxWidth: .infinity)
                .background {
                    if isPersonalConversation {
                        LinearGradient(stops: [
                            .init(color: mobileTheme.canvas, location: 0),
                            .init(color: mobileTheme.canvas, location: 0.84),
                            .init(color: mobileTheme.canvas.opacity(0), location: 1)
                        ], startPoint: .top, endPoint: .bottom)
                            .allowsHitTesting(false)
                            .accessibilityHidden(true)
                    } else {
                        mobileTheme.canvas.ignoresSafeArea(edges: .top)
                    }
                }
            }
        }
    }

    private var chatHeaderClearance: CGFloat {
        let measuredHeight = isPersonalConversation ? personalHeaderHeight : ordinaryHeaderHeight
        let headerHeight = showsFloatingHeader && measuredHeight > 0
            ? measuredHeight + (isPersonalConversation ? 14 : 16) : (isPersonalConversation ? 114 : 66)
        return chatTopInset + headerHeight + (pinsPlayingMusic ? stickyMusicHeight + (isPersonalConversation ? 4 : 6) : 0)
    }

    private var pinsPlayingMusic: Bool {
        guard isActive, !showingPhone, music.phase == .playing, let track = music.track,
              track.conversationID == conversation?.id, !visibleMusicCardIDs.contains(track.id) else { return false }
        return mediaCards.contains { $0.kind == .music && $0.id == track.id }
    }

    private var chatLifecycle: some View {
        chatSelectionLifecycle
            .onChange(of: sessionActionsRequest) {
                sessionSheetDestination = .actions
                showingSessionActions = true
            }
            .onChange(of: messageSearchRequest) { showingMessageSearch = true }
            .fullScreenCover(isPresented: $showingMessageSearch) {
                ChatMessageSearchView(messages: state.messages, configuration: configuration,
                                      conversationID: conversation?.id, assistantState: state, readAloud: readAloud,
                                      canReadAloud: realtimeVoiceCall.phase == .idle)
            }
            .sheet(isPresented: $showingAgentPicker, onDismiss: {
                if let (project, agentID) = selectedPickerProjectAgent {
                    selectedPickerProjectAgent = nil
                    requestStart(.scoped(project, nil, agentID))
                } else if let id = selectedPickerAgent {
                    selectedPickerAgent = nil
                    requestConversation(id)
                }
            }) {
                AgentPicker(
                    configuration: configuration,
                    agents: state.agents,
                    currentID: conversation?.agentId,
                    personal: personalAgent,
                    select: { selectedPickerAgent = $0 },
                    onSelectProjectAgent: { project, agentID in
                        selectedPickerProjectAgent = (project, agentID)
                    }
                )
            }
            .onChange(of: isActionPanelExpanded, initial: true) { _, shown in onActionPanelVisibilityChanged(shown) }
    }

    private var chatSelectionLifecycle: some View {
        chatObservation
            .onChange(of: scenePhase) {
                backgroundPauseTask?.cancel()
                backgroundPauseTask = nil
                if scenePhase == .background {
                    if state.runID != nil {
                        backgroundPauseTask = Task {
                            do { try await Task.sleep(for: .seconds(25)) } catch { return }
                            guard !Task.isCancelled, scenePhase == .background else { return }
                            conversationSuspendedInBackground = true
                            state.pauseConversation()
                        }
                    } else {
                        conversationSuspendedInBackground = true
                        state.pauseConversation()
                    }
                } else if scenePhase == .active {
                    conversationSuspendedInBackground = false
                }
            }
            .onChange(of: isActive) {
                if !isActive {
                    state.pauseConversation()
                    presentedGeneratedVideo = nil
                }
            }
            .onChange(of: conversation?.id, initial: true) {
                attachmentError = nil
                voiceMode = false
                showingPhotoPicker = false; showingFilePicker = false; showingCameraPicker = false
                assistantAudio.stop()
                executionPresentation = nil
                presentedGeneratedVideo = nil
                resetTimelineIfNeeded()
                if let agent = state.agents.first(where: { $0.id == conversation?.agentId }) {
                    state.select(agent)
                }
                restoreComposerDraft()
                isActionPanelExpanded = false
            }
            .onChange(of: configuration) {
                attachmentError = nil
                state.acceptedSuggestion = nil
                restoreComposerDraft()
            }
            .onChange(of: draft) {
                if draft.isEmpty {
                    state.acceptedSuggestion = nil
                }
                attachmentError = nil
                if readAloud.state == .failed {
                    readAloud.stop()
                }
                scheduleComposerSave()
            }
            .onChange(of: attachments) { scheduleComposerSave() }
            .onChange(of: references) { scheduleComposerSave() }
            .onChange(of: externalIntake?.id) { handleExternalIntake() }
            .onChange(of: sidebarOpen) {
                if sidebarOpen {
                    isActionPanelExpanded = false
                }
            }
            .onDisappear(perform: chatDidDisappear)
    }

    private func chatDidDisappear() {
        backgroundPauseTask?.cancel()
        backgroundPauseTask = nil
        conversationSuspendedInBackground = false
        isActionPanelExpanded = false
        onActionPanelVisibilityChanged(false)
        attachmentError = nil
        saveComposerDraft()
        state.pauseConversation()
        readAloud.leave(owner: readAloudOwner)
        assistantAudio.stop()
        onInputFocusChanged(false)
    }

    private var chatObservation: some View {
        let key = suggestionKey
        return chatLayout
            .task(id: chatConnectionObservation) {
                guard chatConnectionObservation.active else { return }
                let host = await DeviceEndpointPool.shared.host(for: GatewayClient(configuration: configuration))
                for await phase in await host.connectionChanges() {
                    guard !Task.isCancelled else { return }
                    chatConnectionPhase = phase
                }
            }
            .task(id: ChatConnectionNoticeKey(interrupted: chatConnectionObservation.active && !canSendOnChatConnection,
                                              retry: chatConnectionRetry))
            {
                guard chatConnectionObservation.active, !canSendOnChatConnection else {
                    chatConnectionNoticeStage = 0
                    return
                }
                let alreadyVisible = chatConnectionNoticeStage > 0
                do {
                    if !alreadyVisible {
                        try await Task.sleep(for: .milliseconds(1500))
                    }
                    chatConnectionNoticeStage = 1
                    try await Task.sleep(for: .milliseconds(alreadyVisible ? 8000 : 6500))
                    chatConnectionNoticeStage = 2
                } catch { return }
            }
            .onChange(of: chatConnectionPhase) { previous, phase in
                if phase == .connected, chatConnectionObservation.active {
                    synchronizeChatConnection()
                }
                if previous == .phoneOffline, phase == .reconnecting, chatConnectionNoticeStage > 0 {
                    chatConnectionNoticeStage = 1
                    chatConnectionRetry += 1
                }
            }
            .onChange(of: configuration) {
                chatConnectionPhase = .reconnecting
                chatConnectionNoticeStage = 0
                chatConnectionRetry += 1
            }
            .task(id: key) {
                await state.observeNextTurnSuggestion(in: key.conversationID == nil ? nil : conversation,
                                                      transcriptID: key.transcriptID, locale: key.locale,
                                                      using: GatewayClient(configuration: key.configuration))
            }
            .task(id: configuration) {
                await state.load(using: GatewayClient(configuration: configuration))
                if let agent = state.agents.first(where: { $0.id == conversation?.agentId }) {
                    state.select(agent)
                }
            }
            .task(id: ConversationLoadKey(
                configuration: configuration,
                conversationID: conversation?.id,
                transcriptID: conversation?.transcriptId,
                isDraft: conversation?.isDraft,
                isForeground: !conversationSuspendedInBackground && isActive
            )) {
                guard !conversationSuspendedInBackground, isActive else { state.pauseConversation(); return }
                await loadChat()
            }
            .task(id: OptionsObservationKey(
                configuration: configuration,
                conversationID: conversation?.id,
                agentID: conversation?.agentId,
                isDraft: conversation?.isDraft,
                model: conversation?.model,
                thinkingLevel: conversation?.thinkingLevel,
                serviceTier: conversation?.serviceTier,
                isActive: isActive && !conversationSuspendedInBackground
            )) {
                guard isActive, !conversationSuspendedInBackground, let conversation, !isPersonalConversation else { return }
                await options.load(conversation, using: GatewayClient(configuration: configuration))
            }
            .task(id: DraftProjectKey(
                configuration: configuration,
                projectID: conversation?.isDraft == true ? conversation?.projectId : nil,
                isActive: isActive && !conversationSuspendedInBackground
            )) {
                draftProjectName = nil
                guard isActive, !conversationSuspendedInBackground,
                      conversation?.isDraft == true,
                      let projectID = conversation?.projectId, !projectID.isEmpty else { return }
                if let record = try? await GatewayClient(configuration: configuration).fetchProject(id: projectID) {
                    guard !Task.isCancelled else { return }
                    draftProjectName = record.name
                }
            }
            .task(id: TaskResultObservationKey(configuration: configuration, conversationID: conversation?.id,
                                               isActive: isActive && !conversationSuspendedInBackground))
            {
                guard isActive, !conversationSuspendedInBackground, let conversation, !conversation.isDraft else { return }
                await state.observeTaskResults(in: conversation, using: GatewayClient(configuration: configuration))
            }
    }

    private func retryChatConnection() {
        if chatConnectionPhase == .connected {
            synchronizeChatConnection()
        } else if chatConnectionPhase == .reconnecting {
            chatConnectionRetry += 1
            Task {
                let host = await DeviceEndpointPool.shared.host(for: GatewayClient(configuration: configuration))
                await host.retryConnection()
            }
        }
    }

    private func synchronizeChatConnection() {
        guard let conversation, !conversation.isDraft else { return }
        Task {
            await state.synchronizeAfterConnection(conversation, using: GatewayClient(configuration: configuration))
        }
    }

    private var generatedMediaScope: GeneratedMediaState.Scope? {
        guard let conversation, !conversation.isDraft, let transcriptID = state.historyTranscriptID(for: conversation) else { return nil }
        return .init(id: conversation.id, transcriptID: transcriptID, account: ComposerDraftStore.accountScope(configuration))
    }

    private var mediaCards: [GeneratedMediaCard] {
        generatedMedia.cards(in: generatedMediaScope)
    }

    private var generatedMediaLifecycle: some View {
        let scope = generatedMediaScope
        let key = GeneratedMediaObservationKey(configuration: configuration, conversationID: conversation?.id,
                                               transcriptID: scope?.transcriptID, busy: state.isRunActive,
                                               visible: isActive && scenePhase == .active && !showingPhone,
                                               musicJobsRevision: state.musicJobsRevision)
        return chatLifecycle
            .task(id: key) {
                await generatedMedia.observe(scope, client: GatewayClient(configuration: key.configuration),
                                             visible: key.visible, busy: key.busy)
            }
            .onChange(of: scenePhase) {
                if scenePhase != .active {
                    presentedGeneratedVideo = nil
                }
            }
            .onChange(of: scope) { presentedGeneratedVideo = nil }
            .sheet(item: $presentedGeneratedVideo) { card in
                if let id = scope?.id {
                    GeneratedVideoDrawer(card: card, conversationID: id, configuration: configuration)
                        .mobileSheetPreset(.large)
                }
            }
            .onChange(of: showingPhone) {
                if showingPhone {
                    presentedGeneratedVideo = nil
                }
            }
    }

    private var chatBody: some View {
        generatedMediaLifecycle
            .onChange(of: readAloudObservation, initial: true) { _, observation in
                readAloud.show(observation, owner: readAloudOwner, locale: locale)
            }
            .onChange(of: assistantAudioObservation, initial: true) { _, observation in
                assistantAudio.observe(observation, configuration: configuration)
            }
            .modifier(AttachmentPickerModifier(
                scopeID: "\(configuration.baseURL.absoluteString):\(configuration.localIdentity ?? ""):\(conversation?.id ?? "")",
                attachments: $attachments,
                errorMessage: $attachmentError,
                showingPhotoPicker: $showingPhotoPicker,
                showingFilePicker: $showingFilePicker,
                showingCameraPicker: $showingCameraPicker
            ))
            .sheet(isPresented: $showingSessionActions, onDismiss: {
                sharingConversation = false
                sessionSheetDestination = .actions
                if searchAfterOptions {
                    searchAfterOptions = false
                    showingMessageSearch = true
                }
            }) {
                if sharingConversation, let conversation {
                    ConversationShareView(configuration: configuration, conversationID: conversation.id)
                        .interactiveDismissDisabled()
                        .mobileSheetPreset(.large)
                } else {
                    AssistantSessionActionsView(
                        configuration: configuration,
                        conversation: conversation,
                        state: state,
                        sharedOptions: options,
                        initialDestination: sessionSheetDestination,
                        onStartConversation: { requestConversation($0) },
                        pendingReferences: references,
                        onAddReference: { reference in
                            guard references.count < 5,
                                  !references.contains(where: { $0.id == reference.id }) else { return }
                            references.append(reference)
                        },
                        onConversationUpdated: onConversationUpdated,
                        onStartScopedConversation: { project, mode in
                            requestStart(.scoped(project, mode, conversation?.agentId ?? state.selectedAgentID ?? "main"))
                        },
                        onStartProjectAgentConversation: { project, agentID in
                            requestStart(.scoped(project, nil, agentID))
                        },
                        isTaskConversation: !showsFloatingHeader,
                        onSearch: { searchAfterOptions = true; showingSessionActions = false },
                        onShare: { sharingConversation = true }
                    )
                    .mobileSheetPreset(.large)
                }
            }
            .sheet(item: $executionPresentation) { presentation in
                AssistantExecutionSheet(
                    presentation: presentation,
                    configuration: configuration,
                    assistantState: state,
                    onDismiss: { executionPresentation = nil }
                )
                .mobileSheetPreset(.immersive)
            }
            .sheet(isPresented: $showingReferencePicker) {
                ReferencePickerView(
                    gateway: GatewayClient(configuration: configuration),
                    selectedReferences: references,
                    initialKind: referenceKind,
                    conversationID: conversation?.isDraft == false ? conversation?.id : nil
                ) { reference in
                    guard references.count < 5, !references.contains(where: { $0.id == reference.id }) else {
                        return
                    }
                    references.append(reference)
                }
            }
            .confirmationDialog("开始新对话？", isPresented: Binding(
                get: { pendingStart != nil }, set: {
                    if !$0 {
                        pendingStart = nil
                    }
                }
            )) {
                Button("开始新对话") {
                    if let start = pendingStart {
                        performStart(start)
                    }
                    pendingStart = nil
                }
                Button("取消", role: .cancel) { pendingStart = nil }
            } message: { Text("当前未发送的文字、附件和引用会保存在原会话。") }
            .alert("无法开始语音", isPresented: Binding(
                get: { voiceStartError != nil },
                set: {
                    if !$0 {
                        voiceStartError = nil
                    }
                }
            )) {
                Button("好") { voiceStartError = nil }
            } message: {
                Text(voiceStartError ?? "请稍后重试")
            }
    }

    @ViewBuilder
    private var content: some View {
        let cards = GeneratedMediaState.cardsByReply(mediaCards, messages: state.messages)
        if conversation == nil, onOpenSidebar != nil {
            if let homeChatError {
                ContentUnavailableView {
                    Label("无法打开个人助理", systemImage: "bubble.left")
                } description: {
                    Text(homeChatError)
                } actions: {
                    Button("重试", action: onRetryHomeChat)
                }
            } else {
                ProgressView("正在连接助手…").frame(maxWidth: .infinity, maxHeight: .infinity)
            }
        } else if state.isLoading, state.agents.isEmpty {
            ProgressView("正在连接助手…")
                .frame(maxWidth: .infinity, maxHeight: .infinity)
        } else if let errorMessage = state.errorMessage, state.agents.isEmpty {
            VStack(spacing: 16) {
                Image(systemName: "network.slash")
                    .font(.system(size: 48))
                    .foregroundStyle(.secondary)
                    .accessibilityHidden(true)
                Text("无法连接 Gateway")
                    .mobileTextStyle(.detailTitle)
                Text(errorMessage)
                    .foregroundStyle(.secondary)
                    .multilineTextAlignment(.center)
                    .fixedSize(horizontal: false, vertical: true)
                Button("连接设置", action: onOpenSettings)
                    .buttonStyle(.borderedProminent)
                    .controlSize(.large)
                Button("重试") {
                    Task {
                        await state.load(using: GatewayClient(configuration: configuration))
                    }
                }
                .buttonStyle(.bordered)
                .controlSize(.large)
            }
            .padding(24)
            .frame(maxWidth: .infinity, maxHeight: .infinity)
        } else if state.isLoadingHistory, cards.isEmpty {
            ProgressView("正在读取消息…")
                .frame(maxWidth: .infinity, maxHeight: .infinity)
        } else if state.messages.isEmpty, cards.isEmpty, !showsStagedProgress {
            GeometryReader { viewport in
                ScrollView {
                    LazyVStack(spacing: 16) {
                        if let errorMessage = state.errorMessage {
                            ErrorBanner(message: errorMessage)
                            Button("重试") {
                                Task {
                                    await loadChat()
                                }
                            }
                            .frame(minHeight: 44)
                        }
                        personalConnectionCard
                        if automationSetup {
                            ContentUnavailableView("用对话创建定时任务", systemImage: "clock",
                                                   description: Text("告诉助理何时运行、要做什么。发送前可以编辑。"))
                        } else {
                            welcome
                        }
                    }
                    .padding()
                    .frame(maxWidth: 720)
                    .frame(maxWidth: .infinity)
                    .frame(minHeight: max(0, viewport.size.height - 24))
                }
                .accessibilityIdentifier("chat-message-timeline")
                .contentMargins(.top, chatHeaderClearance, for: .scrollContent)
                .contentMargins(.bottom, 24, for: .scrollContent)
            }
        } else {
            messageTimeline(cards: cards)
        }
    }

    private func loadChat() async {
        await state.loadConversation(conversation, using: GatewayClient(configuration: configuration))
        if let conversation, state.unavailableConversationID == conversation.id, !Task.isCancelled {
            await onConversationUnavailable(conversation.id)
        }
    }

    private func scheduleBottomScroll(_ scroller: ScrollViewProxy) {
        guard isActive, !sidebarOpen, followingBottom, !userScrollingMessages,
              bottomJumpID == nil, readingHistory.bottomScrollTask == nil else { return }
        readingHistory.bottomScrollTask = Task {
            do { try await Task.sleep(for: .milliseconds(16)) } catch { return }
            readingHistory.bottomScrollTask = nil
            guard isActive, !sidebarOpen, followingBottom, !userScrollingMessages, bottomJumpID == nil else { return }
            if #available(iOS 18, *) {
                timelineScrollCommands.scrollToBottom()
            } else {
                var transaction = Transaction()
                transaction.disablesAnimations = true
                withTransaction(transaction) { scroller.scrollTo("chat-bottom", anchor: .bottom) }
            }
        }
    }

    private func messageTimeline(cards: [String: [GeneratedMediaCard]]) -> some View {
        GeometryReader { viewport in
            let maximumMessageWidth = ChatAppearance.maximumMessageWidth(in: viewport.size.width)
            ScrollViewReader { scroller in
                ScrollView {
                    timelineContent(cards: cards, maximumMessageWidth: maximumMessageWidth,
                                    viewportHeight: viewport.size.height, scroller: scroller)
                }
                .modifier(ChatTimelineAlignment(commands: timelineScrollCommands) { finishBottomJump($0, scroller: scroller) })
                .accessibilityIdentifier("chat-message-timeline")
                .contentMargins(.top, chatHeaderClearance, for: .scrollContent)
                .contentMargins(.bottom, 24, for: .scrollContent)
                .coordinateSpace(name: "chat-scroll")
                .onDisappear {
                    bottomJumpID = nil
                    readingHistory.bottomScrollTask?.cancel(); readingHistory.bottomScrollTask = nil
                }
                .onChange(of: state.isLoadingHistory, initial: true) {
                    restoreTimeline(scroller)
                }
                .onChange(of: state.messages.last) {
                    restoreTimeline(scroller)
                    scheduleBottomScroll(scroller)
                }
                .onChange(of: chatHeaderClearance) { scheduleBottomScroll(scroller) }
                .onChange(of: followingBottom) { scheduleBottomScroll(scroller) }
                .onChange(of: sidebarOpen) {
                    if sidebarOpen {
                        readingHistory.bottomScrollTask?.cancel()
                        readingHistory.bottomScrollTask = nil
                    } else {
                        scheduleBottomScroll(scroller)
                    }
                }
                .onChange(of: viewport.size.height, initial: true) {
                    timelineHeight = viewport.size.height
                    restoreTimeline(scroller)
                    scheduleBottomScroll(scroller)
                }
                .onChange(of: scrollToLatestToken) {
                    guard scrollToLatestToken > 0, isActive else { return }
                    scrollToLatestMessage(scroller)
                }
                .modifier(timelineScrollInteraction())
                .overlay(alignment: .bottom) { jumpToBottomButton(scroller) }
            }
        }
    }

    private func timelineScrollInteraction() -> ChatScrollInteraction {
        ChatScrollInteraction(onStart: {
            if !userScrollingMessages {
                readingHistory.towardLatest = false
            }
            bottomJumpID = nil
            userScrollingMessages = true
            followingBottom = false
            readingHistory.bottomScrollTask?.cancel(); readingHistory.bottomScrollTask = nil
        }, onEnd: {
            guard userScrollingMessages else { return }
            followingBottom = readingHistory.towardLatest && isAtBottom
            userScrollingMessages = false
            if followingBottom, let scope = timelineReadingScope {
                readingHistory.removeAnchor(for: scope)
            }
        }, onDirectionChange: { towardLatest in
            if userScrollingMessages {
                readingHistory.towardLatest = towardLatest
            }
        }, onBottomChange: { isAtBottom = $0 })
    }

    @ViewBuilder
    private func jumpToBottomButton(_ scroller: ScrollViewProxy) -> some View {
        if positionedTimeline, !followingBottom, !isAtBottom {
            Button {
                guard bottomJumpID == nil else { return }
                readingHistory.bottomScrollTask?.cancel(); readingHistory.bottomScrollTask = nil
                userScrollingMessages = false
                followingBottom = true
                if let scope = timelineReadingScope {
                    readingHistory.removeAnchor(for: scope)
                }
                let jumpID = UUID()
                bottomJumpID = jumpID
                if #available(iOS 18, *) {
                    timelineScrollCommands.scrollToBottom(jumpID: jumpID)
                } else {
                    withAnimation(reduceMotion ? nil : .easeInOut(duration: 0.3)) {
                        scroller.scrollTo("chat-bottom", anchor: .bottom)
                    } completion: {
                        finishBottomJump(jumpID, scroller: scroller)
                    }
                }
            } label: {
                Group {
                    if state.isRunActive {
                        LoopiIcon(size: 20, active: true, compact: true, working: true)
                    } else {
                        Image(systemName: "arrow.down").font(.system(size: 18, weight: .medium))
                    }
                }
                .frame(width: 36, height: 36)
                .background(.regularMaterial, in: .circle)
                .frame(width: 44, height: 44).contentShape(.circle)
            }
            .buttonStyle(.plain)
            .accessibilityLabel("回到最新消息")
            .accessibilityValue(AppLocalization.string(state.isRunActive ? "正在回答" : "最新消息", locale: locale))
            .accessibilityIdentifier("chat-jump-bottom")
            .padding(.bottom, 8)
        }
    }

    private func scrollToLatestMessage(_ scroller: ScrollViewProxy) {
        readingHistory.bottomScrollTask?.cancel()
        readingHistory.bottomScrollTask = nil
        userScrollingMessages = false
        followingBottom = true
        if let scope = timelineReadingScope {
            readingHistory.removeAnchor(for: scope)
        }
        let jumpID = UUID()
        bottomJumpID = jumpID
        if #available(iOS 18, *) {
            timelineScrollCommands.scrollToBottom(jumpID: jumpID)
        } else {
            withAnimation(MobileMotion.animation(MobileMotion.standardDuration, reduceMotion: reduceMotion)) {
                scroller.scrollTo("chat-bottom", anchor: .bottom)
            } completion: {
                finishBottomJump(jumpID, scroller: scroller)
            }
        }
    }

    private func finishBottomJump(_ id: UUID, scroller: ScrollViewProxy) {
        guard bottomJumpID == id else { return }
        bottomJumpID = nil
        scheduleBottomScroll(scroller)
    }

    private func timelineContent(cards: [String: [GeneratedMediaCard]], maximumMessageWidth: CGFloat,
                                 viewportHeight: CGFloat, scroller: ScrollViewProxy) -> some View
    {
        Group {
            if #available(iOS 18, *) {
                LazyVStack(spacing: 20) {
                    timelineRows(cards: cards, maximumMessageWidth: maximumMessageWidth,
                                 viewportHeight: viewportHeight, scroller: scroller)
                }
            } else {
                VStack(spacing: 20) {
                    timelineRows(cards: cards, maximumMessageWidth: maximumMessageWidth,
                                 viewportHeight: viewportHeight, scroller: scroller)
                }
            }
        }
        .coordinateSpace(name: "chat-timeline-content")
        .padding(.horizontal, ChatAppearance.timelineHorizontalPadding)
        .padding(.vertical, 16)
        .frame(maxWidth: 720)
        .frame(maxWidth: .infinity)
    }

    @ViewBuilder private func timelineRows(cards: [String: [GeneratedMediaCard]], maximumMessageWidth: CGFloat,
                                           viewportHeight: CGFloat, scroller: ScrollViewProxy) -> some View
    {
        let layout = TimelineLayout(messageWidth: maximumMessageWidth, viewportHeight: viewportHeight,
                                    headerClearance: chatHeaderClearance)
        let readingScope = userScrollingMessages ? timelineReadingScope : nil
        if let errorMessage = state.errorMessage {
            ErrorBanner(message: errorMessage)
        }
        personalConnectionCard
        ForEach(state.messages.filter { $0.role != "assistant" || $0.answerConfirmed }, id: \.scrollID) { message in
            timelineMessageRow(message, media: cards[message.id] ?? [], layout: layout, readingScope: readingScope)
        }
        if let unanchored = cards[""] {
            generatedMediaRows(unanchored, maximumWidth: maximumMessageWidth, viewportHeight: viewportHeight)
        }
        if showsStagedProgress {
            AssistantStagesView(progress: state.runProgress,
                                answerStarted: state.messages.contains {
                                    $0.role == "assistant" && $0.turnId == state.runProgress.runID && $0.answerConfirmed && !$0.text.isEmpty
                                }, paused: state.clarification != nil, connected: canSendOnChatConnection)
                .id(state.runProgress.runID ?? "sending")
        } else if isPersonalConversation, state.isRunActive, state.errorMessage == nil, state.clarification == nil,
                  !state.messages.contains(where: { $0.role == "assistant" && $0.turnId == state.runID && $0.answerConfirmed && !$0.text.isEmpty })
        {
            AssistantActivityView(connected: canSendOnChatConnection)
                .id(state.runID ?? "sending")
        }
        timelineBottomMarker(scroller: scroller, viewportHeight: viewportHeight)
    }

    @ViewBuilder
    private func timelineBottomMarker(scroller: ScrollViewProxy, viewportHeight: CGFloat) -> some View {
        let marker = Color.clear.frame(height: 1)
            .id("chat-bottom")
            .onGeometryChange(for: CGFloat.self) { proxy in
                proxy.frame(in: .named("chat-timeline-content")).maxY
            } action: { _ in
                scheduleBottomScroll(scroller)
            }

        if #available(iOS 18, *) {
            marker
        } else {
            marker.onGeometryChange(for: Bool.self) { proxy in
                proxy.frame(in: .named("chat-scroll")).maxY <= viewportHeight + 24
            } action: { atBottom in
                isAtBottom = atBottom
            }
            .onDisappear { isAtBottom = false }
        }
    }

    private struct TimelineLayout {
        let messageWidth: CGFloat
        let viewportHeight: CGFloat
        let headerClearance: CGFloat
    }

    private func timelineMessageRow(_ message: TimelineMessage, media: [GeneratedMediaCard],
                                    layout: TimelineLayout,
                                    readingScope: String?) -> some View
    {
        let headerClearance = layout.headerClearance
        return VStack(spacing: 20) {
            MessageBubble(
                message: message,
                configuration: configuration,
                conversationID: conversation?.isDraft == false ? conversation?.id : nil,
                assistantState: state,
                readAloud: readAloud,
                canReadAloud: realtimeVoiceCall.phase == .idle,
                previewEligible: message.id != state.messages.last?.id,
                onReuseUserText: { draft = $0 },
                maximumWidth: layout.messageWidth,
                animateStreaming: message.revealAnswer && followingBottom && !sidebarOpen && !userScrollingMessages,
                onReading: {
                    followingBottom = false
                    readingHistory.bottomScrollTask?.cancel(); readingHistory.bottomScrollTask = nil
                }
            )
            generatedMediaRows(media, maximumWidth: layout.messageWidth,
                               viewportHeight: layout.viewportHeight)
        }
        .id(message.scrollID)
        .onGeometryChange(for: CGRect?.self) { geometry in
            guard readingScope != nil else { return nil }
            let frame = geometry.frame(in: .named("chat-scroll"))
            return frame.minY <= headerClearance + 20 && frame.maxY > headerClearance ? frame : nil
        } action: { frame in
            if let frame, userScrollingMessages, let readingScope {
                readingHistory.saveAnchor(
                    ChatReadingAnchor(id: message.scrollID, offset: frame.minY - headerClearance, rowHeight: frame.height),
                    for: readingScope
                )
            }
        }
    }

    @ViewBuilder
    private func generatedMediaRows(_ cards: [GeneratedMediaCard], maximumWidth: CGFloat, viewportHeight: CGFloat) -> some View {
        if let id = conversation?.id, conversation?.isDraft == false, !cards.isEmpty {
            let headerClearance = chatHeaderClearance
            VStack(spacing: 12) {
                ForEach(cards) { card in
                    GeneratedMediaRow(card: card, canConfirm: generatedMedia.canConfirm && !state.isRunActive,
                                      submitting: generatedMedia.submitting, error: card.isDraft ? generatedMedia.error : nil,
                                      isMusicPlaying: card.kind == .music && music.track?.id == card.id
                                          && music.track?.conversationID == id && music.phase == .playing,
                                      onPlay: { playGeneratedMedia(card, conversationID: id) },
                                      onOpen: {
                                          if card.kind == .video {
                                              playGeneratedMedia(card, conversationID: id)
                                          } else {
                                              let track = musicTrack(card, conversationID: id)
                                              music.openPreview(track, streaming: {
                                                  try await GatewayClient(configuration: configuration)
                                                      .mediaPlaybackURL(path: card.artifactPath(id))
                                              }) {
                                                  try await GatewayClient(configuration: configuration)
                                                      .downloadGeneratedMedia(card, conversationID: id)
                                              }
                                          }
                                      }, onConfirm: {
                                          Task { await generatedMedia.confirm(card, conversationID: id, client: GatewayClient(configuration: configuration)) }
                                      })
                                      .frame(maxWidth: maximumWidth)
                                      .onGeometryChange(for: Bool.self) { proxy in
                                          let frame = proxy.frame(in: .named("chat-scroll"))
                                          return frame.maxY > headerClearance && frame.minY < viewportHeight
                                      } action: { visible in
                                          guard card.kind == .music else { return }
                                          if visible {
                                              visibleMusicCardIDs.insert(card.id)
                                          } else {
                                              visibleMusicCardIDs.remove(card.id)
                                          }
                                      }
                                      .onDisappear { visibleMusicCardIDs.remove(card.id) }
                                      .frame(maxWidth: .infinity, alignment: .leading)
                                      .id("generated-media-\(card.id)")
                }
            }
        }
    }

    private func musicTrack(_ card: GeneratedMediaCard, conversationID: String) -> GeneratedMusicTrack {
        GeneratedMusicTrack(configurationScope: ComposerDraftStore.accountScope(configuration),
                            conversationID: conversationID, id: card.id, title: card.title,
                            source: conversationNavigationTitle, lyrics: card.item.lyrics,
                            duration: card.item.durationMs.map { Double($0) / 1000 },
                            sourceAgentID: conversation?.agentId)
    }

    private func playGeneratedMedia(_ card: GeneratedMediaCard, conversationID: String) {
        readAloud.stop()
        assistantAudio.stop()
        readingHistory.bottomScrollTask?.cancel()
        readingHistory.bottomScrollTask = nil
        followingBottom = false
        if card.kind == .music {
            presentedGeneratedVideo = nil
            let track = musicTrack(card, conversationID: conversationID)
            music.play(track, streaming: {
                try await GatewayClient(configuration: configuration).mediaPlaybackURL(path: card.artifactPath(conversationID))
            }) {
                try await GatewayClient(configuration: configuration).downloadGeneratedMedia(card, conversationID: conversationID)
            }
        } else {
            music.yieldAudioSession()
            presentedGeneratedVideo = card
        }
    }

    private struct ChatReadingAnchor {
        let id: String
        let offset: CGFloat
        let rowHeight: CGFloat
    }

    private var timelineReadingScope: String? {
        guard let id = conversation?.id else { return nil }
        let transcript = state.historyTranscriptID(for: conversation) ?? ""
        return "\(ComposerDraftStore.accountScope(configuration))|\(id)|\(transcript)"
    }

    /// Scroll callbacks update this cache without invalidating the message hierarchy.
    private final class ChatReadingHistory {
        var towardLatest = false
        var bottomScrollTask: Task<Void, Never>?
        private var anchors: [String: ChatReadingAnchor] = [:]

        func anchor(for scope: String) -> ChatReadingAnchor? {
            anchors[scope]
        }

        func removeAnchor(for scope: String) {
            anchors.removeValue(forKey: scope)
        }

        func saveAnchor(_ anchor: ChatReadingAnchor, for scope: String) {
            if anchors[scope] == nil, anchors.count >= 50, let key = anchors.keys.first {
                anchors.removeValue(forKey: key)
            }
            anchors[scope] = anchor
        }
    }

    private func resetTimelineIfNeeded() {
        let conversationID = conversation?.id
        guard timelineConversationID != conversationID else { return }
        timelineConversationID = conversationID
        isAtBottom = true
        followingBottom = true
        positionedTimeline = false
        userScrollingMessages = false
        bottomJumpID = nil
        readingHistory.bottomScrollTask?.cancel()
        readingHistory.bottomScrollTask = nil
    }

    private func restoreTimeline(_ scroller: ScrollViewProxy) {
        resetTimelineIfNeeded()
        guard !positionedTimeline, !state.isLoadingHistory, let id = conversation?.id,
              state.isCurrentConversation(id), !state.messages.isEmpty else { return }
        positionedTimeline = true
        let draftScope = "\(ComposerDraftStore.accountScope(configuration))|\(id)|"
        if let scope = timelineReadingScope, let saved = readingHistory.anchor(for: scope) ?? readingHistory.anchor(for: draftScope),
           state.messages.contains(where: { $0.scrollID == saved.id })
        {
            followingBottom = false
            let travel = timelineHeight - chatHeaderClearance - 24 - saved.rowHeight
            let alignment = abs(travel) > 1 ? saved.offset / travel : 0
            scroller.scrollTo(saved.id, anchor: UnitPoint(x: 0.5, y: alignment))
        } else {
            scheduleBottomScroll(scroller)
        }
    }

    func followLatestAfterSend() {
        bottomJumpID = nil
        followingBottom = true
        if let scope = timelineReadingScope {
            readingHistory.removeAnchor(for: scope)
        }
    }

    private var conversationNavigationTitle: String {
        if isPersonalConversation {
            return personalAgent?.displayName ?? "Ada"
        }
        if conversation?.isDraft == true {
            if let agent = state.agents.first(where: { $0.id == conversation?.agentId }), agent.id != "main" {
                return agent.localizedName(locale)
            }
            return AppLocalization.string("新对话", locale: locale)
        }
        guard let title = conversation?.title, !showsConversationTitleInTimeline else {
            return AppLocalization.string("助手", locale: locale)
        }
        return title
    }

    private var showsConversationTitleInTimeline: Bool {
        guard let title = conversation?.title else { return false }
        return title.count > 14
    }

    private var isPersonalConversation: Bool {
        personalAgent?.isReady == true && conversation?.id == personalAgent?.conversationId
    }

    private var showsStagedProgress: Bool {
        !isPersonalConversation && (state.isRunActive || state.runProgress.terminalStatus != nil)
    }

    private var currentAgent: AgentSummary? {
        state.agents.first(where: { $0.id == conversation?.agentId }) ?? state.selectedAgent
    }

    private var currentAgentName: String {
        isPersonalConversation
            ? (personalAgent?.displayName ?? "Ada")
            : (currentAgent?.localizedName(locale) ?? AppLocalization.string("未选择", locale: locale))
    }

    private var currentModelParts: ChatHeaderModelParts? {
        let modelName = options.selectedModel?.localizedName(locale)
            ?? options.selectedModelID.split(separator: "/").last.map(String.init)
        return ChatHeaderPresentation.modelSubtitleParts(
            modelName: modelName,
            thinkingMode: options.selectedModel?.thinking?.mode,
            thinkingLevel: options.thinkingLevel,
            isFastEnabled: options.isFastModeEnabled,
            locale: locale
        )
    }

    private var currentModelSubtitle: String? {
        currentModelParts?.fullText
    }

    private var currentProjectTitle: String? {
        let fromSummary = state.contextSummary?.work.project?.title.trimmingCharacters(in: .whitespacesAndNewlines)
        if let fromSummary, !fromSummary.isEmpty {
            return fromSummary
        }
        let fromDraft = draftProjectName?.trimmingCharacters(in: .whitespacesAndNewlines)
        if let fromDraft, !fromDraft.isEmpty {
            return fromDraft
        }
        return nil
    }

    private var chatContextStrip: ChatContextStripModel? {
        guard !isPersonalConversation else { return nil }
        let work = state.contextSummary?.work
        let env = state.contextSummary?.environment
        return ChatHeaderPresentation.contextStrip(.init(
            projectTitle: currentProjectTitle,
            taskTitle: work?.task?.title,
            taskPhase: work?.task?.phase,
            delegatedTaskCount: work?.delegatedTaskCount ?? 0,
            delegatedTasks: work?.delegatedTasks,
            environmentKind: env?.kind ?? conversation?.executionMode,
            branch: env?.branch,
            locale: locale
        ))
    }

    private var readAloudObservation: ChatSpeechObservation? {
        guard isActive, let conversation, !conversation.isDraft, !state.isLoadingHistory,
              state.isCurrentConversation(conversation.id) else { return nil }
        let scope = ChatSpeechScope(configuration: configuration, conversationID: conversation.id,
                                    transcriptID: state.historyTranscriptID(for: conversation))
        let replies = state.messages.compactMap { message -> ChatSpeechReply? in
            guard message.role == "assistant", !message.isPending, message.answerConfirmed, !message.text.isEmpty,
                  state.runID == nil || message.turnId != state.runID,
                  !message.attachments.contains(where: \.isAudio) else { return nil }
            return ChatSpeechReply(id: message.id, text: message.text)
        }
        return ChatSpeechObservation(scope: scope, replies: replies)
    }

    private var assistantAudioObservation: AssistantAudioObservation {
        let audioMessage = state.messages.reversed().first {
            $0.role == "assistant" && $0.attachments.contains(where: \.isAudio)
        }
        let attachment = audioMessage?.attachments.reversed().first(where: \.isAudio)
        let key = attachment.map { "\(conversation?.id ?? ""):\(audioMessage?.id ?? ""):\($0.id)" }
        return AssistantAudioObservation(
            conversationID: conversation?.isDraft == false ? conversation?.id : nil,
            streaming: state.runID != nil,
            enabled: isActive && !state.isLoadingHistory && realtimeVoiceCall.phase == .idle
                && (readAloud.state == .idle || readAloud.state == .waiting),
            attachment: attachment,
            key: key
        )
    }

    private var readAloudBar: some View {
        HStack(spacing: 12) {
            Image(systemName: "speaker.wave.2.fill")
                .foregroundStyle(.tint)
            VStack(alignment: .leading, spacing: 2) {
                Text(readAloud.state == .waiting
                    ? LocalizedStringResource("等待下一条回复")
                    : LocalizedStringResource("正在朗读"))
                    .mobileTextStyle(.secondary).fontWeight(.semibold)
                if let error = readAloud.errorMessage {
                    Text(error).mobileTextStyle(.caption).foregroundStyle(mobileTheme.danger).lineLimit(2)
                } else if readAloud.state != .waiting {
                    Text("\(readAloud.chunkIndex + 1)/\(readAloud.chunkCount)")
                        .mobileTextStyle(.caption).foregroundStyle(.secondary)
                }
            }
            Spacer(minLength: 8)
            if readAloud.state == .playing || readAloud.state == .paused {
                Button {
                    readAloud.toggle(id: readAloud.sourceID ?? "", text: "", locale: locale, gateway: GatewayClient(configuration: configuration))
                } label: {
                    Label {
                        Text(readAloud.state == .playing
                            ? LocalizedStringResource("暂停朗读")
                            : LocalizedStringResource("继续朗读"))
                    } icon: {
                        Image(systemName: readAloud.state == .playing ? "pause.fill" : "play.fill")
                    }
                }
                .labelStyle(.iconOnly)
                .accessibilityIdentifier("chat-read-aloud-toggle")
            }
            Button("停止朗读", systemImage: "stop.fill") { readAloud.stop() }
                .labelStyle(.iconOnly)
                .accessibilityIdentifier("chat-read-aloud-stop")
        }
        .padding(.horizontal, 20)
        .padding(.vertical, 10)
        .frame(maxWidth: 720)
        .background(.regularMaterial)
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("chat-read-aloud-bar")
    }

    private var welcome: some View {
        VStack(spacing: 18) {
            if !isPersonalConversation {
                ConfiguredAgentAvatar(
                    configuration: configuration,
                    agent: currentAgent,
                    size: 52,
                    active: isActive,
                    resolveUnconfigured: false
                )
            }
            Text(verbatim: isPersonalConversation
                ? (locale.language.languageCode?.identifier == "zh"
                    ? "你好，我是\(personalAgent?.displayName ?? "Ada")。" : "Hi, I'm \(personalAgent?.displayName ?? "Ada").")
                : (locale.language.languageCode?.identifier == "zh"
                    ? "今天想聊点什么？" : "What’s on your mind?"))
                .font(.system(size: 20, weight: .medium))
                .multilineTextAlignment(.center)
            if isPersonalConversation {
                Text(locale.language.languageCode?.identifier == "zh"
                    ? "想聊一件事、理清思路，或让我帮你推进工作，都可以直接说。"
                    : "Tell me what is on your mind, or what you would like to move forward.")
                    .mobileTextStyle(.secondary)
                    .foregroundStyle(.secondary)
                    .multilineTextAlignment(.center)
            } else if showsFloatingHeader {
                DraftQuickSetupChips(
                    configuration: configuration,
                    agent: currentAgent,
                    agentName: currentAgentName,
                    modelLabel: currentModelSubtitle,
                    projectTitle: currentProjectTitle,
                    onSelectAgent: { showingAgentPicker = true },
                    onSelectModel: {
                        sessionSheetDestination = .model
                        showingSessionActions = true
                    },
                    onSelectProject: {
                        sessionSheetDestination = .project
                        showingSessionActions = true
                    }
                )
            }
        }
        .padding(.vertical, 28)
        .frame(maxWidth: .infinity)
    }

    private var suggestionKey: NextTurnObservationKey {
        let eligible = isActive && scenePhase == .active && !sidebarOpen && !showingPhone && !startingVoice
            && !voiceMode && !isActionPanelExpanded && !state.isLoadingHistory && !state.isSending && !state.isRunActive
            && state.clarification == nil && draft.isEmpty
            && attachments.isEmpty && references.isEmpty && !showingPhotoPicker && !showingFilePicker
            && !showingCameraPicker && !showingReferencePicker
        let target = conversation.flatMap {
            !$0.isDraft && state.isCurrentConversation($0.id) &&
                composerDraftScope == ComposerDraftStore.scope(configuration, conversationID: $0.id) ? $0 : nil
        }
        return .init(configuration: configuration, conversationID: eligible ? target?.id : nil,
                     transcriptID: eligible ? state.historyTranscriptID(for: target) : nil,
                     locale: locale.language.languageCode?.identifier == "zh" ? "zh" : "en",
                     revision: state.suggestionRevision)
    }

    private var composer: AssistantComposer {
        let key = suggestionKey
        let suggestion = state.visibleNextTurnSuggestion(using: configuration).flatMap { item in
            item.conversationId == key.conversationID && item.transcriptId == key.transcriptID &&
                item.locale == key.locale && item.isCurrent ? item : nil
        }
        return AssistantComposer(
            configuration: configuration,
            focusAllowed: !sidebarOpen && !showingPhone && !startingVoice && !state.isLoadingHistory && state.clarification?.kind != "approval",
            connectionReady: canSendOnChatConnection,
            personalName: isPersonalConversation ? personalAgent?.displayName : nil,
            suggestion: suggestion,
            onAcceptSuggestion: { item in
                guard draft.isEmpty, suggestionKey == key, item == suggestion,
                      let text = state.acceptNextTurnSuggestion(item, using: configuration) else { return }
                draft = text
            },
            draft: $draft,
            attachments: $attachments,
            references: $references,
            showingPhotoPicker: $showingPhotoPicker,
            showingFilePicker: $showingFilePicker,
            showingCameraPicker: $showingCameraPicker,
            voiceMode: $voiceMode,
            showingReferencePicker: $showingReferencePicker,
            referenceKind: $referenceKind,
            isActionPanelExpanded: $isActionPanelExpanded,
            attachmentError: $attachmentError,
            canReferenceFiles: conversation?.isDraft == false,
            onSwitchAgent: showsFloatingHeader && !isPersonalConversation ? { showingAgentPicker = true } : nil,
            showsVoiceCallInPanel: showsFloatingHeader && !isPersonalConversation,
            canStartVoiceCall: canStartRealtimeVoice,
            onStartVoiceCall: { startRealtimeVoice() },
            isRunActive: state.isRunActive,
            isStopping: state.isStopping,
            onInputFocusChanged: onInputFocusChanged,
            onStop: {
                Task { await state.stop(using: GatewayClient(configuration: configuration)) }
            },
            onSend: { send() },
            onVoiceStart: {
                music.yieldAudioSession()
                readAloud.stop()
                assistantAudio.stop()
                presentedGeneratedVideo = nil
            },
            onVoiceAttachment: { send(voice: $0) },
            isComposerFocused: $composerFocused
        )
    }

    private var canStartRealtimeVoice: Bool {
        conversation != nil && !startingVoice && !state.isSending && realtimeVoiceCall.phase == .idle
    }

    private func startRealtimeVoice() {
        guard canStartRealtimeVoice, let conversation else { return }
        music.yieldAudioSession()
        isActionPanelExpanded = false
        startingVoice = true
        Task {
            defer { startingVoice = false }
            let gateway = GatewayClient(configuration: configuration)
            let selected: ConversationSelection
            do {
                let commandID = voiceMaterializationIDs[conversation.id]
                    ?? UUID().uuidString.lowercased()
                voiceMaterializationIDs[conversation.id] = commandID
                selected = try await gateway.materializeVoiceConversation(conversation, commandID: commandID)
            } catch {
                voiceStartError = error.localizedDescription
                return
            }
            voiceMaterializationIDs.removeValue(forKey: conversation.id)
            if selected.isDraft == false, conversation.isDraft {
                onConversationUpdated(selected)
            }
            readAloud.stop()
            await realtimeVoiceCall.start(
                conversationID: selected.id,
                mode: .automatic,
                name: selected.title,
                gateway: gateway
            )
        }
    }

    private func requestConversation(_ agentID: String) {
        requestStart(.agent(agentID))
    }

    private func requestStart(_ start: PendingConversationStart) {
        if !draft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || !attachments.isEmpty || !references.isEmpty {
            pendingStart = start
        } else {
            performStart(start)
        }
    }

    private func performStart(_ start: PendingConversationStart) {
        switch start {
        case let .agent(id):
            if let agent = state.agents.first(where: { $0.id == id }) {
                state.select(agent)
            }
            onStartConversation(id)
        case let .scoped(project, mode, agent): onStartScopedConversation(project, mode, agent)
        }
    }

    private var compactPersonalHeader: Bool {
        isPersonalConversation && !state.messages.isEmpty && positionedTimeline && ((!followingBottom && !isAtBottom) || composerFocused)
    }

    private var chatHeaderIdentity: ChatHeaderIdentityModel {
        ChatHeaderPresentation.headerIdentity(.init(
            conversationTitle: showsSessionConversationTitle ? conversation?.title : nil,
            isDraft: conversation?.isDraft ?? true,
            agentID: currentAgent?.id ?? conversation?.agentId ?? state.selectedAgentID,
            defaultAgentID: state.defaultAgentID,
            agentName: currentAgentName,
            runtimeBadge: currentAgent?.externalRuntimeBadge,
            modelParts: currentModelParts
        ))
    }

    private var floatingHeader: some View {
        VStack(alignment: isPersonalConversation ? .center : .leading, spacing: isPersonalConversation ? 6 : 8) {
            ZStack(alignment: .top) {
                HStack(spacing: isPersonalConversation ? 6 : 8) {
                    if let onBack {
                        headerButton("返回", icon: Image(systemName: "chevron.backward"), action: onBack)
                            .accessibilityIdentifier(backAccessibilityID)
                    }
                    if let onOpenSidebar {
                        headerButton("打开导航", icon: Image(systemName: "line.3.horizontal"), action: onOpenSidebar)
                            .accessibilityIdentifier("chat-header-sidebar")
                    }
                    if phone.summary?.available == true, isPersonalConversation {
                        phoneWorkspaceButton
                    }
                    if !isPersonalConversation {
                        ChatHeaderIdentityButton(
                            configuration: configuration,
                            agent: currentAgent,
                            identity: chatHeaderIdentity,
                            isActive: isActive && !showingMessageSearch
                        ) {
                            sessionSheetDestination = .actions
                            showingSessionActions = true
                        }
                        .frame(maxWidth: .infinity, alignment: .leading)
                    } else {
                        Spacer(minLength: 0)
                    }
                    if phone.summary?.available == true, !isPersonalConversation {
                        phoneWorkspaceButton
                    }
                    if isPersonalConversation {
                        headerButton("语音通话", icon: Image(systemName: "phone"), action: startRealtimeVoice)
                            .disabled(!canStartRealtimeVoice)
                            .accessibilityIdentifier("chat-header-voice-call")
                    }
                }
                if isPersonalConversation {
                    personalFloatingCenterHeader
                }
            }
            if !isPersonalConversation {
                let contextStrip = chatContextStrip
                let targetWithName: (DesktopChatTarget, String)? = desktopChatTarget.flatMap { target in
                    target.deviceName.map { (target, $0) }
                }
                if contextStrip != nil || targetWithName != nil {
                    ScrollView(.horizontal, showsIndicators: false) {
                        HStack(spacing: 6) {
                            if let contextStrip {
                                ChatContextStripButton(model: contextStrip) {
                                    sessionSheetDestination = .context
                                    showingSessionActions = true
                                }
                            }
                            if let (target, name) = targetWithName {
                                desktopTargetBadge(target, name: name)
                            }
                        }
                    }
                }
            }
        }
        .animation(MobileMotion.animation(MobileMotion.standardDuration, reduceMotion: reduceMotion), value: compactPersonalHeader)
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("chat-floating-header")
    }

    @ViewBuilder
    private var personalFloatingCenterHeader: some View {
        if compactPersonalHeader {
            Button {
                onOpenPersonalOverview(conversation?.isDraft == false && !state.messages.isEmpty)
            } label: {
                HStack(spacing: 8) {
                    PersonalAgentAvatar(configuration: configuration, agent: personalAgent, size: 28,
                                        active: isActive && !showingMessageSearch,
                                        working: state.isRunActive || state.isSending)
                        .accessibilityHidden(true)
                    Text(verbatim: currentAgentName)
                        .font(.subheadline.weight(.semibold))
                        .foregroundStyle(mobileTheme.foreground)
                        .lineLimit(1)
                    if pendingAttention > 0 {
                        Circle()
                            .fill(mobileTheme.onAttention)
                            .frame(width: 6, height: 6)
                            .accessibilityHidden(true)
                    }
                }
                .padding(.horizontal, 12)
                .frame(minHeight: 44)
                .background(mobileTheme.card, in: Capsule())
            }
            .buttonStyle(.plain)
            .accessibilityLabel("助理概览")
            .accessibilityIdentifier("chat-header-personal")
        } else {
            VStack(spacing: 4) {
                Button {
                    onOpenPersonalOverview(conversation?.isDraft == false && !state.messages.isEmpty)
                } label: {
                    VStack(spacing: 4) {
                        PersonalAgentAvatar(configuration: configuration, agent: personalAgent, size: 62,
                                            active: isActive && !showingMessageSearch,
                                            working: state.isRunActive || state.isSending)
                            .background(mobileTheme.card, in: Circle())
                            .accessibilityHidden(true)
                    }
                    .frame(maxWidth: 120)
                }
                .buttonStyle(.plain)
                .accessibilityLabel("助理概览")
                .accessibilityIdentifier("chat-header-personal")
                if pendingAttention > 0 {
                    Button(action: onOpenProgress) {
                        VStack(spacing: 2) {
                            Text(verbatim: currentAgentName).font(.headline).lineLimit(1)
                            Label {
                                Text("有 \(pendingAttention) 项待你处理").lineLimit(1)
                            } icon: { Circle().fill(mobileTheme.onAttention).frame(width: 6, height: 6) }
                                .font(.caption).foregroundStyle(mobileTheme.onAttention)
                        }
                        .padding(.horizontal, 12).frame(minHeight: 44)
                        .background(mobileTheme.attention, in: .rect(cornerRadius: mobileTheme.corner(15)))
                    }
                    .buttonStyle(.plain)
                    .accessibilityIdentifier("chat-header-attention")
                } else {
                    Text(verbatim: currentAgentName).font(.headline).lineLimit(1)
                        .foregroundStyle(mobileTheme.foreground)
                        .padding(.horizontal, 12).padding(.vertical, 4)
                        .background(mobileTheme.card, in: .rect(cornerRadius: mobileTheme.corner(14)))
                }
            }
        }
    }

    private var phoneWorkspaceButton: some View {
        headerButton("查看手机", icon: Image(systemName: "iphone")) { showingPhone = true }
            .overlay(alignment: .topTrailing) {
                if phone.needsAttention {
                    Circle().fill(mobileTheme.onAttention).frame(width: 6, height: 6).padding(6).allowsHitTesting(false)
                }
            }
            .accessibilityIdentifier("chat-header-phone")
    }

    private func headerButton(_ title: LocalizedStringKey, icon: Image, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            icon.font(.title3).frame(width: 44, height: 44)
                .foregroundStyle(mobileTheme.foreground)
                .contentShape(.rect)
        }
        .buttonStyle(MobilePressStyle(radius: 22, restingBackground: mobileTheme.card))
        .accessibilityLabel(title)
    }
}

private struct ChatScrollEdgeEffect: ViewModifier {
    func body(content: Content) -> some View {
        if #available(iOS 26, *) {
            content.scrollEdgeEffectHidden(true, for: .top)
        } else {
            content
        }
    }
}

// swiftlint:disable:next type_body_length
struct PersonalAgentProfileView: View {
    @Environment(\.mobileTheme) private var mobileTheme
    let configuration: GatewayConfiguration
    let conversation: ConversationSelection
    let onSaved: (PersonalAgentRecord) -> Void
    let onModelSaved: (ConversationSelection) -> Void
    let allowsConversationSharing: Bool

    @Environment(\.dismiss) private var dismiss
    @Environment(\.locale) private var locale
    @State private var record: PersonalAgentRecord
    @State private var name: String
    @State private var appearance: String
    @State private var callMode: PersonalCallMode
    @State private var voiceExpanded = false
    @State private var choosingCallMode = false
    @State private var greetingEnabled: Bool
    @State private var selectedVoice: String
    @State private var voiceProvider: String?
    @State private var voiceModel: String?
    @State private var voiceOptions: [PersonalVoiceOption] = []
    @State private var avatarItem: PhotosPickerItem?
    @State private var avatarPreview: UIImage?
    @State private var uploadingAvatar = false
    @State private var showingShare = false
    @State private var loadingVoices = true
    @State private var loadingProfile = true
    @State private var loadedProfile = false
    @State private var saving = false
    @State private var modelOptions = AssistantOptionsState()
    @State private var modelPickerOpen = false
    @State private var nameSaveTask: Task<Void, Never>?
    @State private var error: String?

    init(configuration: GatewayConfiguration, record: PersonalAgentRecord, conversation: ConversationSelection,
         onSaved: @escaping (PersonalAgentRecord) -> Void,
         onModelSaved: @escaping (ConversationSelection) -> Void = { _ in }, allowsConversationSharing: Bool = false)
    {
        self.configuration = configuration
        self.conversation = conversation
        self.onSaved = onSaved
        self.onModelSaved = onModelSaved
        self.allowsConversationSharing = allowsConversationSharing
        _record = State(initialValue: record)
        _name = State(initialValue: record.displayName)
        _appearance = State(initialValue: record.appearance)
        _callMode = State(initialValue: record.voiceCallPreferences?.enginePreference ?? .auto)
        _greetingEnabled = State(initialValue: record.voiceCallPreferences?.openingGreetingEnabled ?? true)
        _selectedVoice = State(initialValue: record.voicePreference?.voice == "default" ? "" : record.voicePreference?.voice ?? "")
    }

    var body: some View {
        let preview = avatarPreview
        let currentRecord = record
        return NavigationStack {
            Form {
                Section("助手") {
                    PhotosPicker(selection: $avatarItem, matching: .images) {
                        Group {
                            if let preview {
                                Image(uiImage: preview).resizable().scaledToFill().frame(width: 64, height: 64).clipShape(Circle())
                            } else {
                                PersonalAgentAvatar(configuration: configuration, agent: currentRecord, size: 64, active: true)
                            }
                        }.frame(maxWidth: .infinity)
                    }.accessibilityLabel("上传头像")
                        .accessibilityIdentifier("personal-setting-avatar")
                        .disabled(uploadingAvatar || saving || loadingProfile)
                    TextField("名称", text: $name)
                        .textInputAutocapitalization(.words)
                        .onChange(of: name) { scheduleNameSave() }
                        .onSubmit { saveNow() }
                }
                if allowsConversationSharing {
                    Button("分享会话", systemImage: "square.and.arrow.up") { showingShare = true }
                        .accessibilityIdentifier("assistant-share")
                }
                modelSettings
                callSettings
                if saving {
                    Text("正在保存…").foregroundStyle(.secondary)
                } else if let error {
                    Text(error).foregroundStyle(mobileTheme.danger)
                    Button("重试") { saveNow() }
                }
            }
            .sheet(isPresented: $showingShare) {
                ConversationShareView(configuration: configuration, conversationID: conversation.id)
                    .interactiveDismissDisabled()
                    .mobileSheetPreset(.large)
            }
            .disabled(saving || loadingProfile)
            .redacted(reason: loadingProfile ? .placeholder : [])
            .onChange(of: avatarItem) {
                Task { await uploadAvatar() }
            }
            .task {
                guard !loadedProfile else { return }
                await reloadProfile()
                if !Task.isCancelled {
                    loadedProfile = true
                }
                await loadVoices()
            }
            .task { await loadModelSettings() }
            .navigationDestination(isPresented: $choosingCallMode) {
                List {
                    ForEach(PersonalCallMode.allCases) { mode in
                        Button {
                            callMode = mode
                            choosingCallMode = false
                            saveNow()
                        } label: {
                            HStack {
                                Text(callModeTitle(mode))
                                Spacer()
                                if mode == callMode {
                                    Image(systemName: "checkmark")
                                }
                            }
                        }
                    }
                }
                .navigationTitle("通话模式")
                .navigationBarTitleDisplayMode(.inline)
            }
            .navigationDestination(isPresented: $modelPickerOpen) {
                AssistantOptionPicker(configuration: configuration, conversation: conversation,
                                      state: modelOptions, pickingModel: true,
                                      onSave: onModelSaved)
            }
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button("关闭", systemImage: "xmark") {
                        nameSaveTask?.cancel()
                        Task {
                            if error != nil {
                                dismiss(); return
                            }
                            if hasProfileChanges {
                                await save()
                            }
                            if error == nil {
                                dismiss()
                            }
                        }
                    }
                    .labelStyle(.iconOnly)
                    .accessibilityIdentifier("personal-setting-close")
                    .disabled(saving || uploadingAvatar)
                }
            }
            .interactiveDismissDisabled(saving || uploadingAvatar || hasProfileChanges)
        }
    }

    private func callModeTitle(_ mode: PersonalCallMode) -> LocalizedStringKey {
        switch mode {
        case .auto: "自动选择"
        case .natural: "直接对话"
        case .assistant: "语音助手"
        }
    }

    private var callSettings: some View {
        Section("语音通话") {
            Button {
                choosingCallMode = true
            } label: {
                LabeledContent("通话模式") { Text(callModeTitle(callMode)) }
            }
            .accessibilityIdentifier("personal-setting-call-mode")
            if callMode != .natural {
                DisclosureGroup("声音与问候", isExpanded: $voiceExpanded) {
                    if loadingVoices {
                        Text("音色").redacted(reason: .placeholder)
                    } else if voiceOptions.isEmpty {
                        Button("刷新音色") { Task { await loadVoices() } }
                    } else {
                        Picker("音色", selection: $selectedVoice) {
                            Text("默认声音").tag("")
                            ForEach(voiceOptions.filter { $0.id != "default" }) { option in
                                Text(option.displayNames?[locale.language.languageCode?.identifier == "zh" ? "zh-CN" : "en"] ?? option.name)
                                    .tag(option.id)
                            }
                            if let current = record.voicePreference, current.voice != "default", !voiceOptions.contains(where: { $0.id == current.voice }) {
                                Text(current.voice).tag(current.voice)
                            }
                        }
                        .accessibilityIdentifier("personal-agent-voice-choice")
                        .onChange(of: selectedVoice) { saveNow() }
                    }
                    if record.voiceCallPreferences != nil {
                        Toggle(locale.language.languageCode?.identifier == "zh" ? "连接时打招呼" : "Greet me when connected",
                               isOn: $greetingEnabled)
                            .onChange(of: greetingEnabled) { saveNow() }
                    }
                }
            }
        }
    }

    private var modelSettings: some View {
        Section("对话模型") {
            if modelOptions.isLoading {
                Text("模型").redacted(reason: .placeholder)
            } else if let error = modelOptions.errorMessage {
                Text(error).foregroundStyle(mobileTheme.danger)
                Button("重试") { Task { await loadModelSettings() } }
            } else {
                Button {
                    modelPickerOpen = true
                } label: {
                    LabeledContent("模型", value: modelOptions.selectedModel?.localizedName(locale)
                        ?? (modelOptions.selectedModelID.isEmpty ? "" : modelOptions.selectedModelID))
                }
                .disabled(modelOptions.models.isEmpty)
                .accessibilityIdentifier("personal-setting-model")
                if modelOptions.models.isEmpty {
                    Text("暂无可用模型").foregroundStyle(.secondary)
                }
            }
        }
    }

    private func loadModelSettings() async {
        await modelOptions.load(conversation, using: GatewayClient(configuration: configuration))
    }

    private func loadVoices() async {
        loadingVoices = true
        defer { loadingVoices = false }
        do {
            if let options = try await GatewayClient(configuration: configuration).personalVoiceOptions() {
                voiceProvider = options.provider
                voiceModel = options.model
                voiceOptions = options.voices
            }
        } catch { self.error = error.localizedDescription }
    }

    private func reloadProfile() async {
        loadingProfile = true
        defer { loadingProfile = false }
        do {
            if let updated = try await GatewayClient(configuration: configuration).fetchPersonalAgent() {
                record = updated
                name = updated.displayName
                appearance = updated.appearance
                callMode = updated.voiceCallPreferences?.enginePreference ?? .auto
                greetingEnabled = updated.voiceCallPreferences?.openingGreetingEnabled ?? true
                selectedVoice = updated.voicePreference?.voice == "default" ? "" : updated.voicePreference?.voice ?? ""
                onSaved(updated)
                error = nil
            }
        } catch {
            if !Task.isCancelled {
                self.error = error.localizedDescription
            }
        }
    }

    private func uploadAvatar() async {
        guard let avatarItem, !uploadingAvatar else { return }
        uploadingAvatar = true
        defer { uploadingAvatar = false }
        do {
            guard let data = try await avatarItem.loadTransferable(type: Data.self), let image = UIImage(data: data),
                  let jpeg = image.jpegData(compressionQuality: 0.8), jpeg.count <= 512 * 1024
            else { throw GatewayClientError.server("头像不能超过 512 KB") }
            try await GatewayClient(configuration: configuration).uploadPersonalAvatar(data: jpeg)
            avatarPreview = image; appearance = "custom"
            await save()
        } catch { self.error = error.localizedDescription }
    }

    private var trimmedName: String {
        let value = String(name.trimmingCharacters(in: .whitespacesAndNewlines).prefix(60))
        return value.isEmpty ? record.displayName : value
    }

    private var hasProfileChanges: Bool {
        trimmedName != record.displayName || appearance != record.appearance
            || callMode != (record.voiceCallPreferences?.enginePreference ?? .auto)
            || greetingEnabled != (record.voiceCallPreferences?.openingGreetingEnabled ?? true)
            || selectedVoice != savedVoice
    }

    private var savedVoice: String {
        record.voicePreference?.voice == "default" ? "" : record.voicePreference?.voice ?? ""
    }

    private func scheduleNameSave() {
        nameSaveTask?.cancel()
        guard loadedProfile, trimmedName != record.displayName else { return }
        nameSaveTask = Task {
            do { try await Task.sleep(for: .milliseconds(700)) } catch { return }
            await save()
        }
    }

    private func saveNow() {
        nameSaveTask?.cancel()
        Task { await save() }
    }

    private func save() async {
        guard !loadingProfile, !saving, hasProfileChanges else { return }
        error = nil
        saving = true
        defer { saving = false }
        let voicePreference: PersonalVoicePreference? = if selectedVoice == record.voicePreference?.voice
            || (selectedVoice.isEmpty && record.voicePreference?.voice == "default")
        {
            record.voicePreference
        } else if let voiceProvider, let voiceModel {
            selectedVoice.isEmpty ? nil : PersonalVoicePreference(
                provider: voiceProvider, model: voiceModel, voice: selectedVoice
            )
        } else {
            record.voicePreference
        }
        do {
            let updated = try await GatewayClient(configuration: configuration).updatePersonalAgentProfile(
                record: record,
                displayName: trimmedName,
                appearance: appearance,
                voicePreference: voicePreference,
                openingGreetingEnabled: greetingEnabled,
                callMode: callMode
            )
            record = updated
            onSaved(updated)
        } catch {
            self.error = error.localizedDescription
        }
    }
}

private struct ErrorBanner: View {
    @Environment(\.mobileTheme) private var mobileTheme
    let message: String

    @Environment(\.locale) private var locale

    var body: some View {
        Label(message, systemImage: "exclamationmark.triangle.fill")
            .mobileTextStyle(.secondary)
            .foregroundStyle(mobileTheme.danger)
            .padding(12)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(mobileTheme.danger.opacity(0.08), in: .rect(cornerRadius: mobileTheme.corner(12)))
            .accessibilityLabel(AppLocalization.resolve("错误：\(message)", locale: locale))
    }
}

private struct ChatConnectionObservationKey: Equatable {
    let configuration: GatewayConfiguration
    let active: Bool
}

private struct ChatConnectionNoticeKey: Equatable {
    let interrupted: Bool
    let retry: Int
}

private struct ConversationLoadKey: Equatable {
    let configuration: GatewayConfiguration
    let conversationID: String?
    let transcriptID: String?
    let isDraft: Bool?
    let isForeground: Bool
}

private struct NextTurnObservationKey: Equatable {
    let configuration: GatewayConfiguration
    let conversationID: String?
    let transcriptID: String?
    let locale: String
    let revision: Int
}

private struct TaskResultObservationKey: Equatable {
    let configuration: GatewayConfiguration
    let conversationID: String?
    let isActive: Bool
}

private struct GeneratedMediaObservationKey: Equatable {
    let configuration: GatewayConfiguration
    let conversationID: String?
    let transcriptID: String?
    let busy: Bool
    let visible: Bool
    let musicJobsRevision: Int
}

private extension AssistantView {
    @ViewBuilder
    var personalConnectionCard: some View {
        if isPersonalConversation, let conversation, !conversation.isDraft {
            PersonalConnectionCard(configuration: configuration, conversationID: conversation.id)
        }
    }

    @ViewBuilder
    var clarificationCard: some View {
        if let clarification = state.clarification, let conversation {
            ClarificationCard(
                clarification: clarification,
                isSubmitting: state.isRespondingToClarification,
                errorMessage: state.clarificationError,
                onRespond: { action, submission in
                    Task {
                        await state.respondToClarification(
                            action: action,
                            submission: submission,
                            in: conversation,
                            using: GatewayClient(configuration: configuration)
                        )
                    }
                }
            )
            .id(clarification.id)
        }
    }
}

private enum PendingConversationStart {
    case agent(String)
    case scoped(ProjectRecord?, String?, String)
}

private struct ChatMessageSearchView: View {
    @Environment(\.mobileTheme) private var mobileTheme
    let messages: [TimelineMessage]
    let configuration: GatewayConfiguration
    let conversationID: String?
    let assistantState: AssistantState
    let readAloud: ChatReadAloud
    let canReadAloud: Bool
    @Environment(\.dismiss) private var dismiss
    @Environment(\.locale) private var locale
    @State private var query = ""
    @State private var category = "messages"
    @State private var selectedMessage: TimelineMessage?
    @FocusState private var focused: Bool

    private var categories: [SegmentOption<String>] {
        [
            SegmentOption(id: "messages", title: "chat_search_category_messages", accessibilityID: "chat-search-category-messages"),
            SegmentOption(id: "files", title: "chat_search_category_files", accessibilityID: "chat-search-category-files"),
            SegmentOption(id: "links", title: "chat_search_category_links", accessibilityID: "chat-search-category-links"),
            SegmentOption(id: "images", title: "chat_search_category_images", accessibilityID: "chat-search-category-images")
        ]
    }

    private func content(_ message: TimelineMessage) -> String {
        switch category {
        case "files": return message.attachments.filter { !$0.isImage }.map { $0.name ?? "File" }.joined(separator: "\n")
        case "images": return message.attachments.filter(\.isImage).map { $0.name ?? "Image" }.joined(separator: "\n")
        case "links":
            guard let detector = try? NSDataDetector(types: NSTextCheckingResult.CheckingType.link.rawValue) else { return "" }
            return detector.matches(in: message.text, range: NSRange(message.text.startIndex..., in: message.text))
                .compactMap { $0.url?.absoluteString }.filter { $0.hasPrefix("http") }.joined(separator: "\n") + "\n"
                + message.resultLinks.map(\.url.absoluteString).joined(separator: "\n")
        default: return message.text
        }
    }

    private var results: [TimelineMessage] {
        let needle = query.trimmingCharacters(in: .whitespacesAndNewlines)
        return messages.filter { message in
            let text = content(message)
            return !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty && (needle.isEmpty ? category != "messages" : text.localizedCaseInsensitiveContains(needle))
        }
    }

    var body: some View {
        ScrollView {
            LazyVStack(alignment: .leading, spacing: 12) {
                ForEach(results) { message in
                    Button {
                        focused = false
                        selectedMessage = message
                    } label: {
                        Text(content(message)).lineLimit(4).frame(maxWidth: .infinity, alignment: .leading)
                            .padding(16).background(mobileTheme.panel, in: .rect(cornerRadius: mobileTheme.corner(16)))
                    }.buttonStyle(.plain).accessibilityIdentifier("chat-search-result-\(message.id)")
                }
                if !query.isEmpty, results.isEmpty {
                    Text(locale.language.languageCode?.identifier == "zh" ? "没有找到相关内容" : "No results")
                        .foregroundStyle(.secondary)
                }
            }.padding(20)
        }
        .background(mobileTheme.canvas.ignoresSafeArea())
        .safeAreaInset(edge: .bottom, spacing: 0) {
            VStack(alignment: .leading, spacing: 10) {
                SegmentedTabs(options: categories, selected: category, label: "筛选", swipeToSelect: selectedMessage == nil) {
                    category = $0
                    focused = true
                }
                HStack(spacing: 10) {
                    HStack(spacing: 10) {
                        Image(systemName: "magnifyingglass").foregroundStyle(.secondary)
                        TextField("搜索", text: $query).focused($focused).submitLabel(.search)
                            .onSubmit { focused = false }
                            .accessibilityIdentifier("chat-message-search-input")
                    }.padding(.horizontal, 16).frame(minHeight: 48)
                        .background(mobileTheme.panel, in: .capsule)
                    Button { focused = false; dismiss() } label: {
                        Image(systemName: "xmark").frame(width: 48, height: 48)
                            .background(mobileTheme.panel, in: .circle)
                    }.buttonStyle(.plain).accessibilityLabel("关闭")
                        .accessibilityIdentifier("chat-search-close")
                }
            }.padding(.horizontal, 16).padding(.vertical, 8)
                .background(mobileTheme.canvas)
        }
        .task { focused = true }
        .sheet(item: $selectedMessage) { message in
            NavigationStack {
                ScrollView {
                    MessageBubble(message: message, configuration: configuration, conversationID: conversationID,
                                  assistantState: assistantState, readAloud: readAloud, canReadAloud: canReadAloud,
                                  previewEligible: false, onReuseUserText: { _ in }).padding()
                }.toolbar {
                    ToolbarItem(placement: .confirmationAction) { Button("完成") { selectedMessage = nil } }
                }
            }.mobileSheetPreset(.immersive)
        }
    }
}

private struct PhoneObservationKey: Equatable {
    let configuration: GatewayConfiguration
    let conversationID: String?
    let active: Bool
}

private struct OptionsObservationKey: Equatable {
    let configuration: GatewayConfiguration
    let conversationID: String?
    let agentID: String?
    let isDraft: Bool?
    let model: String?
    let thinkingLevel: String?
    let serviceTier: String?
    let isActive: Bool
}

private struct DraftProjectKey: Equatable {
    let configuration: GatewayConfiguration
    let projectID: String?
    let isActive: Bool
}

private struct DesktopChatTarget: Decodable {
    let deviceName: String?
    let deviceState: String?
    let reselectEndpointId: String?
}

private struct DesktopChatTargetSelection: Encodable {
    let endpointId: String
}
