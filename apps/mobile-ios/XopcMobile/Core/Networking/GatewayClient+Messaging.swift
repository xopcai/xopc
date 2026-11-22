import Foundation

extension GatewayClient {
    func sendMessage(
        _ text: String,
        attachments: [MessageAttachment],
        references: [ContextReference],
        to conversation: ConversationSelection,
        clientMessageID: String
    ) async throws -> SessionCommandResult {
        if !conversation.isDraft, Self.isTaskDestructiveCommand(text) {
            let context = try await fetchContext(conversationID: conversation.id)
            guard !context.unavailableSections.contains("work") else {
                throw GatewayClientError.server("会话任务归属暂不可用，请稍后重试")
            }
            if context.work.task != nil {
                throw GatewayClientError.server("任务需要保留连续对话，不能在这里重置或归档")
            }
        }
        let body = try await messageBody(
            text,
            attachments: attachments,
            references: references,
            conversation: conversation,
            clientMessageID: clientMessageID
        )
        let inputPath = conversation.taskID.map { "/api/tasks/\($0)/inputs" } ?? "/api/sessions/\(conversation.id)/inputs"
        let envelope: GatewayEnvelope<SessionCommandResult> = try await request(
            path: inputPath,
            queryItems: [URLQueryItem(name: "view", value: "compact")],
            method: "POST",
            body: body
        )
        guard envelope.isSuccessful, let result = envelope.payload else {
            throw GatewayClientError.server(envelope.error?.message ?? "消息未被 Gateway 接受")
        }
        return result
    }

    static func isTaskDestructiveCommand(_ text: String) -> Bool {
        let token = text.trimmingCharacters(in: .whitespacesAndNewlines)
            .split(whereSeparator: \.isWhitespace).first.map(String.init) ?? ""
        guard token.hasPrefix("/") else { return false }
        let name = token.dropFirst().split(separator: "@", maxSplits: 1).first?.lowercased() ?? ""
        return ["new", "reset", "restart", "clear", "archive"].contains(name)
    }

    private func messageBody(
        _ text: String,
        attachments: [MessageAttachment],
        references: [ContextReference],
        conversation: ConversationSelection,
        clientMessageID: String
    ) async throws -> Data {
        async let origin = DeviceEndpointPool.shared.origin(for: self)
        if conversation.isDraft {
            let selection = try await startModelSelection(for: conversation)
            let readyOrigin = try await origin
            let input = inputCommand(text: text, attachments: attachments, references: references, origin: readyOrigin)
            return try encoder.encode(StartMessageCommand(
                clientMessageId: clientMessageID,
                creation: .init(
                    agentId: conversation.agentId,
                    projectId: conversation.projectId,
                    execution: conversation.executionMode.map { ExecutionCommand(mode: $0, baseRef: nil) },
                    temporary: false,
                    model: selection.model,
                    thinkingLevel: selection.thinking,
                    agentSetupLanguage: conversation.agentSetupLanguage
                ),
                input: input,
                origin: readyOrigin
            ))
        }
        let config = try await fetchAgentConfiguration(conversationID: conversation.id)
        let transcriptID: String?
        if let current = config.transcriptId {
            transcriptID = current
        } else {
            let history = try await fetchHistory(conversationID: conversation.id)
            transcriptID = history.session.transcriptId ?? conversation.transcriptId
        }
        guard let transcriptID, let configVersion = config.configVersion else {
            throw GatewayClientError.server("会话配置尚未就绪")
        }
        let readyOrigin = try await origin
        let input = inputCommand(text: text, attachments: attachments, references: references, origin: readyOrigin)
        return try encoder.encode(AppendMessageCommand(
            clientMessageId: clientMessageID,
            expectedTranscriptId: transcriptID,
            configVersion: configVersion,
            input: input,
            origin: readyOrigin
        ))
    }

    private func startModelSelection(for conversation: ConversationSelection) async throws -> (model: String, thinking: String) {
        if let model = conversation.model, let thinking = conversation.thinkingLevel {
            return (model, thinking)
        }
        let catalog = try await fetchModels(agentID: conversation.agentId)
        guard let model = conversation.model ?? catalog.defaultId ?? catalog.models.first?.id else {
            throw GatewayClientError.server("当前助手没有可用模型")
        }
        let thinking = conversation.thinkingLevel
            ?? catalog.models.first(where: { $0.id == model })?.thinking?.initialValue
            ?? "off"
        return (model, thinking)
    }

    func supportsMultiQuestion(_ versions: [Int]?) async -> Bool {
        if let versions {
            return versions.contains(2)
        }
        let health: ClarificationHealth? = try? await request(path: "/api/health")
        return health?.clarificationVersions?.contains(2) == true
    }

    private func inputCommand(
        text: String,
        attachments: [MessageAttachment],
        references: [ContextReference],
        origin: DeviceEndpointOrigin
    ) -> MessageInputCommand {
        var input = MessageInputCommand(
            content: text,
            attachments: attachments.isEmpty ? nil : attachments.map {
                MessageAttachmentCommand(
                    type: $0.type,
                    name: $0.name,
                    mimeType: $0.mimeType,
                    size: $0.size,
                    data: $0.data
                )
            },
            contextRefs: references.isEmpty ? nil : references.map {
                ContextReferenceCommand(
                    kind: $0.kind.rawValue,
                    sourceId: $0.sourceId,
                    expectedVersion: $0.expectedVersion
                )
            }
        )
        input.endpointContext = origin.environment
        if origin.supportsMultiQuestion {
            input.interactionCapabilities = ClarificationCapabilities()
        }
        return input
    }
}

struct NextTurnSuggestion: Decodable, Equatable {
    let id: String
    let conversationId: String
    let transcriptId: String
    let agentId: String
    let locale: String
    let prompt: String
    let expiresAt: Int64

    var isCurrent: Bool {
        expiresAt > Int64(Date.now.timeIntervalSince1970 * 1000)
    }
}

extension GatewayClient {
    struct NextTurnSuggestionResponse: Decodable {
        let status: String
        let suggestion: NextTurnSuggestion?
    }

    func fetchNextTurnSuggestion(conversationID: String, locale: String) async throws -> NextTurnSuggestionResponse {
        try await request(path: "/api/sessions/\(conversationID)/next-turn-suggestion",
                          queryItems: [URLQueryItem(name: "locale", value: locale)])
    }

    func reportNextTurnSuggestion(_ suggestion: NextTurnSuggestion, impressionID: UUID,
                                  event: String, edited: Bool? = nil) async
    {
        struct Feedback: Encodable {
            let suggestionId: String
            let impressionId: UUID
            let event: String
            let edited: Bool?
        }
        let path = "/api/sessions/\(suggestion.conversationId)/next-turn-suggestion-feedback"
        let feedback = Feedback(suggestionId: suggestion.id, impressionId: impressionID, event: event, edited: edited)
        struct Receipt: Decodable { let ok: Bool }
        do {
            let _: Receipt = try await request(path: path, method: "POST", body: encoder.encode(feedback))
        } catch { /* Feedback is optional. */ }
    }
}
