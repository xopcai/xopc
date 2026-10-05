import SwiftUI

struct AppRootView: View {
    @State private var appState = AppState()
    @State private var realtimeVoiceCall = RealtimeVoiceCall()
    @State private var settingsPresented = false
    @State private var quickDraft = ""
    @State private var keyboardVisible = false
    @State private var tabRootIDs: [AppTab: UUID] = [:]
    @FocusState private var quickInputFocused: Bool
    @AppStorage("app.language") private var language = AppLanguage.system.rawValue
    @AppStorage("app.appearance") private var appearance = AppAppearance.system.rawValue

    var body: some View {
        TabView(selection: $appState.selectedTab) {
            NavigationStack {
                AssistantView(
                    configuration: appState.gatewayConfiguration,
                    realtimeVoiceCall: realtimeVoiceCall,
                    conversation: appState.selectedConversation,
                    quickChatHandoff: appState.quickChatHandoff,
                    onStartConversation: appState.startConversation,
                    onConversationUpdated: appState.updateConversation,
                    onQuickChatHandled: appState.consumeQuickChatHandoff,
                    onOpenConversations: appState.showConversations,
                    onOpenSettings: { settingsPresented = true }
                ) { composer, isActionPanelExpanded in
                    bottomDock(showTabs: !isActionPanelExpanded) { composer }
                }
            }
            .id(TabRootIdentity(tab: .assistant, resetID: tabRootIDs[.assistant]))
            .tabItem { Label("助手", systemImage: "sparkles") }
            .tag(AppTab.assistant)
            .toolbar(.hidden, for: .tabBar)

            NavigationStack {
                ConversationsView(
                    configuration: appState.gatewayConfiguration,
                    onSelect: appState.open,
                    onStartNew: { appState.startConversation(agentId: "main") },
                    onOpenSettings: { settingsPresented = true }
                )
                .safeAreaInset(edge: .bottom, spacing: 0) { bottomDock { quickComposer } }
            }
            .id(TabRootIdentity(tab: .conversations, resetID: tabRootIDs[.conversations]))
            .tabItem { Label("对话", systemImage: "bubble.left.and.bubble.right") }
            .tag(AppTab.conversations)
            .toolbar(.hidden, for: .tabBar)

            NavigationStack {
                ProgressHubView(
                    configuration: appState.gatewayConfiguration,
                    onOpenConversation: appState.openConversation,
                    onStartProjectConversation: appState.startProjectConversation
                )
                .safeAreaInset(edge: .bottom, spacing: 0) { bottomDock { quickComposer } }
            }
            .id(TabRootIdentity(tab: .progress, resetID: tabRootIDs[.progress]))
            .tabItem { Label("进展", systemImage: "chart.line.uptrend.xyaxis") }
            .tag(AppTab.progress)
            .toolbar(.hidden, for: .tabBar)

            NavigationStack {
                NotesView(
                    configuration: appState.gatewayConfiguration,
                    onOpenConversation: appState.openConversation
                )
                .safeAreaInset(edge: .bottom, spacing: 0) { bottomDock { quickComposer } }
            }
            .id(TabRootIdentity(tab: .notes, resetID: tabRootIDs[.notes]))
            .tabItem { Label("笔记", systemImage: "note.text") }
            .tag(AppTab.notes)
            .toolbar(.hidden, for: .tabBar)

            NavigationStack {
                ProfileView(
                    configuration: appState.gatewayConfiguration,
                    onOpenGatewaySettings: { settingsPresented = true }
                )
                .safeAreaInset(edge: .bottom, spacing: 0) { bottomDock { quickComposer } }
            }
            .id(TabRootIdentity(tab: .profile, resetID: tabRootIDs[.profile]))
            .tabItem { Label("我的", systemImage: "person.crop.circle") }
            .tag(AppTab.profile)
            .toolbar(.hidden, for: .tabBar)
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
                configurations: appState.gatewayProfileConfigurations,
                activeProfileID: appState.activeGatewayProfileID,
                storageError: appState.connectionStorageError,
                onSave: appState.saveGatewayProfile,
                onActivate: appState.activateGatewayProfile,
                onRename: appState.renameGatewayProfile,
                onRemove: appState.removeGatewayProfile
            )
        }
        .onReceive(NotificationCenter.default.publisher(for: UIResponder.keyboardWillShowNotification)) { _ in
            keyboardVisible = true
        }
        .onReceive(NotificationCenter.default.publisher(for: UIResponder.keyboardWillHideNotification)) { _ in
            keyboardVisible = false
        }
    }

    private func bottomDock(
        showTabs: Bool = true,
        @ViewBuilder composer: () -> some View
    ) -> some View {
        VStack(spacing: 0) {
            composer()
            if showTabs, !keyboardVisible {
                HStack(spacing: 0) {
                    dockTab(.assistant, "助手", icon: "bubble.left")
                    dockTab(.conversations, "对话", icon: "bubble.left.and.bubble.right")
                    dockTab(.progress, "进展", icon: "checkmark.circle")
                    dockTab(.notes, "资料库", icon: "square.on.square")
                    dockTab(.profile, "我的", icon: "person")
                }
                .padding(.horizontal, 4)
                .padding(.top, 8)
                .padding(.bottom, 6)
            }
        }
        .frame(maxWidth: 720)
        .background(Color(uiColor: .systemBackground), in: .rect(cornerRadius: 24))
        .padding(.horizontal, 8)
        .padding(.top, 4)
        .frame(maxWidth: .infinity)
        .background(Color(uiColor: .systemGroupedBackground))
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
            .accessibilityLabel("语音对话")

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
            if appState.selectedTab == tab {
                tabRootIDs[tab] = UUID()
            } else {
                appState.selectedTab = tab
            }
        } label: {
            VStack(spacing: 3) {
                Image(systemName: icon)
                    .font(.system(size: 21, weight: .regular))
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

private struct TabRootIdentity: Hashable {
    let tab: AppTab
    let resetID: UUID?
}

#Preview {
    AppRootView()
}
