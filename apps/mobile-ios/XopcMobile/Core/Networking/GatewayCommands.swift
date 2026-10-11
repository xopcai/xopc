import Foundation

struct SessionCreationCommand: Encodable {
    let agentId: String
    let projectId: String?
    let execution: ExecutionCommand?
    let temporary: Bool
    let model: String
    let thinkingLevel: String

    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(agentId, forKey: .agentId)
        if let projectId {
            try container.encode(projectId, forKey: .projectId)
        } else {
            try container.encodeNil(forKey: .projectId)
        }
        if let execution {
            try container.encode(execution, forKey: .execution)
        } else {
            try container.encodeNil(forKey: .execution)
        }
        try container.encode(temporary, forKey: .temporary)
        try container.encode(model, forKey: .model)
        try container.encode(thinkingLevel, forKey: .thinkingLevel)
    }

    private enum CodingKeys: String, CodingKey {
        case agentId
        case projectId
        case execution
        case temporary
        case model
        case thinkingLevel
    }
}

struct ExecutionCommand: Encodable {
    let mode: String
    let baseRef: String?
}

struct MessageInputCommand: Encodable {
    let content: String
    let attachments: [MessageAttachmentCommand]?
    let contextRefs: [ContextReferenceCommand]?
    var endpointContext: DeviceTurnEnvironment?
}

struct MessageAttachmentCommand: Encodable {
    let type: String
    let name: String
    let mimeType: String
    let size: Int
    let data: String
}

struct ContextReferenceCommand: Encodable {
    let kind: String
    let sourceId: String
    let expectedVersion: String
}

struct StartMessageCommand: Encodable {
    let kind = "start"
    let clientMessageId: String
    let creation: SessionCreationCommand
    let input: MessageInputCommand
    let origin: DeviceEndpointOrigin
}

struct MaterializeVoiceCommand: Encodable {
    let commandId: String
    let creation: SessionCreationCommand
    let purpose = "voice"
}

struct AppendMessageCommand: Encodable {
    let kind = "append"
    let clientMessageId: String
    let expectedTranscriptId: String
    let configVersion: Int
    let delivery: String
    let input: MessageInputCommand
    let origin: DeviceEndpointOrigin
}

struct AbortCommand: Encodable {
    let runId: String
}

struct RealtimeTicketCommand: Encodable {
    let clientId: String
    let clientKind: String
    let protocolVersion: Int
}

struct RenameConversationCommand: Encodable {
    let name: String
}

struct AgentConfigurationCommand: Encodable {
    let model: String
    let thinkingLevel: String
}

struct ClarificationResponseCommand: Encodable {
    let action: String
    let answer: String?
    let expectedVersion: Int
    let idempotencyKey: String
}

struct QueuedInputUpdateCommand: Encodable {
    let version: Int
    let content: String
}

struct EmptyCommand: Encodable {}

struct IgnoredResponse: Decodable {}

struct DeviceTurnEnvironment: Encodable, Sendable {
    let version = 1
    let capturedAt: Int64
    let timezone: String
    let locale: String
}
