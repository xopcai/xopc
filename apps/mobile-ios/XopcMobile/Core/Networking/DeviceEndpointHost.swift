import CryptoKit
import Foundation
import UIKit

// swiftlint:disable:next type_body_length
actor DeviceEndpointHost {
    let client: GatewayClient
    private(set) var socket: URLSessionWebSocketTask?
    private(set) var claim: DeviceEndpointOrigin?
    private(set) var pairedDeviceID: String?
    var connectionState = DeviceEndpointConnectionState()
    private var runSubscriptions = DeviceRunSubscriptions()
    private(set) var retired = false
    private var invocations: [String: Task<Void, Never>] = [:]
    private var reader: Task<Void, Never>?
    private var heartbeat: Task<Void, Never>?
    var probeTask: Task<Void, Never>?
    private var environmentTask: Task<Void, Never>?
    private(set) var appProviderAccepted = false
    private var appProviderSequence = 0
    private(set) var lastReceivedAt = Date()
    var lastPingSentAt = Date()
    private var lastProviderReportAt = Date.distantPast
    private var lastReportedForeground: Bool?
    private var foregroundTimeoutSeconds: TimeInterval = 45
    private var backgroundTimeoutSeconds: TimeInterval = 45
    private var backgroundTaskID: UIBackgroundTaskIdentifier = .invalid
    private var cachedBootstrap: Bootstrap?
    private let instance = UUID().uuidString.lowercased()
    init(client: GatewayClient) {
        self.client = client
    }

    func stop() {
        retired = true
        cachedBootstrap = nil
        stopConnectionTracking()
        closeSocket()
        Task { await endBackgroundLease() }
    }

    func onAppLifecycleChanged(active: Bool, background: Bool) async {
        if background {
            probeTask?.cancel(); probeTask = nil
            if let socket {
                try? await send("endpoint.availability_changed", ["availability": "background"])
                try? await publishAppProviderState(socket, force: true, foregroundOverride: false)
                await beginBackgroundLease()
            }
            return
        }
        if active {
            await endBackgroundLease()
            guard let socket else { return }
            await probeRoute(socket)
            guard self.socket === socket else { return }
            do {
                try await send("endpoint.availability_changed", ["availability": "foreground"])
                try await publishAppProviderState(socket, force: true, foregroundOverride: true)
            } catch {
                if self.socket === socket {
                    closeSocket()
                }
                return
            }
        }
    }

    private func beginBackgroundLease() async {
        guard backgroundTaskID == .invalid else { return }
        let taskID = await MainActor.run {
            UIApplication.shared.beginBackgroundTask(withName: "ai.xopc.realtime-keepalive") { [weak self] in
                Task { await self?.handleBackgroundLeaseExpired() }
            }
        }
        backgroundTaskID = taskID
    }

    private func handleBackgroundLeaseExpired() async {
        if socket != nil {
            closeSocket()
        }
        await endBackgroundLease()
    }

    private func endBackgroundLease() async {
        let current = backgroundTaskID
        guard current != .invalid else { return }
        backgroundTaskID = .invalid
        await MainActor.run {
            UIApplication.shared.endBackgroundTask(current)
        }
    }

    func closeSocket() {
        claim = nil
        pairedDeviceID = nil
        runSubscriptions.finishAll(throwing: retired ? CancellationError() : DeviceRunStreamError.disconnected)
        appProviderAccepted = false
        appProviderSequence = 0
        lastReportedForeground = nil
        lastProviderReportAt = .distantPast
        for task in invocations.values {
            task.cancel()
        }; invocations.removeAll()
        reader?.cancel(); heartbeat?.cancel()
        probeTask?.cancel(); probeTask = nil
        environmentTask?.cancel(); environmentTask = nil
        socket?.cancel(with: .normalClosure, reason: nil)
        socket = nil
        continueConnectionRecovery()
    }

    private struct Bootstrap {
        let compatibility: DeviceCompatibility
        let multiQuestion: Bool
        let principalId: String
        let key: P256.Signing.PrivateKey
    }

    private func loadBootstrap() async throws -> Bootstrap {
        if let cachedBootstrap {
            return cachedBootstrap
        }
        let response: GatewayEnvelope<DeviceCompatibility> = try await client.request(path: "/api/endpoint-tools/compatibility")
        let compatibility = response.payload ?? DeviceCompatibility(
            deviceId: nil, turnDeviceContextV1: nil, clarificationVersions: nil, deviceLocationTasksV1: nil,
            mobilePersonalToolsV1: nil, mobileExtendedPersonalToolsV1: nil, deviceStateToolsV1: nil, endpointEnvironmentV1: nil
        )
        let multiQuestion = await client.supportsMultiQuestion(compatibility.clarificationVersions)
        let key = try Self.signingKey()
        let fallback = "ios-" + SHA256.hash(data: key.publicKey.derRepresentation).prefix(16).map { String(format: "%02x", $0) }.joined()
        let principalId = compatibility.deviceId ?? fallback
        try Task.checkCancellation()
        try await registerPrincipal(principalId, key: key)
        try Task.checkCancellation()
        let bootstrap = Bootstrap(compatibility: compatibility, multiQuestion: multiQuestion, principalId: principalId, key: key)
        cachedBootstrap = bootstrap
        return bootstrap
    }

    // swiftlint:disable:next function_body_length
    func connect() async throws -> DeviceEndpointOrigin {
        let bootstrap = try await loadBootstrap()
        try Task.checkCancellation()
        let endpointId = "ios:\(bootstrap.principalId):\(instance)"
        let ticket: GatewayEnvelope<RealtimeTicket> = try await client.request(path: "/api/realtime/tickets", method: "POST",
                                                                               body: client.encoder.encode(RealtimeTicketCommand(clientId: endpointId, clientKind: "mobile", protocolVersion: 2)))
        guard let ticket = ticket.payload, ticket.realtime.minVersion <= 2, ticket.realtime.maxVersion >= 2,
              ticket.realtime.capabilities.contains("endpoint.tools.v3")
        else {
            cachedBootstrap = nil
            throw GatewayClientError.invalidResponse
        }
        let catalogJson = bootstrap.compatibility.catalogJson
        let tools = try JSONSerialization.jsonObject(with: Data(catalogJson.utf8))
        let isForeground = await MainActor.run { UIApplication.shared.applicationState != .background }
        var endpoint: [String: Any] = ["principalId": bootstrap.principalId, "endpointId": endpointId, "connectionInstanceId": UUID().uuidString.lowercased(),
                                       "displayName": "xopc iOS", "kind": "mobile", "platform": "ios", "appVersion": "1",
                                       "availability": isForeground ? "foreground" : "background",
                                       "nonce": UUID().uuidString.lowercased(), "signedAt": Self.now(), "tools": tools]
        endpoint["signature"] = try bootstrap.key.signature(for: Self.json(endpoint)).rawRepresentation.base64URL()
        let url = try client.configuration.realtimeWebSocketURL()
        var request = URLRequest(url: url)
        try await request.setValue(GatewayPairingService.shared.connectionProof(url: url, ticket: ticket.ticket),
                                   forHTTPHeaderField: "X-Xopc-Proof")
        try Task.checkCancellation()
        let socket = client.session.webSocketTask(with: request)
        socket.maximumMessageSize = 2 * 1024 * 1024
        self.socket = socket; socket.resume()
        do {
            try await send("realtime.hello", [
                "ticket": ticket.ticket,
                "clientId": endpointId,
                "clientKind": "mobile",
                "subscriptions": [],
                "endpoint": endpoint,
                "capabilities": ["endpoint.tools.v3", "mobile.mcp-setup-card.v1", "realtime.background-keepalive.v1", "endpoint.background-tools.v1"]
            ])
            let timeout = Task {
                try? await Task.sleep(for: .seconds(10))
                if !Task.isCancelled {
                    socket.cancel(with: .goingAway, reason: nil)
                }
            }
            defer { timeout.cancel() }
            let ready = try await receive(socket).frame
            guard ready["kind"] as? String == "realtime.ready", let payload = ready["payload"] as? [String: Any],
                  let endpoint = payload["endpoint"] as? [String: Any], endpoint["endpointId"] as? String == endpointId,
                  let token = endpoint["turnToken"] as? String, token.count >= 32 else { throw GatewayClientError.invalidResponse }
            configureHeartbeat(payload)
            let multiQuestionSupported = bootstrap.multiQuestion
            guard self.socket === socket else { throw GatewayClientError.invalidResponse }
            let claim = DeviceEndpointOrigin(endpointId: endpointId, token: token,
                                             supportsDeviceContext: bootstrap.compatibility.turnDeviceContextV1 == true,
                                             supportsMultiQuestion: multiQuestionSupported)
            if let catalog = try JSONSerialization.jsonObject(with: Data(DeviceToolCatalog.appProviderJson.utf8)) as? [String: Any] {
                try await send("provider.catalog.replace", catalog)
            }
            guard self.socket === socket else { throw GatewayClientError.transport }
            self.claim = claim
            pairedDeviceID = bootstrap.compatibility.deviceId
            lastReceivedAt = Date()
            lastPingSentAt = Date()
            startLoops(socket)
            if bootstrap.compatibility.endpointEnvironmentV1 == true {
                environmentTask = Task { await publishEnvironment(claim) }
            }
            setConnectionPhase(.connected)
            return claim
        } catch {
            if self.socket === socket {
                closeSocket()
            }
            throw error
        }
    }

    private func configureHeartbeat(_ payload: [String: Any]) {
        if let fgMs = payload["heartbeatTimeoutMs"] as? Double, fgMs > 0 {
            foregroundTimeoutSeconds = fgMs / 1000.0
        }
        if let bgMs = payload["backgroundHeartbeatTimeoutMs"] as? Double, bgMs > 0 {
            backgroundTimeoutSeconds = bgMs / 1000.0
        } else {
            backgroundTimeoutSeconds = foregroundTimeoutSeconds
        }
    }

    private func registerPrincipal(_ principalId: String, key: P256.Signing.PrivateKey) async throws {
        let registration: [String: Any] = ["principalId": principalId, "kind": "mobile", "platform": "ios",
                                           "displayName": "xopc iOS", "publicKey": key.publicKey.derRepresentation.base64URL()]
        let registered: GatewayEnvelope<IgnoredResponse> = try await client.request(path: "/api/endpoint-tools/principals",
                                                                                    method: "POST", body: Self.json(registration))
        guard registered.isSuccessful else { throw GatewayClientError.server("无法注册设备能力") }
    }

    private func startLoops(_ socket: URLSessionWebSocketTask) {
        reader = Task { await readLoop(socket) }
        heartbeat = Task {
            while !Task.isCancelled {
                do {
                    try await Task.sleep(for: .seconds(5))
                    try Task.checkCancellation()
                    guard self.socket === socket else { break }
                    let foreground = await MainActor.run { UIApplication.shared.applicationState != .background }
                    let activeTimeout = foreground ? foregroundTimeoutSeconds : backgroundTimeoutSeconds
                    if Date().timeIntervalSince(lastReceivedAt) > activeTimeout {
                        closeSocket()
                        break
                    }
                    let pingInterval: TimeInterval = foreground ? 15 : 25
                    if Date().timeIntervalSince(lastPingSentAt) >= pingInterval {
                        lastPingSentAt = Date()
                        try await send("realtime.ping", ["availability": foreground ? "foreground" : "background"])
                    }
                    try await publishAppProviderState(socket, force: false, foregroundOverride: foreground)
                } catch {
                    if self.socket === socket, !Task.isCancelled {
                        closeSocket()
                    }
                    break
                }
            }
        }
    }

    private func publishAppProviderState(_ socket: URLSessionWebSocketTask, force: Bool = false, foregroundOverride: Bool? = nil) async throws {
        guard appProviderAccepted else { return }
        let foreground: Bool = if let foregroundOverride {
            foregroundOverride
        } else {
            await MainActor.run { UIApplication.shared.applicationState != .background }
        }
        let now = Date()
        if !force, foreground == lastReportedForeground, now.timeIntervalSince(lastProviderReportAt) < 15 {
            return
        }
        guard self.socket === socket, appProviderAccepted else { return }
        lastReportedForeground = foreground
        lastProviderReportAt = now
        try await send("endpoint.availability_changed", ["availability": foreground ? "foreground" : "background"])
        guard self.socket === socket, appProviderAccepted else { return }
        appProviderSequence += 1
        try await send("provider.state.changed", ["localId": DeviceToolCatalog.appProviderId, "catalogRevision": 1,
                                                  "sequence": appProviderSequence, "validForMs": 30000,
                                                  "reason": foreground ? "ready" : "needs_foreground"])
    }

    private struct EnvironmentAck: Decodable {
        let connectionEpoch: String?
        let revision: Int
    }

    private func environmentRequest(_ path: String, body: Data? = nil) async throws -> EnvironmentAck {
        let response: GatewayEnvelope<EnvironmentAck> = try await client.request(path: path,
                                                                                 method: body == nil ? "GET" : "POST", body: body)
        try Task.checkCancellation()
        guard response.isSuccessful, let payload = response.payload else { throw GatewayClientError.invalidResponse }
        return payload
    }

    private func publishEnvironment(_ origin: DeviceEndpointOrigin) async {
        let root = "/api/user-context/environment"
        var epoch: String?
        var sequence = 0
        var heartbeatSequence = 0
        var nextReport: Int64 = 0
        while !Task.isCancelled, claim?.token == origin.token {
            do {
                if epoch == nil {
                    guard let endpoint = origin.endpointId.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed.subtracting(CharacterSet(charactersIn: "/"))) else { return }
                    epoch = try await environmentRequest(root + "/endpoints/" + endpoint).connectionEpoch
                }
                guard let epoch else { return }
                let foreground = await MainActor.run { UIApplication.shared.applicationState == .active }
                heartbeatSequence += 1
                let source: [String: Any] = ["type": "endpoint", "endpointId": origin.endpointId, "token": origin.token]
                _ = try await environmentRequest(root + "/heartbeats", body: Self.json(["origin": source, "heartbeat": [
                    "connectionEpoch": epoch, "sequence": heartbeatSequence, "availability": foreground ? "foreground" : "background"
                ]]))
                let now = Self.now()
                if foreground, now >= nextReport {
                    sequence += 1
                    _ = try await environmentRequest(root + "/reports", body: Self.json(["origin": source, "report": [
                        "version": 1, "reportId": UUID().uuidString, "connectionEpoch": epoch, "sequence": sequence,
                        "baseRevision": NSNull(), "mode": "full", "capturedAt": now,
                        "values": ["environment.timezone": TimeZone.current.identifier,
                                   "environment.locale": Locale.current.identifier.replacingOccurrences(of: "_", with: "-")]
                    ]]))
                    nextReport = now + 60000
                }
            } catch {
                if Task.isCancelled {
                    return
                }
                epoch = nil; nextReport = 0
            }
            do { try await Task.sleep(for: .seconds(15)) } catch { return }
        }
    }

    private func readLoop(_ socket: URLSessionWebSocketTask) async {
        do {
            while !Task.isCancelled {
                let (frame, data) = try await receive(socket)
                guard self.socket === socket else { return }
                lastReceivedAt = Date()
                if let topic = try runSubscriptions.receive(frame, data: data) {
                    try await send("realtime.unsubscribe", ["topics": [topic]])
                }
                guard try await handleFrame(frame, socket: socket) else { break }
            }
        } catch { /* Active run observers reconnect from their last delivered sequence. */ }
        if self.socket === socket {
            closeSocket()
        }
    }

    func subscribeToRun(_ runID: String, after sequence: Int) async throws -> AsyncThrowingStream<RunStreamEvent, Error> {
        _ = try await origin()
        try Task.checkCancellation()
        guard let socket else { throw DeviceRunStreamError.disconnected }
        let topic = "run:\(runID)"
        let (stream, continuation) = AsyncThrowingStream<RunStreamEvent, Error>.makeStream()
        let id = UUID()
        continuation.onTermination = { [weak self] _ in
            Task { await self?.removeRunSubscription(topic, id: id) }
        }
        let cursor = runSubscriptions.add(topic, id: id, after: sequence, continuation: continuation)
        do {
            try await send("realtime.subscribe", ["subscriptions": [["topic": topic, "afterSeq": cursor, "view": "compact"]]])
            return stream
        } catch {
            if Task.isCancelled || retired {
                continuation.finish()
                throw CancellationError()
            }
            if self.socket === socket {
                closeSocket()
            }
            throw DeviceRunStreamError.disconnected
        }
    }

    func subscribeToTaskResults(conversationID: String) async throws -> AsyncThrowingStream<RunStreamEvent, Error> {
        _ = try await origin()
        try Task.checkCancellation()
        guard let socket else { throw DeviceRunStreamError.disconnected }
        let topic = "sessions"
        let (stream, continuation) = AsyncThrowingStream<RunStreamEvent, Error>.makeStream()
        let id = UUID()
        continuation.onTermination = { [weak self] _ in
            Task { await self?.removeRunSubscription(topic, id: id) }
        }
        _ = runSubscriptions.add(topic, id: id, after: 0, conversationID: conversationID, continuation: continuation)
        do {
            try await send("realtime.subscribe", ["subscriptions": [["topic": topic, "afterSeq": 0, "view": "compact"]]])
            return stream
        } catch {
            if Task.isCancelled || retired {
                continuation.finish()
                throw CancellationError()
            }
            if self.socket === socket {
                closeSocket()
            }
            throw DeviceRunStreamError.disconnected
        }
    }

    private func removeRunSubscription(_ topic: String, id: UUID) async {
        guard runSubscriptions.remove(topic, id: id), let socket else { return }
        do { try await send("realtime.unsubscribe", ["topics": [topic]]) } catch {
            if self.socket === socket {
                closeSocket()
            }
        }
    }

    private func handleFrame(_ frame: [String: Any], socket: URLSessionWebSocketTask) async throws -> Bool {
        guard frame["kind"] as? String == "endpoint.message" else {
            return frame["kind"] as? String != "realtime.error"
        }
        guard let inner = frame["payload"] as? [String: Any], let request = inner["payload"] as? [String: Any] else { return true }
        guard inner["protocolVersion"] as? Int == 3 else { return false }
        if inner["type"] as? String == "provider.catalog.ack" {
            return try await acceptProviderCatalog(request, socket: socket)
        }
        guard let id = request["invocationId"] as? String else { return true }
        if inner["type"] as? String == "tool.invoke" {
            guard invocations[id] == nil else { return true }
            let requestData = try Self.json(request)
            invocations[id] = Task { [weak self] in
                guard let self else { return }
                do { try await invoke(requestData) } catch {}
                await completedInvocation(id)
            }
        } else if inner["type"] as? String == "tool.cancel" {
            invocations.removeValue(forKey: id)?.cancel()
        }
        return true
    }

    private func acceptProviderCatalog(_ request: [String: Any], socket: URLSessionWebSocketTask) async throws -> Bool {
        guard self.socket === socket else { return false }
        appProviderAccepted = request["revision"] as? Int == 1 && request["accepted"] as? Bool == true
        try await publishAppProviderState(socket)
        return true
    }

    private func completedInvocation(_ id: String) {
        invocations.removeValue(forKey: id)
    }

    func cancelInvocation(_ id: String) {
        invocations[id]?.cancel()
    }

    func send(_ kind: String, _ payload: [String: Any]) async throws {
        if kind.hasPrefix("tool.") || kind.hasPrefix("provider.") || kind == "endpoint.availability_changed" {
            try await send("endpoint.message", ["protocolVersion": 3, "messageId": UUID().uuidString, "type": kind, "sentAt": Self.now(), "payload": payload]); return
        }

        guard let socket else { throw GatewayClientError.transport }
        let data = try Self.json(["protocolVersion": 2, "messageId": UUID().uuidString.lowercased(),
                                  "sentAt": Self.now(), "kind": kind, "payload": payload])
        guard let text = String(data: data, encoding: .utf8) else { throw GatewayClientError.invalidResponse }
        try await socket.send(.string(text))
    }

    private func receive(_ socket: URLSessionWebSocketTask) async throws -> (frame: [String: Any], data: Data) {
        let data = try await socket.receiveFrameData()
        guard let frame = try JSONSerialization.jsonObject(with: data) as? [String: Any],
              frame["protocolVersion"] as? Int == 2,
              data.count <= 256 * 1024 || frame["kind"] as? String == "realtime.event" else { throw GatewayClientError.invalidResponse }
        return (frame, data)
    }
}
