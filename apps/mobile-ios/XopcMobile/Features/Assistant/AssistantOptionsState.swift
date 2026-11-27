import Foundation
import Observation

@MainActor
@Observable
final class AssistantOptionsState {
    enum FailedOperation: Equatable {
        case load
        case save(refreshingVersion: Bool)
        case serviceTier(Bool)
    }

    private(set) var models: [ChatModel] = []
    private(set) var isLoading = false
    private(set) var isSaving = false
    private(set) var errorMessage: String?
    private(set) var failedOperation: FailedOperation?
    private var configVersion: Int?
    var selectedModelID = ""
    var thinkingLevel = "off"
    var serviceTier = "default"

    var selectedModel: ChatModel? {
        models.first { $0.id == selectedModelID }
    }

    var thinkingOptions: [String] {
        selectedModel?.thinking?.options ?? ["off"]
    }

    var fastTier: ChatModelServiceTier? {
        selectedModel?.fastServiceTier
    }

    var isFastModeEnabled: Bool {
        guard let fastTier else { return false }
        let normalized = serviceTier.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !normalized.isEmpty, normalized != "default" else { return false }
        return normalized == fastTier.id || selectedModel?.serviceTiers?.contains(where: { $0.id == normalized }) == true
    }

    func fastModeSubtitle(_ locale: Locale) -> String {
        let isZh = locale.language.languageCode?.identifier == "zh"
        let desc = fastTier?.description ?? ""
        let speed: String
        if let range = desc.range(of: #"\d+(?:\.\d+)?x\s*speed"#, options: [.regularExpression, .caseInsensitive]) {
            let token = desc[range].replacingOccurrences(of: "speed", with: "", options: .caseInsensitive)
                .trimmingCharacters(in: .whitespacesAndNewlines)
            speed = isZh ? "\(token) 极速" : "\(token) speed"
        } else {
            speed = isZh ? "1.5x 极速" : "1.5x speed"
        }
        return isZh ? "\(speed) · 消耗更多额度" : "\(speed) · More usage"
    }

    func load(_ conversation: ConversationSelection, using gateway: any GatewayServing) async {
        isLoading = true
        errorMessage = nil
        failedOperation = nil
        defer { isLoading = false }
        do {
            let catalog = try await gateway.fetchModels(agentID: conversation.agentId)
            models = catalog.models
            if conversation.isDraft {
                configVersion = nil
                selectedModelID = conversation.model ?? catalog.defaultId ?? models.first?.id ?? ""
                selectThinking(conversation.thinkingLevel)
                serviceTier = conversation.serviceTier ?? "default"
            } else {
                let configuration = try await gateway.fetchAgentConfiguration(conversationID: conversation.id)
                configVersion = configuration.configVersion
                selectedModelID = configuration.model ?? catalog.defaultId ?? models.first?.id ?? ""
                selectThinking(configuration.thinkingLevel)
                serviceTier = configuration.serviceTier ?? "default"
            }
        } catch {
            if !Task.isCancelled {
                errorMessage = error.localizedDescription
                failedOperation = .load
            }
        }
    }

    func selectModel(_ id: String) {
        selectedModelID = id
        selectThinking(thinkingLevel)
    }

    func save(
        _ conversation: ConversationSelection,
        using gateway: any GatewayServing,
        refreshingVersion: Bool = false
    ) async -> ConversationSelection? {
        guard !isSaving, !isLoading, !selectedModelID.isEmpty else { return nil }
        isSaving = true
        errorMessage = nil
        failedOperation = nil
        defer { isSaving = false }
        do {
            if !conversation.isDraft {
                if refreshingVersion {
                    configVersion = try await gateway.fetchAgentConfiguration(conversationID: conversation.id).configVersion
                }
                let saved = try await gateway.updateAgentConfiguration(
                    conversationID: conversation.id,
                    model: selectedModelID,
                    thinkingLevel: thinkingLevel,
                    configVersion: configVersion
                )
                configVersion = saved.configVersion
                selectedModelID = saved.model ?? selectedModelID
                selectThinking(saved.thinkingLevel ?? thinkingLevel)
                serviceTier = saved.serviceTier ?? serviceTier
            }
            return conversation.configured(model: selectedModelID, thinkingLevel: thinkingLevel, serviceTier: serviceTier)
        } catch {
            errorMessage = error.localizedDescription
            if case .http(statusCode: 409, message: _) = error as? GatewayClientError {
                failedOperation = .save(refreshingVersion: true)
            } else {
                failedOperation = .save(refreshingVersion: refreshingVersion)
            }
            return nil
        }
    }

    func toggleFastMode(
        _ enabled: Bool,
        for conversation: ConversationSelection,
        using gateway: any GatewayServing
    ) async -> ConversationSelection? {
        guard !isSaving, !isLoading, let fastTier else { return nil }
        let previous = serviceTier
        let nextTier = enabled ? fastTier.id : "default"
        serviceTier = nextTier
        isSaving = true
        errorMessage = nil
        failedOperation = nil
        defer { isSaving = false }
        do {
            if !conversation.isDraft {
                let saved = try await gateway.updateAgentServiceTier(
                    conversationID: conversation.id,
                    serviceTier: nextTier
                )
                configVersion = saved.configVersion ?? configVersion
                serviceTier = saved.serviceTier ?? nextTier
            }
            let effectiveModel = selectedModelID.isEmpty ? (conversation.model ?? "") : selectedModelID
            return conversation.configured(
                model: effectiveModel.isEmpty ? (conversation.model ?? "") : effectiveModel,
                thinkingLevel: thinkingLevel,
                serviceTier: serviceTier
            )
        } catch {
            serviceTier = previous
            errorMessage = error.localizedDescription
            failedOperation = .serviceTier(enabled)
            return nil
        }
    }

    func retry(_ conversation: ConversationSelection, using gateway: any GatewayServing) async -> ConversationSelection? {
        switch failedOperation {
        case .load:
            await load(conversation, using: gateway)
            return nil
        case let .save(refreshingVersion):
            return await save(conversation, using: gateway, refreshingVersion: refreshingVersion)
        case let .serviceTier(enabled):
            return await toggleFastMode(enabled, for: conversation, using: gateway)
        case nil:
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
