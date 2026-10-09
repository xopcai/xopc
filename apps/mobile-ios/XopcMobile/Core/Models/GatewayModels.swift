import Foundation

struct GatewayConfiguration: Hashable, Sendable {
    var baseURL: URL
    var token: String

    static let local = GatewayConfiguration(
        baseURL: URL(string: "http://127.0.0.1:18790")!,
        token: ""
    )
}

struct GatewayEnvelope<Payload: Decodable>: Decodable {
    let isSuccessful: Bool
    let payload: Payload?
    let error: GatewayErrorPayload?

    private enum CodingKeys: String, CodingKey {
        case isSuccessful = "ok"
        case payload
        case error
    }
}

struct GatewayErrorPayload: Decodable, Equatable {
    let message: String?
    let code: String?

    init(message: String?, code: String? = nil) {
        self.message = message
        self.code = code
    }

    init(from decoder: Decoder) throws {
        if let text = try? decoder.singleValueContainer().decode(String.self) {
            message = text
            code = nil
            return
        }

        let container = try decoder.container(keyedBy: CodingKeys.self)
        message = try container.decodeIfPresent(String.self, forKey: .message)
        code = try container.decodeIfPresent(String.self, forKey: .code)
    }

    private enum CodingKeys: String, CodingKey {
        case message
        case code
    }
}

struct AgentCatalog: Decodable, Equatable, Sendable {
    let defaultId: String
    let agents: [AgentSummary]
}

struct AgentSummary: Decodable, Equatable, Identifiable, Sendable {
    let id: String
    let name: String?
    let description: String?
    let language: String?
    let avatar: String?
    let isDefault: Bool?

    var displayName: String {
        let candidate = name?.trimmingCharacters(in: .whitespacesAndNewlines)
        return candidate?.isEmpty == false ? candidate! : id
    }
}

struct ConversationPage: Decodable, Equatable, Sendable {
    let items: [ConversationSummary]
    let total: Int
    let hasMore: Bool
    var childrenByConversationId: [String: SidebarTaskGroup]?
}

struct SidebarTaskGroup: Decodable, Equatable, Sendable {
    let total: Int
    let activeCount: Int
    let items: [SidebarTask]
}

struct SidebarTask: Decodable, Equatable, Identifiable, Sendable {
    let taskId: String
    let title: String
    let phase: String
    let runStatus: String?
    let activeConversationId: String?
    var id: String {
        taskId
    }
}

struct ConversationSummary: Decodable, Equatable, Identifiable, Sendable {
    let key: String
    let agentId: String
    let name: String?
    let status: String
    let updatedAt: String
    let messageCount: Int
    let projectId: String?
    let transcriptId: String?

    var id: String {
        key
    }

    var displayName: String {
        let candidate = name?.trimmingCharacters(in: .whitespacesAndNewlines)
        return candidate?.isEmpty == false
            ? candidate!
            : AppLocalization.string("新对话", locale: AppLocalization.selectedLocale)
    }
}

struct ConversationSelection: Equatable, Identifiable, Sendable {
    let id: String
    let title: String
    let agentId: String
    let transcriptId: String?
    let isDraft: Bool
    let model: String?
    let thinkingLevel: String?
    let projectId: String?
    let executionMode: String?

    private init(
        id: String,
        title: String,
        agentId: String,
        transcriptId: String?,
        isDraft: Bool,
        model: String?,
        thinkingLevel: String?,
        projectId: String?,
        executionMode: String?
    ) {
        self.id = id
        self.title = title
        self.agentId = agentId
        self.transcriptId = transcriptId
        self.isDraft = isDraft
        self.model = model
        self.thinkingLevel = thinkingLevel
        self.projectId = projectId
        self.executionMode = executionMode
    }

    init(summary: ConversationSummary) {
        id = summary.id
        title = summary.displayName
        agentId = summary.agentId
        transcriptId = summary.transcriptId
        isDraft = false
        model = nil
        thinkingLevel = nil
        projectId = summary.projectId
        executionMode = nil
    }

    static func draft(agentId: String) -> ConversationSelection {
        ConversationSelection(
            id: UUID().uuidString.lowercased(),
            title: "新对话",
            agentId: agentId,
            transcriptId: nil,
            isDraft: true,
            model: nil,
            thinkingLevel: nil,
            projectId: nil,
            executionMode: nil
        )
    }

    static func projectDraft(
        project: ProjectRecord,
        executionMode: String? = nil,
        agentId: String? = nil
    ) -> ConversationSelection {
        ConversationSelection(
            id: UUID().uuidString.lowercased(),
            title: "新项目对话",
            agentId: agentId ?? project.defaultAgentId ?? "main",
            transcriptId: nil,
            isDraft: true,
            model: nil,
            thinkingLevel: nil,
            projectId: project.id,
            executionMode: project.workspaceRoot == nil ? nil : executionMode ?? project.executionMode ?? "local_checkout"
        )
    }

    static func existing(id: String, title: String, agentId: String) -> ConversationSelection {
        ConversationSelection(
            id: id,
            title: title,
            agentId: agentId,
            transcriptId: nil,
            isDraft: false,
            model: nil,
            thinkingLevel: nil,
            projectId: nil,
            executionMode: nil
        )
    }

    func materialized(transcriptId: String) -> ConversationSelection {
        ConversationSelection(
            id: id,
            title: title,
            agentId: agentId,
            transcriptId: transcriptId,
            isDraft: false,
            model: model,
            thinkingLevel: thinkingLevel,
            projectId: projectId,
            executionMode: executionMode
        )
    }

    func configured(model: String, thinkingLevel: String) -> ConversationSelection {
        ConversationSelection(
            id: id,
            title: title,
            agentId: agentId,
            transcriptId: transcriptId,
            isDraft: isDraft,
            model: model,
            thinkingLevel: thinkingLevel,
            projectId: projectId,
            executionMode: executionMode
        )
    }
}

struct ChatModelCatalog: Decodable, Sendable {
    let defaultId: String?
    let models: [ChatModel]
}

struct ChatModel: Decodable, Identifiable, Sendable {
    let id: String
    let name: String
    let provider: String?
    let reasoning: Bool?
    let vision: Bool?
    let thinking: ChatModelThinking?
}

struct ChatModelThinking: Decodable, Sendable {
    let options: [String]
    let initialValue: String
}

struct ConversationHistory: Decodable, Sendable {
    let session: ConversationDetail
    let pagination: HistoryPagination
}

struct ConversationContextResponse: Decodable, Sendable {
    let summary: ConversationContextSummary
}

struct ConversationContextSummary: Decodable, Equatable, Sendable {
    let conversationId: String
    let work: ContextWork
    let sources: [ContextSource]
    let sourcesHasMore: Bool
    let environment: ChatEnvironment?
    let unavailableSections: [String]
}

struct ContextWork: Decodable, Equatable, Sendable {
    let project: ContextWorkItem?
    let task: ContextWorkItem?
    let delegatedTasks: [ContextDelegatedTask]?
    let delegatedTaskCount: Int?
}

struct ContextWorkItem: Decodable, Equatable, Identifiable, Sendable {
    let id: String
    let title: String
    let phase: String?
}

struct ContextSource: Decodable, Equatable, Identifiable, Sendable {
    let kind: String?
    let id: String
    let title: String?
    let unavailable: Bool?
    let fileKind: String?
    let origins: [ContextSourceOrigin]?
}

struct ContextSourceOrigin: Decodable, Equatable, Sendable {
    let kind: String
}

struct ContextDelegatedTask: Decodable, Equatable, Identifiable, Sendable {
    let id: String
    let title: String
    let phase: String
    let runStatus: String?
}

struct ChatEnvironment: Decodable, Equatable, Sendable {
    let kind: String
    let rootPath: String
    let available: Bool
    let branch: String?
    let headSha: String?
}

struct ConversationDetail: Decodable, Sendable {
    let key: String
    let transcriptId: String?
    let agentId: String?
    let messages: [WireMessage]
}

struct HistoryPagination: Decodable, Sendable {
    let hasMore: Bool
    let nextBeforeCursor: String?
}

struct SessionAgentConfiguration: Decodable, Sendable {
    let model: String?
    let thinkingLevel: String?
    let configVersion: Int?
    let workingDirectoryLocked: Bool?
    let effectiveWorkspacePath: String?

    init(
        model: String?,
        thinkingLevel: String?,
        configVersion: Int?,
        workingDirectoryLocked: Bool? = nil,
        effectiveWorkspacePath: String? = nil
    ) {
        self.model = model
        self.thinkingLevel = thinkingLevel
        self.configVersion = configVersion
        self.workingDirectoryLocked = workingDirectoryLocked
        self.effectiveWorkspacePath = effectiveWorkspacePath
    }
}

struct ActiveRun: Decodable, Sendable {
    let active: Bool
    let runId: String?
}

struct AbortResult: Decodable, Sendable {
    let aborted: Bool
    let idle: Bool
}

enum ConversationMutation: String, Sendable {
    case archive
    case unarchive
    case pin
    case unpin
}

struct SessionCommandResult: Decodable, Sendable {
    let receipt: InputReceipt
    let session: CommandSession
    let inputState: InputState
}

struct InputReceipt: Decodable, Sendable {
    let conversationId: String
    let clientMessageId: String
    let transcriptId: String
    let lifecycle: String?

    init(conversationId: String, clientMessageId: String, transcriptId: String, lifecycle: String? = nil) {
        self.conversationId = conversationId
        self.clientMessageId = clientMessageId
        self.transcriptId = transcriptId
        self.lifecycle = lifecycle
    }
}

struct CommandSession: Decodable, Sendable {
    let key: String
    let transcriptId: String?
}

struct RunStreamEvent: Equatable, Sendable {
    let name: String
    let sequence: Int
    let messageId: String?
    let delta: String?
    let offset: Int?
    let status: String?
    let errorMessage: String?
    let toolName: String?
    let stage: String?

    var isTerminal: Bool {
        name == "run_end" || name == "error"
    }
}

struct ExecutionActivityItem: Equatable, Identifiable, Sendable {
    let id: String
    let title: String
    var status: String
}

struct RealtimeTicket: Decodable, Sendable {
    let ticket: String
    let realtime: RealtimeCompatibility
}

struct RealtimeCompatibility: Decodable, Sendable {
    let minVersion: Int
    let maxVersion: Int
    let capabilities: [String]
}
