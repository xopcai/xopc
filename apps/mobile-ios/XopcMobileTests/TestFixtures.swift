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

func modelCatalog() -> ChatModelCatalog {
    ChatModelCatalog(
        defaultId: "model",
        models: [
            ChatModel(
                id: "model",
                name: "Model",
                provider: "test",
                reasoning: true,
                vision: false,
                thinking: ChatModelThinking(options: ["off", "high"], initialValue: "off")
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

    func updateQueuedInput(
        conversationID _: String,
        input _: QueuedInput,
        content _: String
    ) async throws -> InputState {
        InputState(activeRunId: nil)
    }
}

struct GatewayStub: GatewayServing {
    var modelSaveFails = false
    var conversationPages: [ConversationPage]?
    var clarification: ClarificationRequest?
    var activeRun: ActiveRun
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
        ConversationHistory(
            session: ConversationDetail(
                key: conversationID,
                transcriptId: "transcript",
                agentId: "main",
                messages: []
            ),
            pagination: HistoryPagination(hasMore: false, nextBeforeCursor: nil)
        )
    }

    func fetchContext(conversationID: String) async throws -> ConversationContextSummary {
        emptyContext(conversationID: conversationID)
    }

    func fetchModels(agentID _: String) async throws -> ChatModelCatalog {
        modelCatalog()
    }

    func fetchAgentConfiguration(conversationID _: String) async throws -> SessionAgentConfiguration {
        SessionAgentConfiguration(model: "model", thinkingLevel: "off", configVersion: 1)
    }

    func updateAgentConfiguration(conversationID _: String, model _: String, thinkingLevel _: String) async throws {
        if modelSaveFails {
            throw GatewayClientError.server("Save failed")
        }
    }

    func fetchClarification(conversationID _: String) async throws -> ClarificationRequest? {
        clarification
    }

    func respondToClarification(_: ClarificationRequest, action _: String, answer _: String?) async throws {}
    func fetchInputState(conversationID _: String) async throws -> InputState {
        InputState(activeRunId: nil)
    }

    func cancelQueuedInput(
        conversationID _: String,
        input _: QueuedInput
    ) async throws -> InputState {
        InputState(activeRunId: nil)
    }

    func sendMessage(
        _: String,
        attachments _: [MessageAttachment],
        references _: [ContextReference],
        delivery _: MessageDelivery,
        to conversation: ConversationSelection
    ) async throws -> SessionCommandResult {
        SessionCommandResult(
            receipt: InputReceipt(
                conversationId: conversation.id,
                clientMessageId: "client-message",
                transcriptId: "transcript"
            ),
            session: CommandSession(key: conversation.id, transcriptId: "transcript"),
            inputState: sendInputState
        )
    }

    func fetchActiveRun(conversationID _: String) async throws -> ActiveRun {
        activeRun
    }

    func abort(runID _: String) async throws {}

    func streamRun(runID _: String) -> AsyncThrowingStream<RunStreamEvent, Error> {
        AsyncThrowingStream { $0.finish() }
    }

    func renameConversation(id _: String, name _: String) async throws {}
    func mutateConversation(id _: String, action _: ConversationMutation) async throws {}
    func deleteConversation(id _: String) async throws {}
}
