import Foundation

enum RealtimeVoiceTransportError: Error, Equatable, Sendable {
    case secureRouteRequired
    case protocolMismatch
    case disconnected
    case inputBackpressure
}

enum RealtimeVoiceIncoming: Sendable {
    case event(RealtimeVoiceEvent)
    case audio(RealtimeVoiceDownlinkFrame)
    case latency(Int)
}

actor RealtimeVoiceTransport {
    private var socket: URLSessionWebSocketTask?
    private var receiveTask: Task<Void, Never>?
    private var heartbeatTask: Task<Void, Never>?
    private var readyTimeoutTask: Task<Void, Never>?
    private var audioQueue: Task<Void, Never>?
    private var continuation: AsyncThrowingStream<RealtimeVoiceIncoming, Error>.Continuation?
    private var session: RealtimeVoiceSession?
    private var eventSequence = 0
    private var audioSequence: UInt32 = 0
    private var inputSequence: UInt32 = 0
    private var inputStarted = false
    private var utteranceID = UUID().uuidString.lowercased()
    private var remainder = Data()
    private var pendingBytes = 0
    private var ready = false
    private var closed = true
    private var lastPong = Date()
    private var lastPing: Date?
    private var streamEpoch = 0

    func connect(origin: URL, session: RealtimeVoiceSession) throws -> AsyncThrowingStream<RealtimeVoiceIncoming, Error> {
        guard session.supportsNativePCM else { throw RealtimeVoiceTransportError.protocolMismatch }
        let routes = try Self.webSocketRoutes(origin: origin, session: session)
        close()
        streamEpoch += 1
        let currentEpoch = streamEpoch
        self.session = session
        eventSequence = 0
        audioSequence = 0
        inputSequence = 0
        inputStarted = false
        utteranceID = UUID().uuidString.lowercased()
        remainder.removeAll()
        pendingBytes = 0
        closed = false
        return AsyncThrowingStream<RealtimeVoiceIncoming, Error> { continuation in
            self.continuation = continuation
            self.receiveTask = Task { await self.run(routes: routes, session: session) }
            continuation.onTermination = { @Sendable _ in
                Task { await self.close(ifEpoch: currentEpoch) }
            }
        }
    }

    func send(_ type: String, payload: RealtimeVoiceControlPayload = .init()) async throws {
        guard let socket, !closed else { throw RealtimeVoiceTransportError.disconnected }
        let message = RealtimeVoiceControlMessage(type: type, payload: payload)
        let data = try JSONEncoder().encode(message)
        guard let text = String(data: data, encoding: .utf8) else { throw RealtimeVoiceProtocolError.invalidEvent }
        try await socket.send(.string(text))
        if type == "input.mute", payload.muted == false {
            utteranceID = UUID().uuidString.lowercased()
            inputSequence = 0
            inputStarted = false
            remainder.removeAll()
        }
    }

    func sendAudio(_ bytes: Data) throws -> Int {
        guard ready, !closed, let session else { throw RealtimeVoiceTransportError.disconnected }
        let queueAgeMs = pendingBytes / 32
        guard queueAgeMs < 300 else { throw RealtimeVoiceTransportError.inputBackpressure }
        remainder.append(bytes)
        while remainder.count >= 640 {
            let audio = Data(remainder.prefix(640))
            remainder.removeFirst(640)
            inputSequence += 1
            let frame = try RealtimeVoiceProtocol.encodeUplink(
                connectionEpoch: session.connectionEpoch,
                utteranceID: utteranceID,
                sequence: inputSequence,
                capturedAtMonotonicMs: ProcessInfo.processInfo.systemUptime * 1000,
                start: !inputStarted,
                audio: audio
            )
            inputStarted = true
            pendingBytes += frame.count
            let previous = audioQueue
            audioQueue = Task {
                await previous?.value
                await self.transmit(frame)
            }
        }
        return pendingBytes / 32
    }

    func inputQueueAgeMs() -> Int {
        pendingBytes / 32
    }

    func close() {
        guard !closed else { return }
        closed = true
        ready = false
        receiveTask?.cancel()
        receiveTask = nil
        heartbeatTask?.cancel()
        heartbeatTask = nil
        readyTimeoutTask?.cancel()
        readyTimeoutTask = nil
        audioQueue?.cancel()
        audioQueue = nil
        socket?.cancel(with: .normalClosure, reason: nil)
        socket = nil
        session = nil
        pendingBytes = 0
        remainder.removeAll()
        continuation?.finish()
        continuation = nil
    }

    private func close(ifEpoch epoch: Int) {
        guard streamEpoch == epoch else { return }
        close()
    }

    private func run(routes: [URL], session: RealtimeVoiceSession) async {
        for route in routes {
            guard !Task.isCancelled, !closed else { return }
            do {
                try await receive(route: route, session: session)
                close()
                return
            } catch {
                readyTimeoutTask?.cancel()
                readyTimeoutTask = nil
                socket?.cancel(with: .goingAway, reason: nil)
                socket = nil
                if ready || route == routes.last {
                    continuation?.finish(throwing: error)
                    close()
                    return
                }
                eventSequence = 0
                audioSequence = 0
            }
        }
    }

    private func receive(route: URL, session: RealtimeVoiceSession) async throws {
        var request = URLRequest(url: route)
        request.timeoutInterval = 15
        let socket = URLSession.shared.webSocketTask(with: request)
        self.socket = socket
        socket.resume()
        readyTimeoutTask = Task {
            try? await Task.sleep(for: .seconds(15))
            guard !Task.isCancelled, !ready, !closed, self.socket === socket else { return }
            socket.cancel(with: .goingAway, reason: nil)
        }
        try await send("session.start", payload: .init(sessionId: session.sessionId, ticket: session.ticket))
        while !Task.isCancelled, !closed {
            let message = try await socket.receive()
            switch message {
            case let .string(text):
                let event = try RealtimeVoiceProtocol.decodeEvent(Data(text.utf8))
                try receiveEvent(event, session: session)
            case let .data(data):
                let frame = try RealtimeVoiceProtocol.decodeDownlink(data)
                guard ready, frame.connectionEpoch == session.connectionEpoch,
                      frame.sequence == audioSequence + 1
                else { throw RealtimeVoiceTransportError.protocolMismatch }
                audioSequence = frame.sequence
                continuation?.yield(.audio(frame))
            @unknown default:
                throw RealtimeVoiceTransportError.protocolMismatch
            }
        }
    }

    private func receiveEvent(_ event: RealtimeVoiceEvent, session: RealtimeVoiceSession) throws {
        guard event.sessionId == session.sessionId, event.seq == eventSequence + 1 else {
            throw RealtimeVoiceTransportError.protocolMismatch
        }
        eventSequence = event.seq
        if event.type == "session.ready" {
            guard !ready, event.payload.connectionEpoch == session.connectionEpoch,
                  event.payload.route?.engine == session.route.engine
            else { throw RealtimeVoiceTransportError.protocolMismatch }
            ready = true
            readyTimeoutTask?.cancel()
            readyTimeoutTask = nil
            lastPong = Date()
            startHeartbeat(intervalMs: event.payload.heartbeatIntervalMs ?? 15000)
        } else if event.type == "session.pong" {
            lastPong = Date()
            if let lastPing {
                continuation?.yield(.latency(Int(Date().timeIntervalSince(lastPing) * 1000)))
                self.lastPing = nil
            }
        }
        continuation?.yield(.event(event))
        if event.type == "session.closed" || event.type == "session.error" && event.payload.recoverable != true {
            close()
        }
    }

    private func startHeartbeat(intervalMs: Int) {
        heartbeatTask?.cancel()
        heartbeatTask = Task {
            while !Task.isCancelled, !closed {
                try? await Task.sleep(for: .milliseconds(max(1000, intervalMs)))
                guard !Task.isCancelled, !closed else { return }
                guard Date().timeIntervalSince(lastPong) < 35 else {
                    continuation?.finish(throwing: RealtimeVoiceTransportError.disconnected)
                    close()
                    return
                }
                lastPing = Date()
                try? await send("session.ping")
            }
        }
    }

    private func transmit(_ frame: Data) async {
        defer { pendingBytes = max(0, pendingBytes - frame.count) }
        guard let socket, !closed else { return }
        do {
            try await socket.send(.data(frame))
        } catch {
            continuation?.finish(throwing: error)
            close()
        }
    }

    static func webSocketRoutes(origin: URL, session: RealtimeVoiceSession) throws -> [URL] {
        guard let scheme = origin.scheme?.lowercased(), let host = origin.host?.lowercased() else {
            throw RealtimeVoiceTransportError.secureRouteRequired
        }
        let isLoopback = host == "localhost" || host == "127.0.0.1" || host == "::1"
        #if DEBUG
            guard scheme == "https" || scheme == "http" && isLoopback else {
                throw RealtimeVoiceTransportError.secureRouteRequired
            }
        #else
            guard scheme == "https" else { throw RealtimeVoiceTransportError.secureRouteRequired }
        #endif
        func route(path: String, query: String? = nil) throws -> URL {
            var components = URLComponents(url: origin, resolvingAgainstBaseURL: false)
            components?.scheme = scheme == "https" ? "wss" : "ws"
            components?.path = path
            components?.percentEncodedQuery = query
            guard let url = components?.url else { throw RealtimeVoiceTransportError.secureRouteRequired }
            return url
        }
        return try [
            route(path: session.websocketPath),
            route(path: "/api/realtime/v1/ws", query: "transport=voice-v3")
        ]
    }
}
