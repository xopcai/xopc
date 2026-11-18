import Foundation

actor RealtimeRunSocket {
    private let configuration: GatewayConfiguration
    private let session: URLSession
    private let ticket: String
    private let clientID: String
    private let runID: String
    private let conversationID: String?
    private var socket: URLSessionWebSocketTask?

    init(
        configuration: GatewayConfiguration,
        session: URLSession,
        ticket: String,
        clientID: String,
        runID: String,
        conversationID: String? = nil
    ) {
        self.configuration = configuration
        self.session = session
        self.ticket = ticket
        self.clientID = clientID
        self.runID = runID
        self.conversationID = conversationID
    }

    // swiftlint:disable:next function_body_length
    func consume(into continuation: AsyncThrowingStream<RunStreamEvent, Error>.Continuation) async throws {
        var request = try URLRequest(url: configuration.realtimeWebSocketURL())
        try await request.setValue(GatewayPairingService.shared.connectionProof(url: request.url!, ticket: ticket), forHTTPHeaderField: "X-Xopc-Proof")
        let socket = session.webSocketTask(with: request)
        self.socket = socket
        socket.resume()
        guard let hello = try String(data: JSONEncoder().encode(helloFrame()), encoding: .utf8) else { throw GatewayClientError.invalidResponse }
        try await socket.send(.string(hello))

        let heartbeat = Task { [weak self] in
            while !Task.isCancelled {
                try await Task.sleep(for: .seconds(15))
                try Task.checkCancellation()
                try await self?.sendPing()
            }
        }
        defer {
            heartbeat.cancel()
            socket.cancel(with: .normalClosure, reason: nil)
            self.socket = nil
        }

        var lastSequence = 0
        while !Task.isCancelled {
            let data = try await withTaskCancellationHandler {
                try await socket.receiveFrameData()
            } onCancel: {
                socket.cancel(with: .goingAway, reason: nil)
            }
            let frame = try JSONDecoder().decode(RealtimeServerFrame.self, from: data)
            try validate(frame)
            if conversationID != nil, frame.kind == "realtime.subscribed", frame.payload.topic == topic {
                continuation.yield(RunStreamEvent(name: frame.kind, sequence: 0, messageId: nil, delta: nil,
                                                  offset: nil, status: nil, errorMessage: nil, toolName: nil, stage: nil))
                continue
            }
            guard frame.kind == "realtime.event",
                  frame.payload.topic == topic,
                  let sequence = frame.payload.seq,
                  sequence > lastSequence,
                  let eventName = frame.payload.event
            else {
                continue
            }
            lastSequence = sequence
            let eventData = frame.payload.data
            if let conversationID {
                guard ["session.task-result", "session.agent-reaction", "session.agent-reaction.preference",
                       "session.next-turn-suggestion.changed"].contains(eventName),
                    eventData?.conversationId == conversationID else { continue }
            }
            guard let event = frame.runEvent else { continue }
            continuation.yield(event)
            if event.isTerminal {
                continuation.finish()
                return
            }
        }
    }

    private func validate(_ frame: RealtimeServerFrame) throws {
        if frame.kind == "realtime.error" {
            throw GatewayClientError.server(frame.payload.message ?? "实时连接发生错误")
        }
        if frame.kind == "realtime.gap", frame.payload.topic == topic {
            throw GatewayClientError.server("实时事件中断，正在恢复历史记录")
        }
    }

    private var topic: String {
        conversationID == nil ? "run:\(runID)" : "sessions"
    }

    private func sendPing() async throws {
        guard let socket else { return }
        let frame = RealtimeClientFrame(kind: "realtime.ping", payload: .ping)
        guard let text = try String(data: JSONEncoder().encode(frame), encoding: .utf8) else { throw GatewayClientError.invalidResponse }
        try await socket.send(.string(text))
    }

    private func helloFrame() -> RealtimeClientFrame {
        RealtimeClientFrame(
            kind: "realtime.hello",
            payload: .hello(.init(
                ticket: ticket,
                clientId: clientID,
                clientKind: "mobile",
                subscriptions: [.init(topic: topic, afterSeq: 0, view: "compact")],
                capabilities: ["realtime.capability-negotiation.v1"]
            ))
        )
    }
}

extension GatewayConfiguration {
    func realtimeWebSocketURL() throws -> URL {
        guard var components = URLComponents(url: baseURL, resolvingAgainstBaseURL: false) else {
            throw GatewayClientError.invalidURL
        }
        switch components.scheme {
        case "http": components.scheme = "ws"
        case "https": components.scheme = "wss"
        default: throw GatewayClientError.invalidURL
        }
        components.path = "/api/realtime/v1/ws"
        components.query = nil
        components.fragment = nil
        guard let url = components.url else { throw GatewayClientError.invalidURL }
        return url
    }
}

extension URLSessionWebSocketTask {
    func receiveFrameData() async throws -> Data {
        switch try await receive() {
        case let .data(data): data
        case let .string(text): Data(text.utf8)
        @unknown default: throw GatewayClientError.invalidResponse
        }
    }
}

private struct RealtimeClientFrame: Encodable {
    let protocolVersion = 2
    let messageId = UUID().uuidString.lowercased()
    let sentAt = Int(Date().timeIntervalSince1970 * 1000)
    let kind: String
    let payload: RealtimeClientPayload
}

private enum RealtimeClientPayload: Encodable {
    case hello(RealtimeHelloPayload)
    case ping

    func encode(to encoder: Encoder) throws {
        switch self {
        case let .hello(payload): try payload.encode(to: encoder)
        case .ping: _ = encoder.container(keyedBy: EmptyCodingKeys.self)
        }
    }

    private enum EmptyCodingKeys: CodingKey {}
}

private struct RealtimeHelloPayload: Encodable {
    let ticket: String
    let clientId: String
    let clientKind: String
    let subscriptions: [RealtimeSubscription]
    let capabilities: [String]
}

private struct RealtimeSubscription: Encodable {
    let topic: String
    let afterSeq: Int
    let view: String
}

private struct RealtimeServerFrame: Decodable {
    let kind: String
    let payload: RealtimeServerPayload

    var runEvent: RunStreamEvent? {
        guard kind == "realtime.event", let name = payload.event, let sequence = payload.seq else { return nil }
        let body = payload.data?.payload
        return RunStreamEvent(name: name, sequence: sequence, messageId: body?.messageId, delta: body?.delta,
                              offset: body?.offset, status: body?.status, errorMessage: body?.message,
                              toolName: body?.toolName, stage: body?.stage, presentation: body?.presentation)
    }
}

private struct RealtimeServerPayload: Decodable {
    let topic: String?
    let seq: Int?
    let event: String?
    let message: String?
    let data: RealtimeRunEnvelope?
}

private struct RealtimeRunEnvelope: Decodable {
    let type: String?
    let payload: RealtimeRunPayload?
    let conversationId: String?
}

private struct RealtimeRunPayload: Decodable {
    let messageId: String?
    let delta: String?
    let offset: Int?
    let status: String?
    let message: String?
    let toolName: String?
    let stage: String?
    let presentation: String?
}

enum DeviceRunStreamError: Error {
    case disconnected
}

struct DeviceRunSubscriptions {
    typealias Continuation = AsyncThrowingStream<RunStreamEvent, Error>.Continuation

    private struct Observer {
        var sequence: Int
        let continuation: Continuation
    }

    private var topics: [String: [UUID: Observer]] = [:]

    mutating func add(_ topic: String, id: UUID, after sequence: Int, continuation: Continuation) -> Int {
        topics[topic, default: [:]][id] = Observer(sequence: sequence, continuation: continuation)
        return topics[topic]?.values.map(\.sequence).min() ?? sequence
    }

    mutating func remove(_ topic: String, id: UUID) -> Bool {
        guard topics[topic]?.removeValue(forKey: id) != nil, topics[topic]?.isEmpty == true else { return false }
        topics.removeValue(forKey: topic)
        return true
    }

    mutating func finishAll(throwing error: Error) {
        for topic in Array(topics.keys) {
            finish(topic, throwing: error)
        }
    }

    mutating func receive(_ raw: [String: Any], data: Data) throws -> String? {
        guard let payload = raw["payload"] as? [String: Any] else { return nil }
        if raw["kind"] as? String == "realtime.error" {
            finishAll(throwing: GatewayClientError.server(payload["message"] as? String ?? "实时连接发生错误"))
            return nil
        }
        guard let topic = payload["topic"] as? String, var observers = topics[topic] else { return nil }
        if raw["kind"] as? String == "realtime.gap" {
            finish(topic, throwing: GatewayClientError.server("实时事件中断，正在恢复历史记录"))
            return topic
        }
        guard raw["kind"] as? String == "realtime.event",
              let event = try JSONDecoder().decode(RealtimeServerFrame.self, from: data).runEvent else { return nil }
        for (id, observer) in observers where observer.sequence < event.sequence {
            observers[id]?.sequence = event.sequence
            observer.continuation.yield(event)
        }
        topics[topic] = observers
        guard event.isTerminal else { return nil }
        finish(topic, throwing: nil)
        return topic
    }

    private mutating func finish(_ topic: String, throwing error: Error?) {
        guard let observers = topics.removeValue(forKey: topic) else { return }
        for observer in observers.values {
            observer.continuation.finish(throwing: error)
        }
    }
}

extension GatewayClient {
    func streamRun(runID: String) -> AsyncThrowingStream<RunStreamEvent, Error> {
        AsyncThrowingStream { continuation in
            let task = Task {
                let host = await DeviceEndpointPool.shared.host(for: self)
                do {
                    try await Self.followRun(runID, on: host, into: continuation)
                    continuation.finish()
                } catch is CancellationError {
                    continuation.finish()
                } catch {
                    continuation.finish(throwing: error)
                }
            }
            continuation.onTermination = { _ in task.cancel() }
        }
    }

    private static func followRun(_ runID: String, on host: DeviceEndpointHost, into continuation: DeviceRunSubscriptions.Continuation) async throws {
        let delays: [Duration] = [.zero, .milliseconds(250), .milliseconds(750), .seconds(2)]
        var sequence = 0
        var attempt = 0
        while !Task.isCancelled {
            do {
                for try await event in try await host.subscribeToRun(runID, after: sequence) {
                    sequence = event.sequence
                    attempt = 0
                    if case .terminated = continuation.yield(event) {
                        return
                    }
                    if event.isTerminal {
                        return
                    }
                }
                return
            } catch where error is DeviceRunStreamError || error is URLError || (error as? GatewayClientError) == .transport {
                guard attempt < delays.count else { throw error }
                try await Task.sleep(for: delays[attempt])
                attempt += 1
            }
        }
    }
}
