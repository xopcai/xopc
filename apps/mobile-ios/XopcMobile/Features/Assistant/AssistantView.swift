import PhotosUI
import SwiftUI

// swiftlint:disable file_length
// swiftlint:disable:next type_body_length
struct AssistantView<Dock: View>: View {
    let configuration: GatewayConfiguration
    let isActive: Bool
    let realtimeVoiceCall: RealtimeVoiceCall
    let conversation: ConversationSelection?
    let personalAgent: PersonalAgentRecord?
    let quickChatHandoff: QuickChatHandoff?
    let onStartConversation: (String) -> Void
    let onStartScopedConversation: (ProjectRecord?, String?, String) -> Void
    let onConversationUpdated: (ConversationSelection) -> Void
    let onQuickChatHandled: (UUID) -> Void
    let onPersonalAgentUpdated: (PersonalAgentRecord) -> Void
    let onOpenSettings: () -> Void
    let onInputFocusChanged: (Bool) -> Void
    let bottomDock: (AssistantComposer, Bool) -> Dock

    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.locale) private var locale
    @Environment(\.scenePhase) private var scenePhase

    @State var state = AssistantState()
    @State var draft = ""
    @State var attachments: [MessageAttachment] = []
    @State var references: [ContextReference] = []
    @State var attachmentError: String?
    @State private var showingPhotoPicker = false
    @State private var showingFilePicker = false
    @State private var showingCameraPicker = false
    @State private var showingVoiceRecorder = false
    @State private var showingReferencePicker = false
    @State private var referenceKind = ContextReferenceKind.note
    @State private var isActionPanelExpanded = false
    @State private var showingSessionActions = false
    @State private var showingPersonalProfile = false
    @State private var showingMessageSearch = false
    @State private var executionPresentation: ExecutionActivityPresentation?
    @State private var handledQuickChatID: UUID?
    @State private var readAloud = ChatReadAloud()
    @State private var assistantAudio = AssistantAudioAutoplay()
    @State private var startingVoice = false
    @State private var voiceStartError: String?
    @State private var voiceMaterializationIDs: [String: String] = [:]
    @State private var isAtBottom = true
    @State private var pendingStart: PendingConversationStart?
    @State private var bottomDockHeight: CGFloat = 0
    @State private var messageViewportHeight: CGFloat = 0
    @State private var chatTopInset: CGFloat = 0
    @State private var replySpace = ChatReplySpace()
    @State private var replyRowHeights: [String: CGFloat] = [:]
    @State private var replyUserText: String?
    @State private var activityHeight: CGFloat = 0
    @State private var followingBottom = true
    @State private var userScrollingMessages = false
    @State private var bottomScrollTask: Task<Void, Never>?

    var body: some View {
        ZStack(alignment: .bottom) {
            content
                .frame(maxWidth: .infinity, maxHeight: .infinity)
                .clipped()
                .ignoresSafeArea(.container, edges: .top)
                .overlay(alignment: .bottom) {
                    Color(uiColor: .systemGroupedBackground)
                        .frame(height: 24)
                        .ignoresSafeArea(edges: .bottom)
                        .allowsHitTesting(false)
                }
            VStack(spacing: 0) {
                if readAloud.state != .idle {
                    readAloudBar
                }
                bottomDock(composer, isActionPanelExpanded)
            }
            .onGeometryChange(for: CGFloat.self) { $0.size.height } action: { bottomDockHeight = $0 }
        }
        .background(Color(uiColor: .systemGroupedBackground).ignoresSafeArea())
        .onGeometryChange(for: CGFloat.self) { $0.size.height } action: { messageViewportHeight = $0 }
        .onGeometryChange(for: CGFloat.self) { $0.safeAreaInsets.top } action: { chatTopInset = $0 }
        .navigationTitle("")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar(.hidden, for: .navigationBar)
        .overlay(alignment: .top) {
            Color(uiColor: .systemGroupedBackground)
                .frame(height: chatTopInset)
                .offset(y: -chatTopInset)
                .allowsHitTesting(false)
                .accessibilityHidden(true)
        }
        .overlay(alignment: .top) {
            floatingHeader.padding(.horizontal, 20).padding(.top, 8)
        }
        .fullScreenCover(isPresented: $showingMessageSearch) {
            ChatMessageSearchView(messages: state.messages, configuration: configuration,
                                  conversationID: conversation?.id, assistantState: state, readAloud: readAloud,
                                  canReadAloud: realtimeVoiceCall.phase == .idle)
        }
        .sheet(isPresented: $showingPersonalProfile) {
            if let personalAgent, let conversation {
                PersonalAgentProfileView(configuration: configuration, record: personalAgent,
                                         conversation: conversation, onSaved: onPersonalAgentUpdated)
                    .presentationDetents([.fraction(0.65)])
            }
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
            isForeground: scenePhase == .active && isActive
        )) {
            guard scenePhase == .active, isActive else { state.pauseConversation(); return }
            await state.loadConversation(conversation, using: GatewayClient(configuration: configuration))
        }
        .task(id: TaskResultObservationKey(configuration: configuration, conversationID: conversation?.id,
                                           isActive: isActive && scenePhase == .active))
        {
            guard scenePhase == .active, isActive, let conversation, !conversation.isDraft else { return }
            await state.observeTaskResults(in: conversation, using: GatewayClient(configuration: configuration))
        }
        .onChange(of: scenePhase) {
            if scenePhase != .active {
                state.pauseConversation()
            }
        }
        .onChange(of: isActive) {
            if !isActive {
                state.pauseConversation()
            }
        }
        .onChange(of: conversation?.id) {
            readAloud.stop()
            assistantAudio.stop()
            executionPresentation = nil
            isAtBottom = true
            followingBottom = true
            replySpace = ChatReplySpace()
            replyRowHeights = [:]
            replyUserText = nil
            activityHeight = 0
            if let agent = state.agents.first(where: { $0.id == conversation?.agentId }) {
                state.select(agent)
            }
            draft = ""
            attachments = []
            references = []
            attachmentError = nil
            isActionPanelExpanded = false
        }
        .onChange(of: quickChatHandoff?.id) {
            handleQuickChatHandoff()
        }
        .onAppear(perform: handleQuickChatHandoff)
        .onDisappear {
            state.pauseConversation()
            readAloud.stop()
            assistantAudio.stop()
            onInputFocusChanged(false)
        }
        .onChange(of: assistantAudioObservation, initial: true) { _, observation in
            assistantAudio.observe(observation, configuration: configuration)
        }
        .modifier(AttachmentPickerModifier(
            attachments: $attachments,
            errorMessage: $attachmentError,
            showingPhotoPicker: $showingPhotoPicker,
            showingFilePicker: $showingFilePicker,
            showingCameraPicker: $showingCameraPicker
        ))
        .sheet(isPresented: $showingSessionActions) {
            AssistantSessionActionsView(
                configuration: configuration,
                conversation: conversation,
                state: state,
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
                }
            )
        }
        .sheet(item: $executionPresentation) { presentation in
            AssistantExecutionSheet(
                presentation: presentation,
                configuration: configuration,
                assistantState: state,
                onDismiss: { executionPresentation = nil }
            )
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
        .sheet(isPresented: $showingVoiceRecorder) {
            VoiceAttachmentRecorderView(configuration: configuration) { attachment in
                do {
                    try AttachmentPolicy.validateChat(size: attachment.size, current: attachments)
                    attachments.append(attachment)
                } catch {
                    attachmentError = error.localizedDescription
                    return
                }
            } onTranscribed: { text in
                let existing = draft.trimmingCharacters(in: .whitespacesAndNewlines)
                draft = existing.isEmpty ? text : "\(existing) \(text)"
            }
        }
        .confirmationDialog("开始新对话？", isPresented: Binding(
            get: { pendingStart != nil }, set: {
                if !$0 {
                    pendingStart = nil
                }
            }
        )) {
            Button("开始新对话", role: .destructive) {
                if let start = pendingStart {
                    performStart(start)
                }
                pendingStart = nil
            }
            Button("取消", role: .cancel) { pendingStart = nil }
        } message: { Text("当前未发送的文字、附件和引用将被清空。") }
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
        if state.isLoading, state.agents.isEmpty {
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
        } else if state.isLoadingHistory {
            ProgressView("正在读取消息…")
                .frame(maxWidth: .infinity, maxHeight: .infinity)
        } else if state.messages.isEmpty {
            GeometryReader { viewport in
                ScrollView {
                    LazyVStack(spacing: 16) {
                        if let errorMessage = state.errorMessage {
                            ErrorBanner(message: errorMessage)
                            Button("重试") {
                                Task {
                                    await state.loadConversation(conversation, using: GatewayClient(configuration: configuration))
                                }
                            }
                            .frame(minHeight: 44)
                        }
                        clarificationCard
                        queueCard
                        personalConnectionCard
                        welcome
                    }
                    .padding()
                    .frame(maxWidth: 720)
                    .frame(maxWidth: .infinity)
                    .frame(minHeight: max(0, viewport.size.height - bottomDockHeight - 24))
                }
                .contentMargins(.top, chatTopInset + 72, for: .scrollContent)
                .contentMargins(.bottom, bottomDockHeight + 24, for: .scrollContent)
            }
        } else {
            messageTimeline
        }
    }

    private func scheduleBottomScroll(_ scroller: ScrollViewProxy) {
        guard followingBottom, !userScrollingMessages, bottomScrollTask == nil else { return }
        bottomScrollTask = Task {
            do { try await Task.sleep(for: .milliseconds(16)) } catch { return }
            bottomScrollTask = nil
            guard followingBottom, !userScrollingMessages else { return }
            scroller.scrollTo("chat-bottom", anchor: .bottom)
        }
    }

    private var messageTimeline: some View {
        GeometryReader { viewport in
            ScrollViewReader { scroller in
                ScrollView {
                    LazyVStack(spacing: 14) {
                        if showsConversationTitleInTimeline, let conversation {
                            Text(verbatim: conversation.title)
                                .mobileTextStyle(.rowTitle)
                                .fixedSize(horizontal: false, vertical: true)
                                .frame(maxWidth: .infinity, alignment: .leading)
                                .padding(.horizontal, 4)
                                .accessibilityAddTraits(.isHeader)
                        }
                        if let errorMessage = state.errorMessage {
                            ErrorBanner(message: errorMessage)
                        }
                        clarificationCard
                        queueCard
                        personalConnectionCard
                        ForEach(state.messages.filter { $0.role != "assistant" || $0.answerConfirmed }) { message in
                            MessageBubble(
                                message: message,
                                configuration: configuration,
                                conversationID: conversation?.isDraft == false ? conversation?.id : nil,
                                assistantState: state,
                                readAloud: readAloud,
                                canReadAloud: realtimeVoiceCall.phase == .idle,
                                previewEligible: message.id != state.messages.last?.id,
                                onReuseUserText: { draft = $0 },
                                animateStreaming: followingBottom && !userScrollingMessages,
                                onReading: {
                                    followingBottom = false
                                    bottomScrollTask?.cancel(); bottomScrollTask = nil
                                }
                            )
                            .onGeometryChange(for: CGFloat.self) { $0.size.height } action: { height in
                                recordReplyRowHeight(message.id, height: height)
                                if message.id == state.messages.last?.id {
                                    scheduleBottomScroll(scroller)
                                }
                            }
                        }
                        if state.isRunActive, state.errorMessage == nil, state.clarification == nil,
                           !state.messages.contains(where: { $0.role == "assistant" && $0.turnId == state.runID && $0.answerConfirmed && !$0.text.isEmpty })
                        {
                            AssistantActivityView(narration: state.executionActivity.last(where: { $0.id.hasPrefix("narration:") })?.title)
                                .id(state.runID ?? "sending")
                                .onGeometryChange(for: CGFloat.self) { $0.size.height } action: { height in
                                    activityHeight = height
                                    updateReplySpace()
                                }
                        }
                        Color.clear.frame(height: 1)
                            .id("chat-bottom")
                            .onGeometryChange(for: CGFloat.self) { proxy in
                                proxy.frame(in: .named("chat-scroll")).maxY
                            } action: { bottom in
                                isAtBottom = bottom <= viewport.size.height - bottomDockHeight - replySpace.remaining + 32
                                if userScrollingMessages {
                                    followingBottom = isAtBottom
                                }
                            }
                    }
                    .padding(.horizontal, 12)
                    .padding(.vertical, 16)
                    .frame(maxWidth: 720)
                    .frame(maxWidth: .infinity)
                }
                .defaultScrollAnchor(.bottom)
                .contentMargins(.top, chatTopInset + 72, for: .scrollContent)
                .contentMargins(.bottom, bottomDockHeight + 24 + replySpace.remaining, for: .scrollContent)
                .coordinateSpace(name: "chat-scroll")
                .onDisappear { bottomScrollTask?.cancel(); bottomScrollTask = nil }
                .onChange(of: conversation?.id) { bottomScrollTask?.cancel(); bottomScrollTask = nil }
                .onChange(of: state.messages.last) {
                    updateReplySpace()
                    if followingBottom {
                        scheduleBottomScroll(scroller)
                    }
                }
                .onChange(of: replySpace.remaining) {
                    if followingBottom {
                        scheduleBottomScroll(scroller)
                    }
                }
                .onChange(of: bottomDockHeight) {
                    updateReplySpace()
                    if followingBottom {
                        scheduleBottomScroll(scroller)
                    }
                }
                .onChange(of: viewport.size.height) {
                    updateReplySpace()
                    if followingBottom {
                        scheduleBottomScroll(scroller)
                    }
                }
                .modifier(ChatScrollInteraction(onStart: {
                    userScrollingMessages = true
                    followingBottom = false
                    bottomScrollTask?.cancel(); bottomScrollTask = nil
                }, onEnd: {
                    followingBottom = isAtBottom
                    userScrollingMessages = false
                    updateReplySpace()
                }))
                .overlay(alignment: .bottom) {
                    if state.isRunActive || !isAtBottom {
                        Button {
                            userScrollingMessages = false
                            followingBottom = true
                            updateReplySpace()
                            withAnimation(reduceMotion ? nil : .easeOut(duration: 0.25)) {
                                scroller.scrollTo("chat-bottom", anchor: .bottom)
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
                        .padding(.bottom, bottomDockHeight + 8)
                    }
                }
            }
        }
    }

    func reserveReplySpace(_ rowID: String) {
        guard followingBottom else { return }
        replyRowHeights = [:]
        replyUserText = nil
        activityHeight = 0
        replySpace.begin(anchorID: rowID, availableHeight: messageViewportHeight - bottomDockHeight - 24,
                         following: followingBottom)
    }

    private func recordReplyRowHeight(_ rowID: String, height: CGFloat) {
        guard replySpace.anchorID != nil, replySpace.remaining > 0,
              replyRowHeights[rowID] != height else { return }
        replyRowHeights[rowID] = height
        updateReplySpace()
    }

    private func updateReplySpace() {
        if replySpace.anchorID != nil,
           !state.messages.contains(where: { $0.id == replySpace.anchorID }),
           let replyUserText,
           let confirmed = state.messages.last(where: { $0.role == "user" && $0.text == replyUserText })
        {
            replySpace.reanchor(confirmed.id)
        }
        guard let anchor = state.messages.firstIndex(where: { $0.id == replySpace.anchorID }) else { return }
        replyUserText = state.messages[anchor].text
        let replyRows = state.messages.dropFirst(anchor + 1)
        let replyHeight = replyRows.reduce(CGFloat.zero) { height, row in
            height + (replyRowHeights[row.id] ?? 0) + 14
        } + (state.isRunActive ? activityHeight + 14 : 0)
        replySpace.consume(replyHeight: replyHeight, availableHeight: messageViewportHeight - bottomDockHeight - 24,
                           following: followingBottom)
    }

    private var conversationNavigationTitle: String {
        if isPersonalConversation {
            return personalAgent?.displayName ?? "Ada"
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

    private var currentAgentName: String {
        isPersonalConversation
            ? (personalAgent?.displayName ?? "Ada")
            : (state.agents.first(where: { $0.id == conversation?.agentId })?.displayName
                ?? state.selectedAgent?.displayName ?? AppLocalization.string("未选择", locale: locale))
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
            enabled: isActive && !state.isLoadingHistory && realtimeVoiceCall.phase == .idle && readAloud.state == .idle,
            attachment: attachment,
            key: key
        )
    }

    private var readAloudBar: some View {
        HStack(spacing: 12) {
            Image(systemName: "speaker.wave.2.fill")
                .foregroundStyle(.blue)
            VStack(alignment: .leading, spacing: 2) {
                Text(readAloud.state == .failed
                    ? LocalizedStringResource("朗读失败")
                    : LocalizedStringResource("正在朗读"))
                    .mobileTextStyle(.secondary).fontWeight(.semibold)
                if let error = readAloud.errorMessage {
                    Text(error).mobileTextStyle(.caption).foregroundStyle(.red).lineLimit(2)
                } else {
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
            PersonalAgentAvatar(configuration: configuration, agent: isPersonalConversation ? personalAgent : nil,
                                size: 108, active: isActive)
                .accessibilityIdentifier("chat-welcome-loopi")
            Text(verbatim: isPersonalConversation
                ? (locale.language.languageCode?.identifier == "zh"
                    ? "你好，我是\(personalAgent?.displayName ?? "Ada")。" : "Hi, I'm \(personalAgent?.displayName ?? "Ada").")
                : (locale.language.languageCode?.identifier == "zh"
                    ? "今天想推进什么？" : "What do you want to move forward?"))
                .font(.system(size: 20, weight: .medium))
                .multilineTextAlignment(.center)
            if isPersonalConversation {
                Text(locale.language.languageCode?.identifier == "zh"
                    ? "想聊一件事、理清思路，或让我帮你推进工作，都可以直接说。"
                    : "Tell me what is on your mind, or what you would like to move forward.")
                    .mobileTextStyle(.secondary)
                    .foregroundStyle(.secondary)
                    .multilineTextAlignment(.center)
            }
        }
        .padding(.vertical, 28)
        .frame(maxWidth: .infinity)
    }

    private var composer: AssistantComposer {
        AssistantComposer(
            configuration: configuration,
            draft: $draft,
            attachments: $attachments,
            references: $references,
            showingPhotoPicker: $showingPhotoPicker,
            showingFilePicker: $showingFilePicker,
            showingCameraPicker: $showingCameraPicker,
            showingVoiceRecorder: $showingVoiceRecorder,
            showingReferencePicker: $showingReferencePicker,
            referenceKind: $referenceKind,
            isActionPanelExpanded: $isActionPanelExpanded,
            attachmentError: attachmentError,
            canReferenceFiles: conversation?.isDraft == false,
            canStartRealtimeVoice: conversation != nil && !startingVoice && !state.isRunActive
                && !state.isSending && realtimeVoiceCall.phase == .idle,
            isRunActive: state.isRunActive,
            onInputFocusChanged: onInputFocusChanged,
            onStop: {
                Task { await state.stop(using: GatewayClient(configuration: configuration)) }
            },
            onSend: { send(delivery: .next) },
            onSteer: { send(delivery: .steer) },
            onNewConversation: { requestConversation(state.selectedAgentID ?? "main") },
            onRealtimeVoice: { mode in
                guard let conversation, !startingVoice, !state.isRunActive, !state.isSending else { return }
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
                        mode: mode,
                        name: selected.title,
                        gateway: gateway
                    )
                }
            }
        )
    }

    private func handleQuickChatHandoff() {
        guard let quickChatHandoff, handledQuickChatID != quickChatHandoff.id else { return }
        handledQuickChatID = quickChatHandoff.id
        draft = quickChatHandoff.text
        switch quickChatHandoff.action {
        case .send:
            send(delivery: .next)
        case .voice:
            showingVoiceRecorder = true
        case .attachments:
            isActionPanelExpanded = true
        }
        onQuickChatHandled(quickChatHandoff.id)
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

    private var floatingHeader: some View {
        HStack(spacing: 12) {
            Group {
                if isPersonalConversation {
                    Button { showingPersonalProfile = true } label: {
                        HStack(spacing: 8) {
                            PersonalAgentAvatar(configuration: configuration, agent: personalAgent, size: 36, active: isActive)
                            Text(verbatim: currentAgentName).font(.system(size: 16, weight: .medium)).lineLimit(1).fixedSize(horizontal: true, vertical: false)
                        }
                        .padding(.leading, 6).padding(.trailing, 14).frame(height: 48)
                        .background(Color(uiColor: .secondarySystemGroupedBackground), in: Capsule())
                        .overlay(Capsule().stroke(Color.primary.opacity(0.08)))
                    }.buttonStyle(.plain).accessibilityLabel("配置助手").fixedSize(horizontal: true, vertical: false)
                } else {
                    Menu {
                        ForEach(state.agents) { agent in
                            Button { requestConversation(agent.id) } label: { Text(verbatim: agent.displayName) }
                        }
                    } label: {
                        HStack(spacing: 8) {
                            ConfiguredAgentAvatar(configuration: configuration,
                                                  agent: state.agents.first(where: { $0.id == conversation?.agentId }) ?? state.selectedAgent,
                                                  size: 36, active: isActive)
                            Text(verbatim: conversationNavigationTitle).font(.system(size: 16, weight: .medium)).lineLimit(1)
                        }.padding(.horizontal, 12).frame(height: 48)
                            .background(Color(uiColor: .secondarySystemGroupedBackground), in: Capsule())
                    }
                }
            }
            Spacer(minLength: 0)
            HStack(spacing: 0) {
                Button {
                    showingMessageSearch = true
                } label: { Image(systemName: "magnifyingglass").font(.system(size: 22)).frame(width: 44, height: 44) }
                    .accessibilityLabel("搜索消息").accessibilityIdentifier("chat-header-search")
                Button {
                    if isPersonalConversation {
                        showingPersonalProfile = true
                    } else {
                        showingSessionActions = true
                    }
                } label: { Image(systemName: "gearshape").font(.system(size: 22)).frame(width: 44, height: 44) }
                    .accessibilityLabel(isPersonalConversation ? "配置助手" : "会话选项")
                    .accessibilityIdentifier("assistant-options")
            }.buttonStyle(.plain).padding(.horizontal, 4).frame(height: 48)
                .background(Color(uiColor: .secondarySystemGroupedBackground), in: Capsule())
                .overlay(Capsule().stroke(Color.primary.opacity(0.08)))
        }
        .accessibilityIdentifier("chat-floating-header")
    }
}

struct PersonalAgentProfileView: View {
    let configuration: GatewayConfiguration
    let conversation: ConversationSelection
    let onSaved: (PersonalAgentRecord) -> Void

    @Environment(\.dismiss) private var dismiss
    @Environment(\.locale) private var locale
    @State private var record: PersonalAgentRecord
    @State private var name: String
    @State private var appearance: String
    @State private var greetingEnabled: Bool
    @State private var selectedVoice: String
    @State private var voiceProvider: String?
    @State private var voiceModel: String?
    @State private var voiceOptions: [PersonalVoiceOption] = []
    @State private var avatarItem: PhotosPickerItem?
    @State private var avatarPreview: UIImage?
    @State private var uploadingAvatar = false
    @State private var loadingVoices = true
    @State private var loadingProfile = true
    @State private var saving = false
    @State private var error: String?

    init(configuration: GatewayConfiguration, record: PersonalAgentRecord, conversation: ConversationSelection,
         onSaved: @escaping (PersonalAgentRecord) -> Void)
    {
        self.configuration = configuration
        self.conversation = conversation
        self.onSaved = onSaved
        _record = State(initialValue: record)
        _name = State(initialValue: record.displayName)
        _appearance = State(initialValue: record.appearance)
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
                }
                Section("通话声音") {
                    if loadingVoices {
                        Text("通话声音").redacted(reason: .placeholder)
                    } else if voiceOptions.isEmpty {
                        Text("当前没有可用音色，请先在 Gateway 配置语音服务。")
                            .foregroundStyle(.secondary)
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
                    }
                    if record.voiceCallPreferences != nil {
                        Toggle(locale.language.languageCode?.identifier == "zh" ? "连接时打招呼" : "Greet me when connected",
                               isOn: $greetingEnabled)
                    }
                    Button(locale.language.languageCode?.identifier == "zh" ? "刷新音色" : "Refresh voices") {
                        Task { await loadVoices() }
                    }.disabled(loadingVoices)
                }
                Section {
                    Text(locale.language.languageCode?.identifier == "zh"
                        ? "更多设置请前往 PC 或 Web 端。" : "For more settings, use the PC or Web app.")
                        .font(.caption).foregroundStyle(.secondary)
                }
                if let error {
                    Text(error).foregroundStyle(.red)
                }
            }
            .disabled(saving || loadingProfile)
            .redacted(reason: loadingProfile ? .placeholder : [])
            .onChange(of: avatarItem) {
                Task { await uploadAvatar() }
            }
            .task { await reloadProfile(); await loadVoices() }
            .navigationTitle((locale.language.languageCode?.identifier == "zh" ? "配置 " : "Configure ")
                + (record.displayName.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ? "ADA" : record.displayName))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("取消") { dismiss() }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("保存") { Task { await save() } }
                        .disabled(saving || uploadingAvatar || loadingProfile || name.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                }
            }
        }
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
                greetingEnabled = updated.voiceCallPreferences?.openingGreetingEnabled ?? true
                selectedVoice = updated.voicePreference?.voice == "default" ? "" : updated.voicePreference?.voice ?? ""
                onSaved(updated)
                error = nil
            }
        } catch { self.error = error.localizedDescription }
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
        } catch { self.error = error.localizedDescription }
    }

    private func save() async {
        guard !saving else { return }
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
                displayName: String(name.trimmingCharacters(in: .whitespacesAndNewlines).prefix(60)),
                appearance: appearance,
                voicePreference: voicePreference,
                openingGreetingEnabled: greetingEnabled
            )
            record = updated
            onSaved(updated)
            dismiss()
        } catch {
            self.error = error.localizedDescription
        }
    }
}

private struct ErrorBanner: View {
    let message: String

    @Environment(\.locale) private var locale

    var body: some View {
        Label(message, systemImage: "exclamationmark.triangle.fill")
            .mobileTextStyle(.secondary)
            .foregroundStyle(.red)
            .padding(12)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(Color.red.opacity(0.08), in: .rect(cornerRadius: 12))
            .accessibilityLabel(AppLocalization.resolve("错误：\(message)", locale: locale))
    }
}

private struct ConversationLoadKey: Equatable {
    let configuration: GatewayConfiguration
    let conversationID: String?
    let transcriptID: String?
    let isDraft: Bool?
    let isForeground: Bool
}

private struct TaskResultObservationKey: Equatable {
    let configuration: GatewayConfiguration
    let conversationID: String?
    let isActive: Bool
}

private extension AssistantView {
    @ViewBuilder
    var personalConnectionCard: some View {
        if isPersonalConversation, let conversation, !conversation.isDraft {
            PersonalConnectionCard(configuration: configuration, conversationID: conversation.id)
        }
    }

    @ViewBuilder
    var queueCard: some View {
        if !state.pendingInputs.isEmpty, let conversation {
            QueuedInputsCard(
                inputs: state.pendingInputs,
                errorMessage: state.queueError,
                isUpdating: state.isUpdatingQueue,
                onUpdate: { input, content in
                    Task {
                        await state.updateQueuedInput(
                            input,
                            content: content,
                            in: conversation,
                            using: GatewayClient(configuration: configuration)
                        )
                    }
                },
                onCancel: { input in
                    Task {
                        await state.cancelQueuedInput(
                            input,
                            in: conversation,
                            using: GatewayClient(configuration: configuration)
                        )
                    }
                }
            )
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

    private var categories: [(String, String)] {
        let chinese = locale.language.languageCode?.identifier == "zh"
        return [("messages", chinese ? "消息" : "Messages"), ("files", chinese ? "文件" : "Files"),
                ("links", chinese ? "链接" : "Links"), ("images", chinese ? "图片" : "Images")]
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
                            .padding(16).background(Color(uiColor: .secondarySystemGroupedBackground), in: .rect(cornerRadius: 16))
                    }.buttonStyle(.plain).accessibilityIdentifier("chat-search-result-\(message.id)")
                }
                if !query.isEmpty, results.isEmpty {
                    Text(locale.language.languageCode?.identifier == "zh" ? "没有找到相关内容" : "No results")
                        .foregroundStyle(.secondary)
                }
            }.padding(20)
        }
        .background(Color(uiColor: .systemGroupedBackground).ignoresSafeArea())
        .safeAreaInset(edge: .bottom, spacing: 0) {
            VStack(alignment: .leading, spacing: 10) {
                HStack(spacing: 6) {
                    ForEach(categories, id: \.0) { item in
                        Button { category = item.0; focused = true } label: {
                            Text(item.1).foregroundStyle(category == item.0 ? Color.accentColor : Color.primary)
                                .padding(.horizontal, 14).frame(minHeight: 44)
                                .background(Color(uiColor: .secondarySystemGroupedBackground), in: .rect(cornerRadius: 18))
                        }.buttonStyle(.plain).accessibilityIdentifier("chat-search-category-\(item.0)")
                            .accessibilityAddTraits(category == item.0 ? .isSelected : [])
                    }
                }
                HStack(spacing: 10) {
                    HStack(spacing: 10) {
                        Image(systemName: "magnifyingglass").foregroundStyle(.secondary)
                        TextField("搜索", text: $query).focused($focused).submitLabel(.search)
                            .onSubmit { focused = false }
                            .accessibilityIdentifier("chat-message-search-input")
                    }.padding(.horizontal, 16).frame(minHeight: 48)
                        .background(Color(uiColor: .secondarySystemGroupedBackground), in: .capsule)
                    Button { focused = false; dismiss() } label: {
                        Image(systemName: "xmark").frame(width: 48, height: 48)
                            .background(Color(uiColor: .secondarySystemGroupedBackground), in: .circle)
                    }.buttonStyle(.plain).accessibilityLabel("关闭")
                        .accessibilityIdentifier("chat-search-close")
                }
            }.padding(.horizontal, 16).padding(.vertical, 8)
                .background(Color(uiColor: .systemGroupedBackground))
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
            }.presentationDetents([.fraction(0.92)])
        }
    }
}
