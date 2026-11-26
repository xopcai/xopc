import Foundation

struct GatewayConfiguration: Hashable, Sendable {
    var baseURL: URL
    var token: String
    var localIdentity: String?

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
    struct Execution: Decodable, Equatable, Sendable { let kind: String? }
    struct Override: Decodable, Equatable, Sendable {
        let purpose: String?
        // swiftlint:disable:next implicit_optional_initialization
        var execution: Execution? = nil
    }
    // swiftlint:disable:next implicit_optional_initialization
    var override: Override? = nil
    // swiftlint:disable:next implicit_optional_initialization
    var execution: Execution? = nil
    let id: String
    let name: String?
    let description: String?
    let language: String?
    let avatar: String?
    let isDefault: Bool?

    var externalRuntimeKind: String? {
        let raw = (override?.execution?.kind ?? execution?.kind)?.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        return raw?.isEmpty == false ? raw : nil
    }

    var isExternalRuntime: Bool {
        externalRuntimeKind != nil
    }

    var externalRuntimeBadge: String? {
        switch externalRuntimeKind {
        case "codex": "Codex"
        case "claude": "Claude"
        case "agy": "AGY"
        default: nil
        }
    }

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

struct ConversationSummary: Codable, Equatable, Identifiable, Sendable {
    var isRecentSidebarCandidate: Bool {
        status != "archived" && messageCount > 0
    }

    struct CustomData: Codable, Equatable, Sendable { let agentSetup: Bool? }
    // swiftlint:disable:next implicit_optional_initialization
    var customData: CustomData? = nil
    let key: String
    let agentId: String
    var name: String?
    var status: String
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

struct ConversationSelection: Codable, Hashable, Identifiable, Sendable {
    let id: String
    var title: String
    let agentId: String
    let transcriptId: String?
    let isDraft: Bool
    let model: String?
    let thinkingLevel: String?
    var serviceTier: String? = nil
    let projectId: String?
    let executionMode: String?
    let agentSetupLanguage: String?
    let taskID: String?

    private init(
        id: String,
        title: String,
        agentId: String,
        transcriptId: String?,
        isDraft: Bool,
        model: String?,
        thinkingLevel: String?,
        serviceTier: String? = nil,
        projectId: String?,
        executionMode: String?,
        agentSetupLanguage: String? = nil,
        taskID: String? = nil
    ) {
        self.id = id
        self.title = title
        self.agentId = agentId
        self.transcriptId = transcriptId
        self.isDraft = isDraft
        self.model = model
        self.thinkingLevel = thinkingLevel
        self.serviceTier = serviceTier
        self.projectId = projectId
        self.executionMode = executionMode
        self.agentSetupLanguage = agentSetupLanguage
        self.taskID = taskID
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
        agentSetupLanguage = nil
        taskID = nil
    }

    static func draft(agentId: String, id: String = UUID().uuidString.lowercased(), agentSetupLanguage: String? = nil) -> ConversationSelection {
        ConversationSelection(
            id: id,
            title: "新对话",
            agentId: agentId,
            transcriptId: nil,
            isDraft: true,
            model: nil,
            thinkingLevel: nil,
            projectId: nil,
            executionMode: nil,
            agentSetupLanguage: agentSetupLanguage
        )
    }

    static func intakeDraft(_ target: ExternalIntakeTarget) -> ConversationSelection {
        ConversationSelection(id: target.conversationID, title: target.title, agentId: target.agentID,
                              transcriptId: nil, isDraft: true, model: target.model, thinkingLevel: target.thinkingLevel,
                              projectId: target.projectID, executionMode: target.executionMode)
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
            executionMode: project.workspaceRoot?.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty == false
                ? executionMode ?? "local_checkout" : nil
        )
    }

    static func existing(id: String, title: String, agentId: String, taskID: String? = nil) -> ConversationSelection {
        ConversationSelection(
            id: id,
            title: title,
            agentId: agentId,
            transcriptId: nil,
            isDraft: false,
            model: nil,
            thinkingLevel: nil,
            projectId: nil,
            executionMode: nil,
            taskID: taskID
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
            serviceTier: serviceTier,
            projectId: projectId,
            executionMode: executionMode,
            agentSetupLanguage: agentSetupLanguage,
            taskID: taskID
        )
    }

    func configured(model: String, thinkingLevel: String, serviceTier: String? = nil) -> ConversationSelection {
        ConversationSelection(
            id: id,
            title: title,
            agentId: agentId,
            transcriptId: transcriptId,
            isDraft: isDraft,
            model: model,
            thinkingLevel: thinkingLevel,
            serviceTier: serviceTier ?? self.serviceTier,
            projectId: projectId,
            executionMode: executionMode,
            agentSetupLanguage: agentSetupLanguage,
            taskID: taskID
        )
    }
}

struct ChatModelCatalog: Decodable, Sendable {
    let defaultId: String?
    let models: [ChatModel]
}

struct ChatModelServiceTier: Decodable, Equatable, Identifiable, Sendable {
    let id: String
    let label: String
    let description: String?
    let isDefault: Bool?
}

struct ChatModel: Decodable, Identifiable, Sendable {
    let id: String
    let name: String
    let provider: String?
    let reasoning: Bool?
    let vision: Bool?
    let thinking: ChatModelThinking?
    var displayNames: [String: String]?
    // swiftlint:disable:next implicit_optional_initialization
    var serviceTiers: [ChatModelServiceTier]? = nil

    var fastServiceTier: ChatModelServiceTier? {
        guard let tiers = serviceTiers, !tiers.isEmpty else { return nil }
        return tiers.first { tier in
            tier.id == "priority" || tier.id == "fast" || tier.label.lowercased() == "fast"
        } ?? tiers.first
    }

    func localizedName(_ locale: Locale) -> String {
        displayNames?[locale.language.languageCode?.identifier == "zh" ? "zh-CN" : "en"] ?? name
    }
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
    let revision: Int?

    init(hasMore: Bool, nextBeforeCursor: String?, revision: Int? = nil) {
        self.hasMore = hasMore
        self.nextBeforeCursor = nextBeforeCursor
        self.revision = revision
    }
}

struct SessionAgentConfiguration: Decodable, Sendable {
    let model: String?
    let thinkingLevel: String?
    let serviceTier: String?
    let configVersion: Int?
    let transcriptId: String?
    let workingDirectoryLocked: Bool?
    let effectiveWorkspacePath: String?

    init(
        model: String?,
        thinkingLevel: String?,
        configVersion: Int?,
        serviceTier: String? = nil,
        transcriptId: String? = nil,
        workingDirectoryLocked: Bool? = nil,
        effectiveWorkspacePath: String? = nil
    ) {
        self.model = model
        self.thinkingLevel = thinkingLevel
        self.serviceTier = serviceTier
        self.configVersion = configVersion
        self.transcriptId = transcriptId
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
    var presentation: String?

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
