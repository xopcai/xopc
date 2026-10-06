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
