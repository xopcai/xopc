import AVFoundation
import SwiftUI

// swiftlint:disable:next type_body_length
struct AppRootView: View {
    @Environment(\.scenePhase) private var scenePhase
    @State private var appState = AppState()
    @State private var realtimeVoiceCall = RealtimeVoiceCall()
    @State private var personalAgent = PersonalAgentState()
    @State private var settingsPresented = false
    @State private var quickDraft = ""
    @State private var keyboardVisible = false
    @State private var assistantInputFocused = false
    @State private var secondaryDockHeight: CGFloat = 0
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
                tabShell
            }
        }
        .tint(.blue)
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
                    onOpenSettings: { settingsPresented = true },
                    onInputFocusChanged: { assistantInputFocused = $0 }
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
                        onOpenPersonalAgent: {
                            Task {
                                let configuration = appState.gatewayConfiguration
                                guard let record = await personalAgent.open(using: configuration),
                                      configuration == appState.gatewayConfiguration else { return }
                                appState.openConversation(
                                    id: record.conversationId,
                                    title: record.displayName,
                                    agentId: record.agentId
                                )
                            }
                        },
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
            if appState.selectedTab == .conversations {
                Task { await personalAgent.refresh(using: appState.gatewayConfiguration) }
            }
        }
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
            if showTabs, !keyboardVisible, !assistantInputFocused, !quickInputFocused {
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
            }
        }
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

private struct LoopiPose {
    var lift: CGFloat = 0
    var ringAngle: Double = 0
    var gaze: CGFloat = 0
    var eyeOpen: CGFloat = 1
}

private struct LoopiMotionKey: Hashable {
    let active: Bool
    let compact: Bool
    let greeting: Int
}

struct LoopiIcon: View {
    let size: CGFloat
    let active: Bool
    var compact = false
    var interactive = false

    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.scenePhase) private var scenePhase
    @State private var pose = LoopiPose()
    @State private var greeting = 0
    @State private var pendingGreeting = false

    private var motionActive: Bool {
        active && scenePhase == .active && !reduceMotion
    }

    var body: some View {
        Group {
            if interactive {
                Button {
                    guard motionActive else { return }
                    pendingGreeting = true
                    greeting += 1
                } label: {
                    artwork
                }
                .buttonStyle(.plain)
                .accessibilityLabel("助手")
            } else {
                artwork
                    .accessibilityHidden(true)
            }
        }
        .task(id: LoopiMotionKey(active: motionActive, compact: compact, greeting: greeting)) {
            await runMotion()
        }
    }

    private var artwork: some View {
        ZStack {
            Image("LoopiRing")
                .renderingMode(.original)
                .resizable()
                .frame(width: size, height: size)
                .rotationEffect(.degrees(pose.ringAngle))
                .offset(y: pose.lift * size / 304)
            ZStack {
                Image("LoopiCore")
                    .renderingMode(.original)
                    .resizable()
                    .frame(width: size, height: size)
                Image("LoopiEyes")
                    .renderingMode(.original)
                    .resizable()
                    .frame(width: size * 52 / 304, height: size * 14 / 304)
                    .scaleEffect(x: 1, y: pose.eyeOpen)
                    .offset(x: pose.gaze * size / 304, y: -2 * size / 304)
            }
            .offset(y: pose.lift * size / 200)
        }
        .frame(width: size, height: size)
        .contentShape(.circle)
    }

    private func pause(_ milliseconds: Int) async -> Bool {
        do {
            try await Task.sleep(for: .milliseconds(milliseconds))
            return !Task.isCancelled
        } catch {
            return false
        }
    }

    private func move(to next: LoopiPose, duration: Double) {
        withAnimation(.easeInOut(duration: duration)) {
            pose = next
        }
    }

    // swiftlint:disable:next cyclomatic_complexity
    private func runMotion() async {
        pose = LoopiPose()
        guard motionActive else { return }

        if compact {
            guard await pause(120) else { return }
            move(to: LoopiPose(lift: -2), duration: 0.22)
            guard await pause(260) else { return }
            move(to: LoopiPose(lift: -2, eyeOpen: 0.12), duration: 0.11)
            guard await pause(140) else { return }
            move(to: LoopiPose(lift: -2), duration: 0.18)
            return
        }

        if pendingGreeting {
            pendingGreeting = false
            move(to: LoopiPose(lift: -5, eyeOpen: 0.25), duration: 0.16)
            guard await pause(450) else { return }
            move(to: LoopiPose(), duration: 0.36)
            guard await pause(1650) else { return }
        } else if await !pause(120) {
            return
        }

        while !Task.isCancelled {
            move(to: LoopiPose(lift: -4, ringAngle: -1.2, gaze: .random(in: -2.5 ... 2.5)), duration: 1.2)
            guard await pause(1400) else { return }
            move(to: LoopiPose(eyeOpen: 0.12), duration: 0.11)
            guard await pause(140) else { return }
            move(to: LoopiPose(), duration: 0.18)
            guard await pause(Int.random(in: 1860 ... 4160)) else { return }
        }
    }
}

#Preview {
    AppRootView()
}
