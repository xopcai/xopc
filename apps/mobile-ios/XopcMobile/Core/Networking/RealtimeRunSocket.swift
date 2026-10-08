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

    func consume(into continuation: AsyncThrowingStream<RunStreamEvent, Error>.Continuation) async throws {
        let socket = try session.webSocketTask(with: webSocketURL())
        self.socket = socket
        socket.resume()
        try await socket.send(.data(JSONEncoder().encode(helloFrame())))

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
            let data = try await receiveData(from: socket)
            let frame = try JSONDecoder().decode(RealtimeServerFrame.self, from: data)
            try validate(frame)
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
                guard eventName == "session.task-result", eventData?.conversationId == conversationID else { continue }
            }
            let event = RunStreamEvent(
                name: eventName,
                sequence: sequence,
                messageId: eventData?.payload?.messageId,
                delta: eventData?.payload?.delta,
                offset: eventData?.payload?.offset,
                status: eventData?.payload?.status,
                errorMessage: eventData?.payload?.message,
                toolName: eventData?.payload?.toolName,
                stage: eventData?.payload?.stage
            )
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
        try await socket.send(.data(JSONEncoder().encode(frame)))
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

    private func webSocketURL() throws -> URL {
        guard var components = URLComponents(
            url: configuration.baseURL.appending(path: "/api/realtime/v1/ws"),
            resolvingAgainstBaseURL: false
        ) else {
            throw GatewayClientError.invalidURL
        }
        switch components.scheme {
        case "http": components.scheme = "ws"
        case "https": components.scheme = "wss"
        default: throw GatewayClientError.invalidURL
        }
        guard let url = components.url else { throw GatewayClientError.invalidURL }
        return url
    }

    private func receiveData(from socket: URLSessionWebSocketTask) async throws -> Data {
        let received = try await withTaskCancellationHandler {
            try await socket.receive()
        } onCancel: {
            socket.cancel(with: .goingAway, reason: nil)
        }
        switch received {
        case let .data(data):
            return data
        case let .string(text):
            guard let data = text.data(using: .utf8) else { throw GatewayClientError.invalidResponse }
            return data
        @unknown default:
            throw GatewayClientError.invalidResponse
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
}
