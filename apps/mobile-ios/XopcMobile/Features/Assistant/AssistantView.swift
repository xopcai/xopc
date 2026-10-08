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
    let onOpenSettings: () -> Void
    let onInputFocusChanged: (Bool) -> Void
    let bottomDock: (AssistantComposer, Bool) -> Dock

    @Environment(\.locale) private var locale

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
    @State private var executionPresentation: ExecutionActivityPresentation?
    @State private var handledQuickChatID: UUID?
    @State private var readAloud = ChatReadAloud()
    @State private var startingVoice = false
    @State private var voiceStartError: String?
    @State private var voiceMaterializationIDs: [String: String] = [:]
    @State private var bottomDockHeight: CGFloat = 0

    var body: some View {
        ZStack(alignment: .bottom) {
            content
                .frame(maxWidth: .infinity, maxHeight: .infinity)
                .clipped()
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
        .navigationTitle(conversationNavigationTitle)
        .navigationBarTitleDisplayMode(.inline)
        .toolbar { toolbarContent }
        .task(id: configuration) {
            await state.load(using: GatewayClient(configuration: configuration))
        }
        .task(id: ConversationLoadKey(
            configuration: configuration,
            conversationID: conversation?.id,
            transcriptID: conversation?.transcriptId,
            isDraft: conversation?.isDraft
        )) {
            await state.loadConversation(conversation, using: GatewayClient(configuration: configuration))
        }
        .onChange(of: conversation?.id) {
            readAloud.stop()
            executionPresentation = nil
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
            readAloud.stop()
            onInputFocusChanged(false)
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
                pendingReferences: references,
                onAddReference: { reference in
                    guard references.count < 5,
                          !references.contains(where: { $0.id == reference.id }) else { return }
                    references.append(reference)
                },
                onConversationUpdated: onConversationUpdated,
                onStartScopedConversation: { project, mode in
                    onStartScopedConversation(project, mode, conversation?.agentId ?? state.selectedAgentID ?? "main")
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
                guard attachments.count < AttachmentPolicy.maximumCount else {
                    attachmentError = "最多添加 \(AttachmentPolicy.maximumCount) 个附件"
                    return
                }
                attachments.append(attachment)
            } onTranscribed: { text in
                let existing = draft.trimmingCharacters(in: .whitespacesAndNewlines)
                draft = existing.isEmpty ? text : "\(existing) \(text)"
            }
        }
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
                    .font(.title2.bold())
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
                        welcome
                    }
                    .padding()
                    .frame(maxWidth: 720)
                    .frame(maxWidth: .infinity)
                    .frame(minHeight: max(0, viewport.size.height - bottomDockHeight - 24))
                }
                .contentMargins(.bottom, bottomDockHeight + 24, for: .scrollContent)
            }
        } else {
            messageTimeline
        }
    }

    private var messageTimeline: some View {
        ScrollView {
            LazyVStack(spacing: 14) {
                if showsConversationTitleInTimeline, let conversation {
                    Text(verbatim: conversation.title)
                        .font(.headline)
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
                ForEach(state.messages) { message in
                    MessageBubble(
                        message: message,
                        configuration: configuration,
                        conversationID: conversation?.isDraft == false ? conversation?.id : nil,
                        assistantState: state,
                        readAloud: readAloud,
                        canReadAloud: realtimeVoiceCall.phase == .idle,
                        previewEligible: message.id != state.messages.last?.id
                    )
                }
                if state.isRunActive {
                    AssistantActivityView(
                        label: state.activityLabel ?? AppLocalization.string("助手正在处理", locale: locale),
                        items: state.executionActivity,
                        runID: state.runID,
                        onOpen: {
                            executionPresentation = ExecutionActivityPresentation(
                                conversationID: conversation?.isDraft == false ? conversation?.id : nil,
                                runID: state.runID,
                                items: state.executionActivity
                            )
                        }
                    )
                }
            }
            .padding()
            .frame(maxWidth: 720)
            .frame(maxWidth: .infinity)
        }
        .defaultScrollAnchor(.bottom)
        .contentMargins(.bottom, bottomDockHeight + 24, for: .scrollContent)
    }

    private var conversationNavigationTitle: String {
        if isPersonalConversation { return personalAgent?.displayName ?? "Ada" }
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
            : (state.selectedAgent?.displayName ?? AppLocalization.string("未选择", locale: locale))
    }

    private var readAloudBar: some View {
        HStack(spacing: 12) {
            Image(systemName: "speaker.wave.2.fill")
                .foregroundStyle(.blue)
            VStack(alignment: .leading, spacing: 2) {
                Text(readAloud.state == .failed
                    ? LocalizedStringResource("朗读失败")
                    : LocalizedStringResource("正在朗读"))
                    .font(.subheadline.weight(.semibold))
                if let error = readAloud.errorMessage {
                    Text(error).font(.caption).foregroundStyle(.red).lineLimit(2)
                } else {
                    Text("\(readAloud.chunkIndex + 1)/\(readAloud.chunkCount)")
                        .font(.caption).foregroundStyle(.secondary)
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
                    .font(.subheadline)
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
            onNewConversation: { onStartConversation(state.selectedAgentID ?? "main") },
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

    @ToolbarContentBuilder
    private var toolbarContent: some ToolbarContent {
        ToolbarItem(placement: .topBarLeading) {
            Menu {
                if state.agents.isEmpty {
                    Text("暂无助手")
                } else {
                    ForEach(state.agents) { agent in
                        Button {
                            state.select(agent)
                            onStartConversation(agent.id)
                        } label: {
                            if agent.id == state.selectedAgentID {
                                Label(agent.displayName, systemImage: "checkmark")
                            } else {
                                Text(agent.displayName)
                            }
                        }
                    }
                }
            } label: {
                Label(
                    currentAgentName,
                    systemImage: "person.crop.circle"
                )
            }
            .accessibilityLabel(AppLocalization.resolve("当前助手：\(currentAgentName)", locale: locale))
        }

        ToolbarItem(placement: .topBarTrailing) {
            Button {
                showingSessionActions = true
            } label: {
                Image(systemName: "ellipsis")
            }
            .accessibilityLabel("会话信息与设置")
        }
    }
}

private struct ErrorBanner: View {
    let message: String

    @Environment(\.locale) private var locale

    var body: some View {
        Label(message, systemImage: "exclamationmark.triangle.fill")
            .font(.subheadline)
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
}

private extension AssistantView {
    @ViewBuilder
    var queueCard: some View {
        if !state.pendingInputs.isEmpty || state.queueError != nil, let conversation {
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
                onRespond: { action, answer in
                    Task {
                        await state.respondToClarification(
                            action: action,
                            answer: answer,
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
