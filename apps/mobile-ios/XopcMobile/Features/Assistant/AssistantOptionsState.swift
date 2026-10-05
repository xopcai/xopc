import Foundation
import Observation

@MainActor
@Observable
final class AssistantOptionsState {
    private(set) var models: [ChatModel] = []
    private(set) var isLoading = false
    private(set) var isSaving = false
    private(set) var errorMessage: String?
    var selectedModelID = ""
    var thinkingLevel = "off"

    var selectedModel: ChatModel? {
        models.first { $0.id == selectedModelID }
    }

    var thinkingOptions: [String] {
        selectedModel?.thinking?.options ?? ["off"]
    }

    func load(_ conversation: ConversationSelection, using gateway: any GatewayServing) async {
        isLoading = true
        errorMessage = nil
        defer { isLoading = false }
        do {
            let catalog = try await gateway.fetchModels(agentID: conversation.agentId)
            models = catalog.models
            if conversation.isDraft {
                selectedModelID = conversation.model ?? catalog.defaultId ?? models.first?.id ?? ""
                selectThinking(conversation.thinkingLevel)
            } else {
                let configuration = try await gateway.fetchAgentConfiguration(conversationID: conversation.id)
                selectedModelID = configuration.model ?? catalog.defaultId ?? models.first?.id ?? ""
                selectThinking(configuration.thinkingLevel)
            }
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    func selectModel(_ id: String) {
        selectedModelID = id
        selectThinking(nil)
    }

    func save(
        _ conversation: ConversationSelection,
        using gateway: any GatewayServing
    ) async -> ConversationSelection? {
        guard !selectedModelID.isEmpty else { return nil }
        isSaving = true
        errorMessage = nil
        defer { isSaving = false }
        do {
            if !conversation.isDraft {
                try await gateway.updateAgentConfiguration(
                    conversationID: conversation.id,
                    model: selectedModelID,
                    thinkingLevel: thinkingLevel
                )
            }
            return conversation.configured(model: selectedModelID, thinkingLevel: thinkingLevel)
        } catch {
            errorMessage = error.localizedDescription
            return nil
        }
    }

    private func selectThinking(_ preferred: String?) {
        let options = thinkingOptions
        if let preferred, options.contains(preferred) {
            thinkingLevel = preferred
        } else {
            thinkingLevel = selectedModel?.thinking?.initialValue ?? options.first ?? "off"
        }
    }
}
