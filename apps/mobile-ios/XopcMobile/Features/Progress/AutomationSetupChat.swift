import SwiftUI

enum AutomationChatScope: Equatable {
    case workspace
    case project(String)
    case personal

    var examples: [String] {
        switch self {
        case .workspace:
            ["每个工作日早上 9 点，汇总今天需要关注的事项。", "每周五下午 5 点，给我一份本周进展周报。",
             "每周一上午 10 点，检查最近失败的自动化并给出处理建议。"]
        case .project:
            ["每周五下午 5 点，汇总这个项目的进展和风险。", "每个工作日早上 9 点，提醒我这个项目中快到期的任务。",
             "每周一上午 10 点，整理这个项目最近新增的资料。"]
        case .personal:
            ["每天早上 8 点，提醒我查看待处理事项。", "每个工作日晚上 6 点，帮我回顾今天的任务。",
             "每周日晚上 8 点，帮我准备下周计划。"]
        }
    }
}

struct AutomationExamples: View {
    let scope: AutomationChatScope
    let choose: (String) -> Void
    @Environment(\.locale) private var locale

    var body: some View {
        ForEach(scope.examples, id: \.self) { prompt in
            Button {
                choose(AppLocalization.string(prompt, locale: locale))
            } label: {
                Label(LocalizedStringKey(prompt), systemImage: "clock")
                    .multilineTextAlignment(.leading)
                    .frame(maxWidth: .infinity, minHeight: 44, alignment: .leading)
            }
            .accessibilityIdentifier("schedule-example")
        }
    }
}

struct AutomationSetupPresentation: ViewModifier {
    let configuration: GatewayConfiguration
    let scope: AutomationChatScope
    @Binding var prompt: String?
    let onClosed: () -> Void
    @Environment(\.locale) private var locale
    @State private var conversation: ConversationSelection?
    @State private var error: String?

    func body(content: Content) -> some View {
        content
            .task(id: prompt) {
                guard let prompt else { return }
                do {
                    let selection = try await GatewayClient(configuration: configuration)
                        .openAutomationSetup(scope, locale: locale.identifier)
                    try Task.checkCancellation()
                    let key = ComposerDraftStore.scope(configuration, conversationID: selection.id)
                    let store = ComposerDraftStore()
                    if !prompt.isEmpty {
                        var saved = try store.read(key)
                        if saved.text.isEmpty {
                            saved.text = prompt
                            try store.save(saved, scope: key)
                        }
                    }
                    conversation = selection
                    self.prompt = nil
                } catch is CancellationError {
                } catch {
                    if !Task.isCancelled {
                        self.prompt = nil
                        self.error = error.localizedDescription
                    }
                }
            }
            .fullScreenCover(item: $conversation, onDismiss: onClosed) { selection in
                NavigationStack {
                    ScopedAssistantChat(configuration: configuration, selection: selection,
                                        heading: "用对话创建定时任务", automationSetup: true)
                }
            }
            .alert("无法打开定时任务对话", isPresented: Binding(get: { error != nil }, set: {
                if !$0 {
                    error = nil
                }
            })) {
                Button("关闭", role: .cancel) {}
            } message: { Text(error ?? "") }
    }
}

struct ScopedAssistantChat: View {
    let configuration: GatewayConfiguration
    let heading: LocalizedStringKey
    var automationSetup = false
    let onMaterialized: (ConversationSelection) -> Void
    @State private var selection: ConversationSelection
    @State private var voiceCall = RealtimeVoiceCall()
    @Environment(\.dismiss) private var dismiss

    init(configuration: GatewayConfiguration, selection: ConversationSelection, heading: LocalizedStringKey,
         automationSetup: Bool = false, onMaterialized: @escaping (ConversationSelection) -> Void = { _ in })
    {
        self.configuration = configuration
        self.heading = heading
        self.automationSetup = automationSetup
        self.onMaterialized = onMaterialized
        _selection = State(initialValue: selection)
    }

    var body: some View {
        AssistantView(configuration: configuration, isActive: true, realtimeVoiceCall: voiceCall,
                      conversation: selection, personalAgent: nil,
                      onStartConversation: { _ in }, onStartScopedConversation: { _, _, _ in },
                      onConversationUpdated: { updated in
                          let wasDraft = selection.isDraft
                          selection = updated
                          if wasDraft, !updated.isDraft {
                              onMaterialized(updated)
                          }
                      }, onPersonalAgentUpdated: { _ in },
                      onOpenSettings: {}, onInputFocusChanged: { _ in }, showsFloatingHeader: false,
                      automationSetup: automationSetup) { $0 }
            .navigationTitle(heading)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                if automationSetup {
                    ToolbarItem(placement: .cancellationAction) {
                        Button("关闭", systemImage: "xmark", action: { dismiss() }).labelStyle(.iconOnly)
                            .accessibilityIdentifier("automation-setup-close")
                    }
                }
            }
    }
}

extension GatewayClient {
    func openAutomationSetup(_ scope: AutomationChatScope, locale: String) async throws -> ConversationSelection {
        struct Scope: Encodable { var projectId: String?; var personalLocale: String? }
        struct Response: Decodable { let conversationId: String }
        let body = switch scope {
        case .workspace: Scope()
        case let .project(id): Scope(projectId: id)
        case .personal: Scope(personalLocale: locale.hasPrefix("zh") ? "zh" : "en")
        }
        let response: Response
        do {
            response = try await request(path: "/api/automations/configuration-conversations", method: "POST",
                                         body: encoder.encode(body))
        } catch GatewayClientError.http(statusCode: 400, message: _) where scope == .personal {
            throw GatewayClientError.server(AppLocalization.string("请先更新 Gateway，再创建个人定时任务。", locale: Locale(identifier: locale)))
        }
        guard UUID(uuidString: response.conversationId) != nil else { throw GatewayClientError.invalidResponse }
        return .existing(id: response.conversationId, title: "", agentId: "main")
    }
}
