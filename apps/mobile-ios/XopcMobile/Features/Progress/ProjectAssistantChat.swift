import SwiftUI

@MainActor @Observable final class ProjectChatPresentation {
    var conversationID: String?
    var sidebarOpen = false
}

struct ProjectAssistantChat: View {
    let configuration: GatewayConfiguration
    let onSaveDraft: (ConversationSelection) throws -> Void
    let onMaterialized: (ConversationSelection) -> Void

    @Environment(\.dismiss) private var dismiss
    @Environment(ProjectChatPresentation.self) private var presentation
    @Environment(RealtimeVoiceCall.self) private var voiceCall
    @State private var selection: ConversationSelection
    @State private var project: ProjectRecord?
    @State private var error: String?

    init(configuration: GatewayConfiguration, project: ProjectRecord, selection: ConversationSelection,
         onSaveDraft: @escaping (ConversationSelection) throws -> Void,
         onMaterialized: @escaping (ConversationSelection) -> Void)
    {
        self.configuration = configuration
        self.onSaveDraft = onSaveDraft
        self.onMaterialized = onMaterialized
        _project = State(initialValue: project)
        _selection = State(initialValue: selection)
    }

    var body: some View {
        AssistantView(configuration: configuration, isActive: true, realtimeVoiceCall: voiceCall,
                      conversation: selection, personalAgent: nil,
                      onStartConversation: { start(project: project, mode: nil, agentID: $0) },
                      onStartScopedConversation: { start(project: $0, mode: $1, agentID: $2) },
                      onConversationUpdated: update, onOpenSettings: {}, onInputFocusChanged: { _ in },
                      onBack: { dismiss() }, onOpenSidebar: { presentation.sidebarOpen = true },
                      sidebarOpen: presentation.sidebarOpen) { $0 }
            .toolbar(.hidden, for: .navigationBar)
            .onAppear { presentation.conversationID = selection.id }
            .onChange(of: selection.id) { _, id in presentation.conversationID = id }
            .onDisappear {
                guard presentation.conversationID == selection.id else { return }
                presentation.sidebarOpen = false
                presentation.conversationID = nil
            }
            .alert("无法保存本地草稿", isPresented: Binding(get: { error != nil }, set: {
                if !$0 {
                    error = nil
                }
            })) {
                Button("关闭", role: .cancel) { error = nil }
            } message: { Text(error ?? "") }
    }

    private func start(project: ProjectRecord?, mode: String?, agentID: String) {
        let draft = project.map { ConversationSelection.projectDraft(project: $0, executionMode: mode, agentId: agentID) }
            ?? .draft(agentId: agentID)
        do {
            try onSaveDraft(draft)
            self.project = project
            selection = draft
        } catch { self.error = error.localizedDescription }
    }

    private func update(_ conversation: ConversationSelection) {
        guard conversation.id == selection.id else { return }
        if selection.isDraft, !conversation.isDraft {
            onMaterialized(selection)
        }
        selection = conversation
    }
}
