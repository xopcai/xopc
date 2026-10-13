import Foundation
import Testing
@testable import XopcMobile

@MainActor
struct FeatureStateTests {
    @Test func uploadConflictSuggestsNonDestructiveName() {
        #expect(FileUploadName.suggestedAlternative(to: "report.txt") == "report (1).txt")
        #expect(FileUploadName.suggestedAlternative(to: ".env") == ".env (1)")
        #expect(FileUploadName.isValid("report (1).txt"))
        #expect(!FileUploadName.isValid(" report.txt"))
        #expect(!FileUploadName.isValid("folder/report.txt"))
        #expect(!FileUploadName.isValid(".."))
    }

    @Test func transientUploadErrorsUseLocalizedActionableMessage() {
        let message = FileUploadFailureMessage.resolve(GatewayClientError.http(statusCode: 503, message: "Temporary upload failure"))
        #expect(message == AppLocalization.string("上传暂时失败，请检查网络后重试。", locale: AppLocalization.selectedLocale))
        #expect(FileUploadFailureMessage.resolve(URLError(.notConnectedToInternet)) == message)
    }

    @Test func assistantSelectsGatewayDefault() async {
        let state = AssistantState()

        await state.load(using: GatewayStub())

        #expect(state.selectedAgentID == "main")
        #expect(state.selectedAgent?.displayName == "Main")
    }

    @Test func conversationsGroupByCalendarDay() throws {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = try #require(TimeZone(secondsFromGMT: 0))
        let now = try #require(ISO8601DateFormatter().date(from: "2026-10-04T12:00:00Z"))
        func conversation(_ id: String, _ updatedAt: String) -> ConversationSummary {
            ConversationSummary(
                key: id,
                agentId: "main",
                name: id,
                status: "active",
                updatedAt: updatedAt,
                messageCount: 1,
                projectId: nil,
                transcriptId: nil
            )
        }

        let sections = ConversationDateSection.group([
            conversation("today", "2026-10-04T08:00:00.000Z"),
            conversation("yesterday", "2026-10-03T23:00:00Z"),
            conversation("older", "2026-09-28T08:00:00Z")
        ], now: now, calendar: calendar)

        #expect(sections.map { $0.conversations.map(\.id) } == [["today"], ["yesterday"], ["older"]])
        #expect(sections[0].title == String(localized: "今天"))
        #expect(sections[1].title == String(localized: "昨天"))

        let english = ConversationDateSection.group([
            conversation("today", "2026-10-04T08:00:00.000Z"),
            conversation("yesterday", "2026-10-03T23:00:00Z")
        ], now: now, calendar: calendar, locale: Locale(identifier: "en"), bundle: Bundle(for: AppState.self))
        #expect(english.map(\.title) == ["Today", "Yesterday"])
        let appBundle = Bundle(for: AppState.self)
        let englishPath = try #require(appBundle.path(forResource: "en", ofType: "lproj"))
        let englishBundle = try #require(Bundle(path: englishPath))
        #expect(String(localized: "今天", bundle: englishBundle) == "Today")
        #expect(String(localized: "已转写 \(3) 段，处理中 \(1) 段", bundle: englishBundle) == "3 transcribed, 1 processing")
        #expect(AppLocalization.resolve("已转写 \(3) 段，处理中 \(1) 段", locale: Locale(identifier: "en"), bundle: appBundle)
            == "3 transcribed, 1 processing")
    }

    @Test func assistantSendsAndRecoversPersistedHistory() async {
        let state = AssistantState()
        let conversation = ConversationSelection.draft(agentId: "main")

        let updated = await state.send("Hello", to: conversation, using: StreamingGatewayStub())

        #expect(updated?.isDraft == false)
        #expect(state.isSending == false)
        #expect(state.runID == nil)
        #expect(state.messages.map(\.text) == ["Hello", "Done"])
        #expect(updated?.transcriptId == "transcript")
    }

    @Test func streamEventsRecognizeTerminalFrames() {
        let delta = RunStreamEvent(
            name: "assistant_delta",
            sequence: 1,
            messageId: "answer",
            delta: "Done",
            offset: 0,
            status: nil,
            errorMessage: nil,
            toolName: nil,
            stage: nil
        )
        let end = RunStreamEvent(
            name: "run_end",
            sequence: 2,
            messageId: nil,
            delta: nil,
            offset: nil,
            status: "success",
            errorMessage: nil,
            toolName: nil,
            stage: nil
        )

        #expect(delta.isTerminal == false)
        #expect(end.isTerminal)
    }

    @Test func liveAssistantMessageRetainsRunIDForExecutionDetail() {
        let state = AssistantState()
        state.apply(.init(
            name: "assistant_delta",
            sequence: 1,
            messageId: "answer",
            delta: "Working",
            offset: 0,
            status: nil,
            errorMessage: nil,
            toolName: nil,
            stage: nil
        ), runID: "run-123")

        #expect(state.messages.first?.turnId == "run-123")
        #expect(state.messages.first?.isPending == true)
    }

    @Test func assistantLoadsOpenClarificationWithConversation() async {
        let state = AssistantState()
        let conversation = ConversationSelection(summary: ConversationSummary(
            key: "conversation-1",
            agentId: "main",
            name: "Question",
            status: "active",
            updatedAt: "2026-10-04T00:00:00Z",
            messageCount: 0,
            projectId: nil,
            transcriptId: "transcript"
        ))
        let clarification = ClarificationRequest(
            id: "clarification-1",
            conversationId: conversation.id,
            kind: "input",
            status: "open",
            question: "Which option?",
            choices: ["A", "B"],
            suggestedAnswer: nil,
            version: 1,
            expiresAt: nil
        )

        await state.loadConversation(
            conversation,
            using: GatewayStub(clarification: clarification)
        )

        #expect(state.clarification == clarification)
    }

    @Test func assistantQueuesFollowUpDuringActiveRun() async {
        let state = AssistantState()
        let conversation = ConversationSelection(summary: ConversationSummary(
            key: "conversation-1",
            agentId: "main",
            name: "Running",
            status: "active",
            updatedAt: "2026-10-04T00:00:00Z",
            messageCount: 1,
            projectId: nil,
            transcriptId: "transcript"
        ))
        let queued = QueuedInput(
            id: "input-1",
            content: "Follow up",
            status: "queued",
            version: 1,
            position: 0,
            requestedDelivery: "next",
            effectiveDelivery: "next",
            error: nil,
            attachments: nil,
            contextRefs: nil
        )
        let gateway = GatewayStub(
            activeRun: ActiveRun(active: true, runId: "run-1"),
            sendInputState: InputState(activeRunId: "run-1", inputs: [queued])
        )

        await state.loadConversation(conversation, using: gateway)
        let accepted = await state.queueMessage("Follow up", in: conversation, using: gateway)

        #expect(accepted)
        #expect(state.pendingInputs == [queued])
    }

    @Test func projectDraftCarriesProjectExecutionContext() {
        let project = ProjectRecord(
            id: "project-1",
            name: "Mobile",
            status: "active",
            health: "on_track",
            description: nil,
            brief: nil,
            defaultAgentId: "ios-agent",
            workspaceRoot: "/tmp/mobile",
            executionMode: "managed_worktree",
            updatedAt: 1,
            sessionCount: 0,
            taskCount: 0,
            activeTaskCount: 0
        )

        let conversation = ConversationSelection.projectDraft(project: project)

        #expect(conversation.isDraft)
        #expect(conversation.projectId == project.id)
        #expect(conversation.agentId == "ios-agent")
        #expect(conversation.executionMode == "managed_worktree")
    }
}

@MainActor
struct AssistantRecoveryTests {
    @Test func assistantResumesWhenReceiptArrivesAfterForeground() async throws {
        let state = AssistantState()
        let conversation = ConversationSelection.draft(agentId: "main").materialized(transcriptId: "transcript")
        await state.loadConversation(conversation, using: GatewayStub())
        let stream = AsyncThrowingStream<RunStreamEvent, Error>.makeStream()
        let receipt = PendingReceiptGate()
        var gateway = GatewayStub(activeRun: ActiveRun(active: true, runId: "run"),
                                  sendInputState: InputState(activeRunId: "run"))
        gateway.runStream = stream.stream
        gateway.sendDelay = { await receipt.wait() }
        gateway.abortObserver = { await receipt.recordAbort() }
        let sender = Task { await state.send("Hello", to: conversation, using: gateway) }
        defer { state.pauseConversation(); sender.cancel(); stream.continuation.finish() }
        for _ in 0 ..< 100 {
            if await receipt.sendCount == 1 { break }
            try await Task.sleep(for: .milliseconds(10))
        }
        #expect(state.isSending)
        #expect(state.runID == nil)
        state.pauseConversation()
        await state.resumeConversation(conversation, using: gateway)
        await receipt.release()
        stream.continuation.yield(recoveryDelta("Resumed", offset: 0))
        try await waitForReply("Resumed", in: state)
        #expect(state.runID == "run")
        #expect(await receipt.sendCount == 1)
        #expect(await receipt.abortCount == 0)
    }

    @Test func assistantResumesOutputWithoutErasingOrDuplicatingItsPrefix() async throws {
        let state = AssistantState()
        let conversation = ConversationSelection.draft(agentId: "main").materialized(transcriptId: "transcript")
        let first = AsyncThrowingStream<RunStreamEvent, Error>.makeStream()
        var gateway = GatewayStub(activeRun: ActiveRun(active: true, runId: "run"))
        gateway.runStream = first.stream
        await state.loadConversation(conversation, using: gateway)
        first.continuation.yield(recoveryDelta("Hello", offset: 0))
        try await waitForReply("Hello", in: state)
        state.pauseConversation()
        let second = AsyncThrowingStream<RunStreamEvent, Error>.makeStream()
        gateway.runStream = second.stream
        await state.resumeConversation(conversation, using: gateway)
        #expect(state.messages.map(\.text) == ["Hello"])
        second.continuation.yield(recoveryDelta("Hello", offset: 0))
        second.continuation.yield(recoveryDelta(" world", offset: 5))
        try await waitForReply("Hello world", in: state)
        #expect(state.messages.count == 1)
        state.pauseConversation()
        first.continuation.finish(); second.continuation.finish()
    }

    @Test func assistantRecoversCompletionThatHappenedInBackground() async throws {
        let state = AssistantState()
        let conversation = ConversationSelection.draft(agentId: "main").materialized(transcriptId: "transcript")
        let first = AsyncThrowingStream<RunStreamEvent, Error>.makeStream()
        var gateway = GatewayStub(activeRun: ActiveRun(active: true, runId: "run"))
        gateway.runStream = first.stream
        await state.loadConversation(conversation, using: gateway)
        first.continuation.yield(recoveryDelta("Partial", offset: 0))
        try await waitForReply("Partial", in: state)
        state.pauseConversation()
        gateway.activeRun = ActiveRun(active: false, runId: nil)
        gateway.historyMessages = [WireMessage(id: "answer", messageId: nil, turnId: "run", role: "assistant",
                                               content: .text("Complete"), rawContent: nil, toolCalls: nil, attachments: nil, media: nil, metadata: nil)]
        await state.resumeConversation(conversation, using: gateway)
        #expect(state.runID == nil)
        #expect(state.messages.map(\.text) == ["Complete"])
        #expect(!state.messages[0].isPending)
        state.pauseConversation(); first.continuation.finish()
    }

    @Test func assistantKeepsStreamingWhenForegroundHistoryIsOffline() async throws {
        let state = AssistantState()
        let conversation = ConversationSelection.draft(agentId: "main").materialized(transcriptId: "transcript")
        let first = AsyncThrowingStream<RunStreamEvent, Error>.makeStream()
        var gateway = GatewayStub(activeRun: ActiveRun(active: true, runId: "run"))
        gateway.runStream = first.stream
        await state.loadConversation(conversation, using: gateway)
        first.continuation.yield(recoveryDelta("Hello", offset: 0))
        try await waitForReply("Hello", in: state)
        state.pauseConversation()
        let second = AsyncThrowingStream<RunStreamEvent, Error>.makeStream()
        gateway.runStream = second.stream; gateway.historyFails = true
        await state.resumeConversation(conversation, using: gateway)
        #expect(state.errorMessage != nil)
        second.continuation.yield(recoveryDelta(" again", offset: 5))
        try await waitForReply("Hello again", in: state)
        state.pauseConversation(); first.continuation.finish(); second.continuation.finish()
    }

    @Test func assistantReconnectsAfterTransportLossWithoutManualRefresh() async throws {
        let state = AssistantState()
        let conversation = ConversationSelection.draft(agentId: "main").materialized(transcriptId: "transcript")
        let first = AsyncThrowingStream<RunStreamEvent, Error>.makeStream()
        let second = AsyncThrowingStream<RunStreamEvent, Error>.makeStream()
        let replay = RunReplayStreams([first.stream, second.stream])
        var gateway = GatewayStub(activeRun: ActiveRun(active: true, runId: "run"))
        gateway.runStreamFactory = { replay.next() }
        await state.loadConversation(conversation, using: gateway)
        first.continuation.yield(recoveryDelta("Hello", offset: 0))
        try await waitForReply("Hello", in: state)
        first.continuation.finish(throwing: URLError(.networkConnectionLost))
        second.continuation.yield(recoveryDelta("Hello", offset: 0))
        second.continuation.yield(recoveryDelta(" restored", offset: 5))
        try await waitForReply("Hello restored", in: state)
        #expect(state.messages.count == 1)
        state.pauseConversation(); second.continuation.finish()
    }

    @Test func assistantIgnoresPreviousConversationEventsAfterSelectionChanges() async throws {
        let state = AssistantState()
        let first = AsyncThrowingStream<RunStreamEvent, Error>.makeStream()
        let conversation = ConversationSelection.draft(agentId: "main").materialized(transcriptId: "transcript")
        var gateway = GatewayStub(activeRun: ActiveRun(active: true, runId: "run"))
        gateway.runStream = first.stream
        await state.loadConversation(conversation, using: gateway)
        first.continuation.yield(recoveryDelta("Hello", offset: 0))
        try await waitForReply("Hello", in: state)
        let other = ConversationSelection.draft(agentId: "main").materialized(transcriptId: "other")
        await state.loadConversation(other, using: GatewayStub())
        first.continuation.yield(recoveryDelta(" stale", offset: 5))
        try await Task.sleep(for: .milliseconds(20))
        #expect(state.messages.isEmpty)
        #expect(state.runID == nil)
        state.pauseConversation(); first.continuation.finish()
    }

    private func recoveryDelta(_ text: String, offset: Int) -> RunStreamEvent {
        RunStreamEvent(name: "assistant_delta", sequence: offset + 1, messageId: "answer", delta: text,
                       offset: offset, status: nil, errorMessage: nil, toolName: nil, stage: nil)
    }

    private func waitForReply(_ text: String, in state: AssistantState) async throws {
        for _ in 0 ..< 250 {
            if state.messages.last?.text == text {
                return
            }
            try await Task.sleep(for: .milliseconds(10))
        }
        #expect(state.messages.last?.text == text)
    }
}

private final class RunReplayStreams: @unchecked Sendable {
    private let lock = NSLock()
    private var streams: [AsyncThrowingStream<RunStreamEvent, Error>]

    init(_ streams: [AsyncThrowingStream<RunStreamEvent, Error>]) {
        self.streams = streams
    }

    func next() -> AsyncThrowingStream<RunStreamEvent, Error> {
        lock.withLock { streams.isEmpty ? AsyncThrowingStream { $0.finish() } : streams.removeFirst() }
    }
}

private struct StreamingGatewayStub: GatewayServing {
    func fetchAgents() async throws -> AgentCatalog {
        AgentCatalog(defaultId: "main", agents: [])
    }

    func fetchConversations(search _: String, offset _: Int) async throws -> ConversationPage {
        ConversationPage(items: [], total: 0, hasMore: false)
    }

    func fetchHistory(conversationID: String) async throws -> ConversationHistory {
        ConversationHistory(
            session: ConversationDetail(
                key: conversationID,
                transcriptId: "transcript",
                agentId: "main",
                messages: [
                    WireMessage(
                        id: "user",
                        messageId: nil,
                        turnId: nil,
                        role: "user",
                        content: .text("Hello"),
                        rawContent: nil,
                        toolCalls: nil,
                        attachments: nil,
                        media: nil,
                        metadata: nil
                    ),
                    WireMessage(
                        id: "assistant",
                        messageId: nil,
                        turnId: nil,
                        role: "assistant",
                        content: .text("Done"),
                        rawContent: nil,
                        toolCalls: nil,
                        attachments: nil,
                        media: nil,
                        metadata: nil
                    )
                ]
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

    func updateAgentConfiguration(conversationID _: String, model _: String, thinkingLevel _: String) async throws {}

    func fetchClarification(conversationID _: String) async throws -> ClarificationRequest? {
        nil
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
            inputState: InputState(activeRunId: "run")
        )
    }

    func fetchActiveRun(conversationID _: String) async throws -> ActiveRun {
        ActiveRun(active: false, runId: nil)
    }

    func abort(runID _: String) async throws {}

    func streamRun(runID _: String) -> AsyncThrowingStream<RunStreamEvent, Error> {
        AsyncThrowingStream { continuation in
            continuation.yield(.init(
                name: "assistant_delta",
                sequence: 1,
                messageId: "answer",
                delta: "Done",
                offset: 0,
                status: nil,
                errorMessage: nil,
                toolName: nil,
                stage: nil
            ))
            continuation.yield(.init(
                name: "run_end",
                sequence: 2,
                messageId: nil,
                delta: nil,
                offset: nil,
                status: "success",
                errorMessage: nil,
                toolName: nil,
                stage: nil
            ))
            continuation.finish()
        }
    }

    func renameConversation(id _: String, name _: String) async throws {}
    func mutateConversation(id _: String, action _: ConversationMutation) async throws {}
    func deleteConversation(id _: String) async throws {}
}

private actor PendingReceiptGate {
    private var continuation: CheckedContinuation<Void, Never>?
    private(set) var sendCount = 0
    private(set) var abortCount = 0

    func wait() async {
        sendCount += 1
        await withCheckedContinuation { continuation = $0 }
    }

    func release() {
        continuation?.resume()
        continuation = nil
    }

    func recordAbort() { abortCount += 1 }
}
