import Foundation
@testable import XopcMobile

func emptyContext(conversationID: String) -> ConversationContextSummary {
    ConversationContextSummary(
        conversationId: conversationID,
        work: ContextWork(project: nil, task: nil, delegatedTasks: nil, delegatedTaskCount: nil),
        sources: [],
        sourcesHasMore: false,
        environment: nil,
        unavailableSections: []
    )
}

func modelCatalog(serviceTiers: [ChatModelServiceTier]? = nil) -> ChatModelCatalog {
    ChatModelCatalog(
        defaultId: "model",
        models: [
            ChatModel(
                id: "model",
                name: "Model",
                provider: "test",
                reasoning: true,
                vision: false,
                thinking: ChatModelThinking(options: ["off", "high"], initialValue: "off"),
                serviceTiers: serviceTiers
            )
        ]
    )
}

extension GatewayServing {
    func searchReferences(
        kind _: ContextReferenceKind,
        query _: String,
        conversationID _: String?
    ) async throws -> [ReferenceItem] {
        []
    }
}

struct GatewayStub: GatewayServing {
    var modelLoadFails = false
    var modelSaveFails = false
    var agentConfigVersion: Int?
    var serviceTierSaveFails = false
    var modelServiceTiers: [ChatModelServiceTier]?
    var conversationPages: [ConversationPage]?
    var clarification: ClarificationRequest?
    var activeRun: ActiveRun
    var historyMessages: [WireMessage] = []
    var historyFails = false
    var historyMissing = false
    var runStream: AsyncThrowingStream<RunStreamEvent, Error>?
    var runStreamFactory: (@Sendable () -> AsyncThrowingStream<RunStreamEvent, Error>)?
    var sendDelay: (@Sendable () async -> Void)?
    var abortObserver: (@Sendable () async -> Void)?
    var sendInputState: InputState

    init(
        clarification: ClarificationRequest? = nil,
        activeRun: ActiveRun = ActiveRun(active: false, runId: nil),
        sendInputState: InputState = InputState(activeRunId: nil)
    ) {
        self.clarification = clarification
        self.activeRun = activeRun
        self.sendInputState = sendInputState
    }

    func fetchAgents() async throws -> AgentCatalog {
        AgentCatalog(
            defaultId: "main",
            agents: [
                AgentSummary(
                    id: "main",
                    name: "Main",
                    description: nil,
                    language: nil,
                    avatar: nil,
                    isDefault: true
                )
            ]
        )
    }

    func fetchConversations(search: String, offset: Int) async throws -> ConversationPage {
        if let pages = conversationPages {
            var position = 0
            for page in pages {
                if position == offset {
                    return page
                }
                position += page.items.count
            }
            return ConversationPage(items: [], total: position, hasMore: false)
        }
        let items = [
            ConversationSummary(
                key: "conversation-1",
                agentId: "main",
                name: "Release",
                status: "active",
                updatedAt: "2026-10-04T00:00:00Z",
                messageCount: 2,
                projectId: nil,
                transcriptId: "transcript-1"
            ),
            ConversationSummary(
                key: "conversation-2",
                agentId: "main",
                name: "Design review",
                status: "active",
                updatedAt: "2026-10-04T00:00:00Z",
                messageCount: 4,
                projectId: nil,
                transcriptId: "transcript-2"
            )
        ]
        let filtered = items.filter { search.isEmpty || $0.displayName.localizedCaseInsensitiveContains(search) }
        let page = Array(filtered.dropFirst(offset).prefix(1))
        return ConversationPage(items: page, total: filtered.count, hasMore: offset + page.count < filtered.count)
    }

    func fetchHistory(conversationID: String) async throws -> ConversationHistory {
        if historyMissing {
            throw GatewayClientError.http(statusCode: 404, message: nil)
        }
        if historyFails {
            throw URLError(.notConnectedToInternet)
        }
        return ConversationHistory(
            session: ConversationDetail(
                key: conversationID,
                transcriptId: "transcript",
                agentId: "main",
                messages: historyMessages
            ),
            pagination: HistoryPagination(hasMore: false, nextBeforeCursor: nil)
        )
    }

    func fetchContext(conversationID: String) async throws -> ConversationContextSummary {
        emptyContext(conversationID: conversationID)
    }

    func fetchModels(agentID _: String) async throws -> ChatModelCatalog {
        if modelLoadFails {
            throw URLError(.notConnectedToInternet)
        }
        return modelCatalog(serviceTiers: modelServiceTiers)
    }

    func fetchAgentConfiguration(conversationID _: String) async throws -> SessionAgentConfiguration {
        SessionAgentConfiguration(model: "model", thinkingLevel: "off", configVersion: agentConfigVersion ?? 1)
    }

    func updateAgentConfiguration(conversationID _: String, model: String, thinkingLevel: String, configVersion: Int?) async throws -> SessionAgentConfiguration {
        if modelSaveFails {
            throw GatewayClientError.server("Save failed")
        }
        if let agentConfigVersion, configVersion != agentConfigVersion {
            throw GatewayClientError.http(statusCode: 409, message: "Configuration changed")
        }
        return SessionAgentConfiguration(model: model, thinkingLevel: thinkingLevel, configVersion: (configVersion ?? 0) + 1)
    }

    func updateAgentServiceTier(conversationID _: String, serviceTier: String) async throws -> SessionAgentConfiguration {
        if serviceTierSaveFails {
            throw GatewayClientError.server("Service tier save failed")
        }
        return SessionAgentConfiguration(model: "model", thinkingLevel: "off", configVersion: 2, serviceTier: serviceTier)
    }

    func fetchClarification(conversationID _: String) async throws -> ClarificationRequest? {
        clarification
    }

    func respondToClarification(_: ClarificationRequest, command _: ClarificationResponseCommand) async throws {}
    func sendMessage(
        _: String,
        attachments _: [MessageAttachment],
        references _: [ContextReference],
        to conversation: ConversationSelection,
        clientMessageID: String
    ) async throws -> SessionCommandResult {
        await sendDelay?()
        return SessionCommandResult(
            receipt: InputReceipt(
                conversationId: conversation.id,
                clientMessageId: clientMessageID,
                transcriptId: "transcript"
            ),
            session: CommandSession(key: conversation.id, transcriptId: "transcript"),
            inputState: sendInputState
        )
    }

    func fetchActiveRun(conversationID _: String) async throws -> ActiveRun {
        activeRun
    }

    @discardableResult
    func abort(runID _: String) async throws -> AbortResult {
        await abortObserver?()
        return AbortResult(aborted: true, idle: true)
    }

    func streamRun(runID _: String) -> AsyncThrowingStream<RunStreamEvent, Error> {
        runStreamFactory?() ?? runStream ?? AsyncThrowingStream { $0.finish() }
    }

    func renameConversation(id _: String, name _: String) async throws {}
    func mutateConversation(id _: String, action _: ConversationMutation) async throws {}
    func deleteConversation(id _: String) async throws {}
}
