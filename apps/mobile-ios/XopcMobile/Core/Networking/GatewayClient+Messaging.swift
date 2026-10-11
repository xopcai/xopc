import Foundation

extension GatewayClient {
    func sendMessage(
        _ text: String,
        attachments: [MessageAttachment],
        references: [ContextReference],
        delivery: MessageDelivery,
        to conversation: ConversationSelection
    ) async throws -> SessionCommandResult {
        let body = try await messageBody(
            text,
            attachments: attachments,
            references: references,
            delivery: delivery,
            conversation: conversation
        )

        if !conversation.isDraft {
            let context = try await fetchContext(conversationID: conversation.id)
            guard !context.unavailableSections.contains("work") else {
                throw GatewayClientError.server("会话任务归属暂不可用，请稍后重试")
            }
            if context.work.task != nil, Self.isTaskDestructiveCommand(text) {
                throw GatewayClientError.server("任务需要保留连续对话，不能在这里重置或归档")
            }
        }
        let envelope: GatewayEnvelope<SessionCommandResult> = try await request(
            path: "/api/sessions/\(conversation.id)/inputs",
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
        delivery: MessageDelivery,
        conversation: ConversationSelection
    ) async throws -> Data {
        _ = try await DeviceEndpointPool.shared.origin(for: self)
        let clientMessageID = UUID().uuidString.lowercased()
        if conversation.isDraft {
            return try await startMessageBody(
                text,
                attachments: attachments,
                references: references,
                conversation: conversation,
                clientMessageID: clientMessageID
            )
        }
        let history = try await fetchHistory(conversationID: conversation.id)
        let config = try await fetchAgentConfiguration(conversationID: conversation.id)
        guard
            let transcriptID = history.session.transcriptId ?? conversation.transcriptId,
            let configVersion = config.configVersion
        else {
            throw GatewayClientError.server("会话配置尚未就绪")
        }
        return try encoder.encode(AppendMessageCommand(
            clientMessageId: clientMessageID,
            expectedTranscriptId: transcriptID,
            configVersion: configVersion,
            delivery: delivery.rawValue,
            input: await inputCommand(text: text, attachments: attachments, references: references),
            origin: try await DeviceEndpointPool.shared.origin(for: self)
        ))
    }

    private func startMessageBody(
        _ text: String,
        attachments: [MessageAttachment],
        references: [ContextReference],
        conversation: ConversationSelection,
        clientMessageID: String
    ) async throws -> Data {
        let catalog = try await fetchModels(agentID: conversation.agentId)
        guard let model = conversation.model ?? catalog.defaultId ?? catalog.models.first?.id else {
            throw GatewayClientError.server("当前助手没有可用模型")
        }
        let thinking = conversation.thinkingLevel
            ?? catalog.models.first(where: { $0.id == model })?.thinking?.initialValue
            ?? "off"
        return try encoder.encode(StartMessageCommand(
            clientMessageId: clientMessageID,
            creation: .init(
                agentId: conversation.agentId,
                projectId: conversation.projectId,
                execution: conversation.executionMode.map { ExecutionCommand(mode: $0, baseRef: nil) },
                temporary: false,
                model: model,
                thinkingLevel: thinking
            ),
            input: await inputCommand(text: text, attachments: attachments, references: references),
            origin: try await DeviceEndpointPool.shared.origin(for: self)
        ))
    }

    private func inputCommand(
        text: String,
        attachments: [MessageAttachment],
        references: [ContextReference]
    ) async -> MessageInputCommand {
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
        input.endpointContext = await DeviceEndpointPool.shared.environment(for: self)
        return input
    }
}
