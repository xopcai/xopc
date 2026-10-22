import AVFoundation
import SwiftUI

// swiftlint:disable:next type_body_length
struct AppRootView: View {
    @Environment(\.scenePhase) private var scenePhase
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var assistantScene: AssistantScene = .work
    @State private var workConversation: ConversationSelection?
    @State private var workTab: AppTab = .assistant
    @State private var sceneOpening = false
    @State private var sceneRequest = 0
    @State private var sceneError: String?
    @State private var appState = AppState()
    @State private var realtimeVoiceCall = RealtimeVoiceCall()
    @State private var personalAgent = PersonalAgentState()
    @State private var settingsPresented = false
    @State private var quickDraft = ""
    @State private var keyboardVisible = false
    @State private var assistantInputFocused = false
    @State private var secondaryDockHeight: CGFloat = 0
    @State private var messageLinks = ChatMessageLinkRouter()
    @FocusState private var quickInputFocused: Bool
    @AppStorage("app.language") private var language = AppLanguage.system.rawValue
    @AppStorage("app.appearance") private var appearance = AppAppearance.system.rawValue

    var body: some View {
        Group {
            if appState.gatewayConfiguration.token.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                GatewayProfileEditor(
                    onPair: appState.pairGateway,
                    canCancel: false,
                    onManage: appState.gatewayProfiles.isEmpty ? nil : { settingsPresented = true }
                )
            } else {
                sceneShell
            }
        }
        .mobileTextStyle(.body)
        .tint(.blue)
        .environment(\.openURL, OpenURLAction { url in
            if let target = ChatMessageLink.resolve(url.absoluteString) {
                messageLinks.open(target, appState: appState)
                return .handled
            }
            return ChatMessageLink.externalURL(url) ? .systemAction(url) : .discarded
        })
        .environment(\.locale, (AppLanguage(rawValue: language) ?? .system).locale)
        .preferredColorScheme((AppAppearance(rawValue: appearance) ?? .system).colorScheme)
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
        .sheet(item: $messageLinks.destination) { link in
            ChatMessageLinkDestination(link: link, appState: appState, router: messageLinks)
        }
        .alert("无法打开链接", isPresented: Binding(get: { messageLinks.errorMessage != nil }, set: {
            if !$0 {
                messageLinks.errorMessage = nil
            }
        })) {
            Button("关闭", role: .cancel) { messageLinks.errorMessage = nil }
        } message: { Text(messageLinks.errorMessage ?? "") }
        .onChange(of: scenePhase) {
            if scenePhase == .active {
                Task { await appState.refreshGatewayOnForeground() }
                Task { await realtimeVoiceCall.resumeAfterInterruption() }
            }
        }
        .onReceive(NotificationCenter.default.publisher(for: AVAudioSession.interruptionNotification)) { notification in
            guard let raw = notification.userInfo?[AVAudioSessionInterruptionTypeKey] as? UInt,
                  raw == AVAudioSession.InterruptionType.ended.rawValue else { return }
            Task { await realtimeVoiceCall.resumeAfterInterruption() }
        }
        .onReceive(NotificationCenter.default.publisher(for: UIResponder.keyboardWillShowNotification)) { _ in
            keyboardVisible = true
        }
        .onReceive(NotificationCenter.default.publisher(for: UIResponder.keyboardDidShowNotification)) { _ in
            keyboardVisible = true
        }
        .onReceive(NotificationCenter.default.publisher(for: UIResponder.keyboardWillHideNotification)) { _ in
            keyboardVisible = false
            assistantInputFocused = false
            quickInputFocused = false
        }
        .onReceive(NotificationCenter.default.publisher(for: UIResponder.keyboardDidHideNotification)) { _ in
            keyboardVisible = false
            assistantInputFocused = false
            quickInputFocused = false
        }
    }

    private var sceneAnimation: Animation? {
        reduceMotion ? nil : .spring(response: 0.54, dampingFraction: 0.92)
    }

    private var sceneShell: some View {
        tabShell
            .alert("无法打开生活模式", isPresented: Binding(get: { sceneError != nil }, set: {
                if !$0 {
                    sceneError = nil
                }
            })) {
                Button("关闭", role: .cancel) { sceneError = nil }
            } message: { Text(verbatim: sceneError ?? "") }
            .onChange(of: appState.gatewayConfiguration) {
                sceneRequest += 1
                assistantScene = .work
                workConversation = nil
                sceneOpening = false
            }
    }

    private func selectScene(_ scene: AssistantScene) {
        sceneRequest += 1
        let request = sceneRequest
        guard scene == .life else {
            sceneOpening = false
            guard assistantScene == .life else { return }
            withAnimation(sceneAnimation) {
                appState.restoreConversation(workConversation)
                appState.selectedTab = workTab
                assistantScene = .work
            }
            return
        }
        guard assistantScene != .life, !sceneOpening, !personalAgent.isOpening else { return }
        sceneOpening = true
        sceneError = nil
        let configuration = appState.gatewayConfiguration
        let selection = appState.selectedConversation
        let tab = appState.selectedTab
        Task {
            defer {
                if sceneRequest == request {
                    sceneOpening = false
                }
            }
            let record = await personalAgent.open(using: configuration)
            guard sceneRequest == request, configuration == appState.gatewayConfiguration,
                  selection == appState.selectedConversation, tab == appState.selectedTab else { return }
            guard let record, record.isReady else { sceneError = personalAgent.errorMessage ?? "暂时无法打开生活模式，请重试。"; return }
            workConversation = selection
            workTab = tab
            withAnimation(sceneAnimation) {
                appState.openConversation(id: record.conversationId, title: record.displayName, agentId: record.agentId)
                assistantScene = .life
            }
        }
    }

    private var tabShell: some View {
        TabView(selection: $appState.selectedTab) {
            NavigationStack {
                AssistantView(
                    configuration: appState.gatewayConfiguration,
                    isActive: appState.selectedTab == .assistant,
                    realtimeVoiceCall: realtimeVoiceCall,
                    conversation: appState.selectedConversation,
                    personalAgent: personalAgent.record,
                    quickChatHandoff: appState.quickChatHandoff,
                    onStartConversation: appState.startConversation,
                    onStartScopedConversation: appState.startScopedConversation,
                    onConversationUpdated: appState.updateConversation,
                    onQuickChatHandled: appState.consumeQuickChatHandoff,
                    onPersonalAgentUpdated: personalAgent.applyProfile,
                    onOpenSettings: { settingsPresented = true },
                    onInputFocusChanged: { assistantInputFocused = $0 },
                    scene: assistantScene, sceneOpening: sceneOpening || personalAgent.isOpening, onSelectScene: selectScene
                ) { composer, isActionPanelExpanded in
                    bottomDock(showTabs: !isActionPanelExpanded) { composer }
                }
            }
            .tabItem { Label("助手", systemImage: "sparkles") }
            .tag(AppTab.assistant)
            .toolbar(.hidden, for: .tabBar)

            NavigationStack {
                secondaryTab {
                    ConversationsView(
                        configuration: appState.gatewayConfiguration,
                        onSelect: appState.open,
                        onStartNew: { appState.startConversation(agentId: "main") },
                        personalAgent: personalAgent.record,
                        personalAgentLoading: personalAgent.isLoading || personalAgent.isOpening,
                        personalAgentError: personalAgent.errorMessage,
                        onOpenPersonalAgent: openPersonalAgent,
                        onOpenSettings: { settingsPresented = true },
                        bottomInset: secondaryDockHeight + 24
                    )
                }
            }
            .tabItem { Label("对话", systemImage: "bubble.left.and.bubble.right") }
            .tag(AppTab.conversations)
            .toolbar(.hidden, for: .tabBar)

            NavigationStack {
                secondaryTab {
                    ProgressHubView(
                        configuration: appState.gatewayConfiguration,
                        onOpenConversation: appState.openConversation,
                        onStartProjectConversation: appState.startProjectConversation,
                        bottomInset: secondaryDockHeight + 24
                    )
                }
            }
            .tabItem { Label("进展", systemImage: "chart.line.uptrend.xyaxis") }
            .tag(AppTab.progress)
            .toolbar(.hidden, for: .tabBar)

            NavigationStack {
                secondaryTab {
                    NotesView(
                        configuration: appState.gatewayConfiguration,
                        onOpenConversation: appState.openConversation,
                        bottomInset: secondaryDockHeight + 24
                    )
                }
            }
            .tabItem { Label("笔记", systemImage: "note.text") }
            .tag(AppTab.notes)
            .toolbar(.hidden, for: .tabBar)

            NavigationStack {
                secondaryTab {
                    ProfileView(
                        configuration: appState.gatewayConfiguration,
                        onOpenGatewaySettings: { settingsPresented = true },
                        personalAgent: personalAgent.record,
                        personalAgentLoading: personalAgent.isLoading || personalAgent.isOpening,
                        personalAgentError: personalAgent.errorMessage,
                        onOpenPersonalAgent: openPersonalAgent,
                        onPersonalAgentUpdated: personalAgent.applyProfile,
                        bottomInset: secondaryDockHeight + 24
                    )
                }
            }
            .tabItem { Label("我的", systemImage: "person.crop.circle") }
            .tag(AppTab.profile)
            .toolbar(.hidden, for: .tabBar)
        }
        .task(id: appState.gatewayConfiguration) {
            await personalAgent.refresh(using: appState.gatewayConfiguration)
        }
        .onChange(of: appState.selectedTab) {
            if appState.selectedTab == .conversations || appState.selectedTab == .profile {
                Task { await personalAgent.refresh(using: appState.gatewayConfiguration) }
            }
        }
    }

    private func openPersonalAgent() {
        selectScene(.life)
    }

    private func secondaryTab(@ViewBuilder content: () -> some View) -> some View {
        ZStack(alignment: .bottom) {
            content()
                .frame(maxWidth: .infinity, maxHeight: .infinity)
                .clipped()
                .overlay(alignment: .bottom) {
                    Color(uiColor: .systemGroupedBackground)
                        .frame(height: 24)
                        .ignoresSafeArea(edges: .bottom)
                        .allowsHitTesting(false)
                }
            bottomDock { quickComposer }
                .onGeometryChange(for: CGFloat.self) { $0.size.height } action: { secondaryDockHeight = $0 }
        }
        .background(Color(uiColor: .systemGroupedBackground).ignoresSafeArea())
    }

    private func bottomDock(
        showTabs: Bool = true,
        @ViewBuilder composer: () -> some View
    ) -> some View {
        VStack(spacing: 0) {
            composer()
            if showTabs, assistantScene == .work, !keyboardVisible, !assistantInputFocused, !quickInputFocused {
                HStack(spacing: 0) {
                    dockTab(.assistant, "助手", icon: "bubble.left")
                    dockTab(.conversations, "对话", icon: "bubble.left.and.bubble.right")
                    dockTab(.progress, "进展", icon: "checkmark.circle")
                    dockTab(.notes, "笔记", icon: "note.text")
                    dockTab(.profile, "我的", icon: "person")
                }
                .padding(.horizontal, 4)
                .padding(.top, 8)
                .padding(.bottom, 6)
                .transition(reduceMotion ? .opacity : .move(edge: .bottom).combined(with: .opacity))
            }
        }
        .animation(sceneAnimation, value: assistantScene)
        .frame(maxWidth: 720)
        .background(Color(uiColor: .systemBackground), in: .rect(cornerRadius: 24))
        .clipShape(.rect(cornerRadius: 24))
        .shadow(color: .black.opacity(0.06), radius: 12, y: -2)
        .padding(.horizontal, 8)
        .padding(.top, 4)
        .frame(maxWidth: .infinity)
    }

    private var quickComposer: some View {
        HStack(spacing: 8) {
            Button {
                openQuickChat(.voice)
            } label: {
                Image(systemName: "mic")
                    .font(.system(size: 22))
                    .frame(width: 40, height: 44)
            }
            .accessibilityLabel("语音输入")

            TextField(quickPlaceholder, text: $quickDraft, axis: .vertical)
                .focused($quickInputFocused)
                .lineLimit(1 ... 3)
                .submitLabel(.send)
                .onSubmit { openQuickChat(.send) }
                .accessibilityIdentifier("home-quick-composer")

            if quickDraft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                Button {
                    openQuickChat(.attachments)
                } label: {
                    Image(systemName: "plus.circle")
                        .font(.system(size: 24))
                        .frame(width: 40, height: 44)
                }
                .accessibilityLabel("添加内容")
            } else {
                Button {
                    openQuickChat(.send)
                } label: {
                    Image(systemName: "arrow.up.circle.fill")
                        .font(.system(size: 28))
                        .frame(width: 40, height: 44)
                }
                .accessibilityLabel("发送快捷消息")
            }
        }
        .foregroundStyle(.blue)
        .padding(.horizontal, 8)
        .padding(.vertical, 5)
        .background(Color(uiColor: .systemGray5), in: .rect(cornerRadius: 18))
        .padding(.horizontal, 8)
        .padding(.top, 8)
    }

    private var quickPlaceholder: LocalizedStringKey {
        switch appState.selectedTab {
        case .assistant, .conversations: "开始一个新对话"
        case .progress: "询问进展，或推进下一步"
        case .notes: "查找、整理或引用资料"
        case .profile: "告诉 xopc 你的偏好和习惯"
        }
    }

    private func dockTab(_ tab: AppTab, _ title: LocalizedStringKey, icon: String) -> some View {
        Button {
            quickInputFocused = false
            appState.selectedTab = tab
        } label: {
            VStack(spacing: 3) {
                Group {
                    if tab == .assistant {
                        LoopiIcon(size: 28, active: appState.selectedTab == .assistant, compact: true)
                    } else {
                        Image(systemName: icon)
                            .font(.system(size: 21, weight: .regular))
                    }
                }
                .frame(width: 42, height: 28)
                .background(
                    appState.selectedTab == tab ? Color.blue.opacity(0.12) : .clear,
                    in: .capsule
                )
                Text(title)
                    .font(.system(size: 11, weight: .medium))
                    .lineLimit(1)
            }
            .foregroundStyle(appState.selectedTab == tab ? .blue : .secondary)
            .frame(maxWidth: .infinity)
            .frame(height: 48)
            .contentShape(.rect)
        }
        .buttonStyle(.plain)
        .accessibilityIdentifier("home-tab-\(tab)")
        .accessibilityAddTraits(appState.selectedTab == tab ? .isSelected : [])
    }

    private func openQuickChat(_ action: QuickChatHandoff.Action) {
        let text = quickDraft.trimmingCharacters(in: .whitespacesAndNewlines)
        if action == .send, text.isEmpty {
            return
        }
        quickInputFocused = false
        quickDraft = ""
        appState.openQuickChat(QuickChatHandoff(text: text, action: action))
    }
}

#Preview {
    AppRootView()
}
