import Foundation
import Testing
@testable import XopcMobile

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
