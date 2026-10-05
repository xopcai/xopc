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

    private func messageBody(
        _ text: String,
        attachments: [MessageAttachment],
        references: [ContextReference],
        delivery: MessageDelivery,
        conversation: ConversationSelection
    ) async throws -> Data {
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
            input: inputCommand(text: text, attachments: attachments, references: references),
            origin: .init(type: "system", source: "cli")
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
            input: inputCommand(text: text, attachments: attachments, references: references),
            origin: .init(type: "system", source: "cli")
        ))
    }

    private func inputCommand(
        text: String,
        attachments: [MessageAttachment],
        references: [ContextReference]
    ) -> MessageInputCommand {
        MessageInputCommand(
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
                    expectedVersion: $0.expectedVersion,
                    title: $0.title
                )
            }
        )
    }
}
