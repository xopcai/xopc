import Foundation
import Testing
import XCTest
@testable import XopcMobile

struct RealtimeRunReuseTests {
    @Test func multiplexesObserversAndDropsReplayedSequences() async throws {
        var subscriptions = DeviceRunSubscriptions()
        let topic = "run:test"
        let first = AsyncThrowingStream<RunStreamEvent, Error>.makeStream()
        let second = AsyncThrowingStream<RunStreamEvent, Error>.makeStream()
        let id = UUID()
        #expect(subscriptions.add(topic, id: id, after: 4, continuation: first.continuation) == 4)
        #expect(subscriptions.add(topic, id: UUID(), after: 6, continuation: second.continuation) == 4)
        for sequence in [4, 5, 5, 7] {
            let frame = event(topic, sequence: sequence, name: "assistant_delta")
            #expect(try subscriptions.receive(frame, data: JSONSerialization.data(withJSONObject: frame)) == nil)
        }
        let end = event(topic, sequence: 8, name: "run_end")
        #expect(try subscriptions.receive(end, data: JSONSerialization.data(withJSONObject: end)) == topic)
        let removed = subscriptions.remove(topic, id: id)
        #expect(!removed)
        var sequences: [Int] = []
        for try await event in first.stream {
            sequences.append(event.sequence)
        }
        #expect(sequences == [5, 7, 8])
        sequences.removeAll()
        for try await event in second.stream {
            sequences.append(event.sequence)
        }
        #expect(sequences == [7, 8])
    }

    @Test func gapFinishesOnlyTheAffectedRun() async throws {
        var subscriptions = DeviceRunSubscriptions()
        let first = AsyncThrowingStream<RunStreamEvent, Error>.makeStream()
        let second = AsyncThrowingStream<RunStreamEvent, Error>.makeStream()
        _ = subscriptions.add("run:first", id: UUID(), after: 3, continuation: first.continuation)
        _ = subscriptions.add("run:second", id: UUID(), after: 0, continuation: second.continuation)
        let gap: [String: Any] = ["kind": "realtime.gap", "payload": ["topic": "run:first"]]
        #expect(try subscriptions.receive(gap, data: Data()) == "run:first")
        var firstIterator = first.stream.makeAsyncIterator()
        await #expect(throws: GatewayClientError.self) { _ = try await firstIterator.next() }
        let end = event("run:second", sequence: 1, name: "run_end")
        #expect(try subscriptions.receive(end, data: JSONSerialization.data(withJSONObject: end)) == "run:second")
        var secondIterator = second.stream.makeAsyncIterator()
        #expect(try await secondIterator.next()?.isTerminal == true)
    }

    private func event(_ topic: String, sequence: Int, name: String) -> [String: Any] {
        ["kind": "realtime.event", "payload": ["topic": topic, "seq": sequence, "event": name,
                                               "data": ["payload": ["messageId": "answer", "offset": sequence, "delta": "text"]]]]
    }
}

@MainActor final class RealtimeRunFRPTests: XCTestCase {
    private final class NetworkErrors: NSObject, URLSessionTaskDelegate {
        func urlSession(_: URLSession, task: URLSessionTask, didCompleteWithError error: (any Error)?) {
            guard let error = error as NSError? else { return }
            let name = task.originalRequest?.url?.lastPathComponent ?? "unknown"
            print("FRP_REALTIME_NETWORK endpoint=\(name) error=\(error.domain)/\(error.code)")
        }
    }

    private struct Fixture: Decodable {
        let origin: URL
        let token: String
        let pairs: Int
        let model: String
    }

    func testLiveReuseAndResume() async throws {
        let env = ProcessInfo.processInfo.environment
        guard let value = env["XOPC_IOS_RUN_STREAM_FIXTURE"], let url = URL(string: value) else {
            throw XCTSkip("Run the opt-in FRP benchmark runner")
        }
        let (data, _) = try await URLSession.shared.data(from: url)
        let fixture = try JSONDecoder().decode(Fixture.self, from: data)
        let sessionConfig = URLSessionConfiguration.ephemeral
        sessionConfig.timeoutIntervalForRequest = 12
        let session = URLSession(configuration: sessionConfig, delegate: NetworkErrors(), delegateQueue: nil)
        defer { session.invalidateAndCancel() }
        let client = GatewayClient(configuration: .init(baseURL: fixture.origin, token: fixture.token), session: session)
        do {
            let (_, response) = try await session.data(from: fixture.origin.appending(path: "/api/health"))
            XCTAssertEqual((response as? HTTPURLResponse)?.statusCode, 200)
        } catch {
            let failure = error as NSError
            XCTFail("FRP preflight failed (\(failure.domain) \(failure.code))")
            return
        }
        do {
            _ = try await DeviceEndpointPool.shared.origin(for: client)
        } catch {
            XCTFail("Failed to warm device realtime: \(error)")
            return
        }
        for index in 0 ... fixture.pairs {
            for reused in index.isMultiple(of: 2) ? [false, true] : [true, false] {
                try await trial(client: client, model: fixture.model, reused: reused, index: index, disconnect: false)
            }
        }
        try await trial(client: client, model: fixture.model, reused: true, index: 0, disconnect: true)
    }

    private struct ReceiptExecution: Decodable {
        let execution: ActiveRunIdentity?
    }

    private struct ActiveRunIdentity: Decodable {
        let runId: String?
    }

    private func trial(client: GatewayClient, model: String, reused: Bool, index: Int, disconnect: Bool) async throws {
        let draft = ConversationSelection.draft(agentId: "main")
        let path = "/api/sessions/\(draft.id)"
        let body = try JSONSerialization.data(withJSONObject: [
            "commandId": UUID().uuidString.lowercased(), "purpose": "session_resources",
            "creation": ["agentId": "main", "projectId": NSNull(), "execution": NSNull(), "temporary": true,
                         "model": model, "thinkingLevel": "off"]
        ])
        let created: GatewayEnvelope<SessionCommandResult> = try await client.request(path: path + "/materialize", method: "POST", body: body)
        let conversation = try draft.materialized(transcriptId: XCTUnwrap(created.payload?.receipt.transcriptId))
        do {
            try await sendAndObserve(client: client, conversation: conversation, reused: reused, index: index, disconnect: disconnect)
        } catch {
            _ = try? await client.request(path: path + "/archive", method: "POST") as IgnoredResponse
            throw error
        }
        _ = try await client.request(path: path + "/archive", method: "POST") as IgnoredResponse
    }

    private func sendAndObserve(client: GatewayClient, conversation: ConversationSelection, reused: Bool, index: Int, disconnect: Bool) async throws {
        let clock = ContinuousClock()
        let messageID = UUID().uuidString.lowercased()
        let prompt = disconnect
            ? "This is a streaming test. Use no tools. Write every number from 1 to 300 in order, separated by spaces."
            : "This is a latency test. Use no tools. Reply with exactly OK."
        let started = clock.now
        let result = try await client.sendMessage(prompt, attachments: [], references: [], to: conversation, clientMessageID: messageID)
        let runID = try await resolveRun(client: client, conversation: conversation, result: result, messageID: messageID)
        let stream = try await runStream(client: client, runID: runID, reused: reused)
        var observation = ReplyObservation(sentAt: started)
        for try await event in stream {
            try await observation.receive(event, session: client.session, disconnect: disconnect)
        }
        let first = try XCTUnwrap(observation.firstTextMs)
        XCTAssertTrue(observation.completed, "The original run must reach run_end")
        if disconnect {
            try await checkResume(observation, client: client, conversation: conversation)
        } else {
            XCTAssertTrue(observation.text.trimmingCharacters(in: .whitespacesAndNewlines).lowercased().hasPrefix("ok"))
            print("FRP_REALTIME_SAMPLE mode=\(reused ? "shared" : "per-run") pair=\(index) firstTextMs=\(first)")
        }
    }

    private func resolveRun(client: GatewayClient, conversation: ConversationSelection, result: SessionCommandResult,
                            messageID: String) async throws -> String
    {
        if let active = result.inputState.activeRunId {
            return active
        }
        if let active = try await client.fetchActiveRun(conversationID: conversation.id).runId {
            return active
        }
        for _ in 0 ..< 5 {
            let receipt: GatewayEnvelope<ReceiptExecution> = try await client.request(
                path: "/api/sessions/\(conversation.id)/input-receipts/\(messageID)"
            )
            if let runID = receipt.payload?.execution?.runId {
                return runID
            }
            try await Task.sleep(for: .milliseconds(100))
        }
        throw GatewayClientError.invalidResponse
    }

    private func runStream(client: GatewayClient, runID: String, reused: Bool) async throws -> AsyncThrowingStream<RunStreamEvent, Error> {
        if reused {
            return client.streamRun(runID: runID)
        }
        let id = "ios-benchmark:\(UUID().uuidString.lowercased())"
        let body = try client.encoder.encode(RealtimeTicketCommand(clientId: id, clientKind: "mobile", protocolVersion: 2))
        let response: GatewayEnvelope<RealtimeTicket> = try await client.request(path: "/api/realtime/tickets", method: "POST", body: body)
        let ticket = try XCTUnwrap(response.payload?.ticket)
        let socket = RealtimeRunSocket(configuration: client.configuration, session: client.session, ticket: ticket, clientID: id, runID: runID)
        return AsyncThrowingStream { continuation in
            let task = Task {
                do { try await socket.consume(into: continuation); continuation.finish() }
                catch { continuation.finish(throwing: error) }
            }
            continuation.onTermination = { _ in task.cancel() }
        }
    }

    private func checkResume(_ observation: ReplyObservation, client: GatewayClient, conversation: ConversationSelection) async throws {
        let recovery = try XCTUnwrap(observation.resumedAfterMs)
        let saved = try await client.fetchHistory(conversationID: conversation.id).session.messages
            .last(where: { $0.role == "assistant" && !$0.answerText.isEmpty })?.answerText
        XCTAssertEqual(observation.text.trimmingCharacters(in: .whitespacesAndNewlines),
                       saved?.trimmingCharacters(in: .whitespacesAndNewlines))
        XCTAssertEqual(observation.text.split(whereSeparator: { !$0.isNumber }).compactMap { Int($0) }, Array(1 ... 300))
        print("FRP_REALTIME_RESUME droppedSeq=\(observation.droppedSequence ?? 0) resumedSeq=\(observation.resumedSequence ?? 0) resumedAfterMs=\(recovery)")
    }

    private struct ReplyObservation {
        let sentAt: ContinuousClock.Instant
        var firstTextMs: Int?
        var completed = false
        var text = ""
        var sequence = 0
        var droppedSequence: Int?
        var droppedAt: ContinuousClock.Instant?
        var droppedSocket: Int?
        var resumedSequence: Int?
        var resumedAfterMs: Int?

        mutating func receive(_ event: RunStreamEvent, session: URLSession, disconnect: Bool) async throws {
            XCTAssertGreaterThan(event.sequence, sequence)
            sequence = event.sequence
            if event.isTerminal {
                completed = event.name == "run_end" && event.status == "success"
            }
            guard event.name == "assistant_delta", let delta = event.delta, !delta.isEmpty else { return }
            let now = ContinuousClock.now
            if !delta.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                firstTextMs = firstTextMs ?? milliseconds(from: sentAt, to: now)
            }
            text += delta
            guard disconnect, firstTextMs != nil else { return }
            let sockets = await session.allTasks.compactMap { $0 as? URLSessionWebSocketTask }.filter { $0.state == .running }
            if droppedSocket == nil {
                XCTAssertEqual(sockets.count, 1, "The run must reuse the existing endpoint socket")
                let socket = try XCTUnwrap(sockets.first)
                droppedAt = now
                droppedSocket = socket.taskIdentifier
                droppedSequence = event.sequence
                socket.cancel()
            } else if resumedAfterMs == nil, let droppedAt, sockets.contains(where: { $0.taskIdentifier != droppedSocket }) {
                resumedAfterMs = milliseconds(from: droppedAt, to: now)
                resumedSequence = event.sequence
            }
        }

        private func milliseconds(from start: ContinuousClock.Instant, to end: ContinuousClock.Instant) -> Int {
            let duration = start.duration(to: end).components
            return Int(duration.seconds * 1000 + duration.attoseconds / 1_000_000_000_000_000)
        }
    }
}
