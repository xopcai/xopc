import SwiftUI

// swiftlint:disable file_length
// swiftlint:disable:next type_body_length
struct AssistantView<Dock: View>: View {
    let configuration: GatewayConfiguration
    let realtimeVoiceCall: RealtimeVoiceCall
    let conversation: ConversationSelection?
    let quickChatHandoff: QuickChatHandoff?
    let onStartConversation: (String) -> Void
    let onConversationUpdated: (ConversationSelection) -> Void
    let onQuickChatHandled: (UUID) -> Void
    let onOpenConversations: () -> Void
    let onOpenSettings: () -> Void
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
    @State private var optionsConversation: ConversationSelection?
    @State private var executionPresentation: ExecutionActivityPresentation?
    @State private var handledQuickChatID: UUID?
    @State private var readAloud = ChatReadAloud()

    var body: some View {
        ZStack {
            content
        }
        .safeAreaInset(edge: .bottom, spacing: 0) {
            VStack(spacing: 0) {
                if readAloud.state != .idle {
                    readAloudBar
                }
                bottomDock(composer, isActionPanelExpanded)
            }
        }
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
        .onDisappear { readAloud.stop() }
        .modifier(AttachmentPickerModifier(
            attachments: $attachments,
            errorMessage: $attachmentError,
            showingPhotoPicker: $showingPhotoPicker,
            showingFilePicker: $showingFilePicker,
            showingCameraPicker: $showingCameraPicker
        ))
        .sheet(item: $optionsConversation) { conversation in
            AssistantOptionsView(
                configuration: configuration,
                conversation: conversation,
                onSave: onConversationUpdated
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
            VoiceAttachmentRecorderView { attachment in
                guard attachments.count < AttachmentPolicy.maximumCount else {
                    attachmentError = "最多添加 \(AttachmentPolicy.maximumCount) 个附件"
                    return
                }
                attachments.append(attachment)
            }
        }
    }

    @ViewBuilder
    private var content: some View {
        if state.isLoading, state.agents.isEmpty {
            ProgressView("正在连接助手…")
                .frame(maxWidth: .infinity, maxHeight: .infinity)
        } else if let errorMessage = state.errorMessage, state.agents.isEmpty {
            ContentUnavailableView {
                Label("无法连接 Gateway", systemImage: "network.slash")
            } description: {
                Text(errorMessage)
            } actions: {
                Button("连接设置", action: onOpenSettings)
                Button("重试") {
                    Task {
                        await state.load(using: GatewayClient(configuration: configuration))
                    }
                }
            }
        } else if state.isLoadingHistory {
            ProgressView("正在读取消息…")
                .frame(maxWidth: .infinity, maxHeight: .infinity)
        } else if state.messages.isEmpty {
            ScrollView {
                LazyVStack(spacing: 16) {
                    contextSummary
                    clarificationCard
                    queueCard
                    welcome
                }
                .padding()
                .frame(maxWidth: 720)
                .frame(maxWidth: .infinity)
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
                contextSummary
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
                        readAloud: readAloud
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
    }

    private var conversationNavigationTitle: String {
        guard let title = conversation?.title, !showsConversationTitleInTimeline else {
            return AppLocalization.string("助手", locale: locale)
        }
        return title
    }

    private var showsConversationTitleInTimeline: Bool {
        guard let title = conversation?.title else { return false }
        return title.count > 14
    }

    private var contextSummary: some View {
        ConversationContextButton(
            configuration: configuration,
            conversation: conversation,
            state: state
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
        VStack(spacing: 14) {
            Image(systemName: "sparkles")
                .font(.system(.largeTitle, design: .rounded, weight: .semibold))
                .foregroundStyle(.blue)
                .accessibilityHidden(true)
            welcomeTitle
                .font(.title2.weight(.semibold))
                .multilineTextAlignment(.center)
            welcomeMessage
                .font(.body)
                .foregroundStyle(.secondary)
                .multilineTextAlignment(.center)
            if conversation == nil {
                Button("开始新对话") {
                    onStartConversation(state.selectedAgentID ?? "main")
                }
                .buttonStyle(.borderedProminent)
                .disabled(state.selectedAgentID == nil)
                Button("打开已有对话", action: onOpenConversations)
                    .buttonStyle(.bordered)
            }
        }
        .padding(.vertical, 28)
        .frame(maxWidth: .infinity)
    }

    private var composer: AssistantComposer {
        AssistantComposer(
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
            hasConversation: conversation != nil,
            canReferenceFiles: conversation?.isDraft == false,
            canStartRealtimeVoice: conversation?.isDraft == false && realtimeVoiceCall.phase == .idle,
            isRunActive: state.isRunActive,
            onStop: {
                Task { await state.stop(using: GatewayClient(configuration: configuration)) }
            },
            onSend: { send(delivery: .next) },
            onSteer: { send(delivery: .steer) },
            onNewConversation: { onStartConversation(state.selectedAgentID ?? "main") },
            onRealtimeVoice: { mode in
                guard let conversation, !conversation.isDraft else { return }
                Task {
                    await realtimeVoiceCall.start(
                        conversationID: conversation.id,
                        mode: mode,
                        name: conversation.title,
                        gateway: GatewayClient(configuration: configuration)
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
                    state.selectedAgent?.displayName ?? AppLocalization.string("选择助手", locale: locale),
                    systemImage: "person.crop.circle"
                )
            }
            .accessibilityLabel(AppLocalization.resolve(
                "当前助手：\(state.selectedAgent?.displayName ?? AppLocalization.string("未选择", locale: locale))",
                locale: locale
            ))
        }

        ToolbarItem(placement: .topBarTrailing) {
            HStack {
                Button {
                    onStartConversation(state.selectedAgentID ?? "main")
                } label: {
                    Image(systemName: "square.and.pencil")
                }
                .accessibilityLabel("新对话")
                if let conversation {
                    Button {
                        optionsConversation = conversation
                    } label: {
                        Image(systemName: "slider.horizontal.3")
                    }
                    .accessibilityLabel("助手设置")
                }
                Button(action: onOpenSettings) {
                    Image(systemName: "gearshape")
                }
                .accessibilityLabel("连接设置")
            }
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
    var welcomeTitle: Text {
        if let conversation {
            return Text(verbatim: conversation.title)
        }
        if let agent = state.selectedAgent {
            return Text("和 \(agent.displayName) 一起开始")
        }
        return Text("从一个想法开始")
    }

    var welcomeMessage: Text {
        if let conversation {
            return Text("由 \(conversation.agentId) 助手处理，发送消息后会实时显示回答。")
        }
        if let description = state.selectedAgent?.description {
            return Text(verbatim: description)
        }
        return Text("告诉助手你想完成什么，项目和上下文可以随后补充。")
    }

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
