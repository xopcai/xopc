import CryptoKit
import Foundation
import UIKit

// swiftlint:disable:next type_body_length
actor DeviceEndpointHost {
    private let client: GatewayClient
    private var socket: URLSessionWebSocketTask?
    private var claim: DeviceEndpointOrigin?
    private var pairedDeviceID: String?
    private var connection: Task<DeviceEndpointOrigin, Error>?
    private var runSubscriptions = DeviceRunSubscriptions()
    private var retired = false
    private var invocations: [String: Task<Void, Never>] = [:]
    private var reader: Task<Void, Never>?
    private var heartbeat: Task<Void, Never>?
    private var probeTask: Task<Void, Never>?
    private var environmentTask: Task<Void, Never>?
    private var appProviderAccepted = false
    private var appProviderSequence = 0
    private var lastReceivedAt = Date()
    private var lastPingSentAt = Date()
    private var lastProviderReportAt = Date.distantPast
    private var lastReportedForeground: Bool?
    private var foregroundTimeoutSeconds: TimeInterval = 45
    private var backgroundTimeoutSeconds: TimeInterval = 45
    private var backgroundTaskID: UIBackgroundTaskIdentifier = .invalid
    private var cachedBootstrap: (compatibility: DeviceCompatibility, multiQuestion: Bool, principalId: String, key: P256.Signing.PrivateKey)?
    private let instance = UUID().uuidString.lowercased()
    init(client: GatewayClient) {
        self.client = client
    }

    func origin() async throws -> DeviceEndpointOrigin {
        guard !retired else { throw CancellationError() }
        if let claim {
            return claim
        }
        if let connection {
            return try await connection.value
        }
        let task = Task { try await connect() }
        connection = task
        defer { connection = nil }
        return try await task.value
    }

    func stop() {
        retired = true
        cachedBootstrap = nil
        connection?.cancel()
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
            let probeSentAt = Date()
            lastPingSentAt = probeSentAt
            do {
                try await send("endpoint.availability_changed", ["availability": "foreground"])
                try await publishAppProviderState(socket, force: true, foregroundOverride: true)
                try await send("realtime.ping", ["availability": "foreground"])
            } catch {
                if self.socket === socket {
                    closeSocket()
                }
                return
            }
            probeTask?.cancel()
            probeTask = Task { [weak self] in
                try? await Task.sleep(for: .milliseconds(2500))
                guard !Task.isCancelled else { return }
                await self?.verifyProbeResponse(socket: socket, sentAt: probeSentAt)
            }
        }
    }

    private func verifyProbeResponse(socket: URLSessionWebSocketTask, sentAt: Date) {
        guard self.socket === socket, lastReceivedAt < sentAt else { return }
        closeSocket()
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

    private func closeSocket() {
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
    }

    // swiftlint:disable:next function_body_length
    private func connect() async throws -> DeviceEndpointOrigin {
        let bootstrap: (compatibility: DeviceCompatibility, multiQuestion: Bool, principalId: String, key: P256.Signing.PrivateKey)
        if let cached = cachedBootstrap {
            bootstrap = cached
        } else {
            let compatibility: GatewayEnvelope<DeviceCompatibility> = try await client.request(path: "/api/endpoint-tools/compatibility")
            let compatPayload = compatibility.payload ?? DeviceCompatibility(
                deviceId: nil, turnDeviceContextV1: nil, clarificationVersions: nil, deviceLocationTasksV1: nil,
                mobilePersonalToolsV1: nil, mobileExtendedPersonalToolsV1: nil, deviceStateToolsV1: nil, endpointEnvironmentV1: nil
            )
            let multiQuestion = await client.supportsMultiQuestion(compatPayload.clarificationVersions)
            let key = try Self.signingKey()
            let fallback = "ios-" + SHA256.hash(data: key.publicKey.derRepresentation).prefix(16).map { String(format: "%02x", $0) }.joined()
            let principalId = compatPayload.deviceId ?? fallback
            try await registerPrincipal(principalId, key: key)
            bootstrap = (compatPayload, multiQuestion, principalId, key)
            cachedBootstrap = bootstrap
        }
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
            if let fgMs = payload["heartbeatTimeoutMs"] as? Double, fgMs > 0 {
                foregroundTimeoutSeconds = fgMs / 1000.0
            }
            if let bgMs = payload["backgroundHeartbeatTimeoutMs"] as? Double, bgMs > 0 {
                backgroundTimeoutSeconds = bgMs / 1000.0
            } else {
                backgroundTimeoutSeconds = foregroundTimeoutSeconds
            }
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
            return claim
        } catch {
            if self.socket === socket {
                closeSocket()
            }
            throw error
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
        if !force, foreground == lastReportedForeground, now.timeIntervalSince(lastProviderReportAt) < 15 { return }
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

    private func invoke(_ requestData: Data) async throws {
        guard let request = try JSONSerialization.jsonObject(with: requestData) as? [String: Any], let id = request["invocationId"] as? String else { throw GatewayClientError.invalidResponse }
        if request["toolName"] as? String == "mobile.device.get_location" {
            try await invokeLocation(request, id: id)
            return
        }
        if let name = request["toolName"] as? String, Self.personalNames.contains(name) {
            try await invokePersonal(requestData, id: id); return
        }
        try await invokeState(request, id: id)
    }

    private func invokeState(_ request: [String: Any], id: String) async throws {
        func fail(_ code: String) async throws {
            try await send("tool.error", ["invocationId": id, "code": code, "message": "Device reading unavailable: \(code)"])
        }
        let index: Int
        switch request["toolName"] as? String {
        case "mobile.device.get_state": index = 0
        case "mobile.device.get_power": index = 1
        case DeviceToolCatalog.appToolName: index = 2
        default: try await fail("TOOL_NOT_FOUND"); return
        }
        let revision = index == 2 ? DeviceToolCatalog.appToolRevision : DeviceToolCatalog.revisions[index]
        guard request["descriptorRevision"] as? String == revision else {
            try await fail("TOOL_REVISION_MISMATCH"); return
        }
        guard request["confirmationRequired"] as? Bool == false,
              let arguments = request["arguments"] as? [String: Any], arguments.isEmpty
        else {
            try await fail("INVALID_ARGUMENTS"); return
        }
        guard let deadline = request["deadlineAt"] as? Double, deadline > Double(Self.now()) else {
            try await fail("TOOL_TIMEOUT"); return
        }
        if index == 2 {
            let foreground = await MainActor.run { UIApplication.shared.applicationState == .active }
            try Task.checkCancellation()
            guard appProviderAccepted, foreground else { try await fail("ENDPOINT_NOT_FOREGROUND"); return }
            try await send("tool.received", ["invocationId": id])
            try Task.checkCancellation()
            try await send("tool.result", ["invocationId": id, "content": [["type": "json", "value": ["active": true]]]])
            return
        }
        try await send("tool.received", ["invocationId": id])
        let reading = try await deviceReading(index)
        guard deadline > Double(Self.now()) else { try await fail("TOOL_TIMEOUT"); return }
        let value = try JSONSerialization.jsonObject(with: reading)
        try await send("tool.result", ["invocationId": id, "content": [["type": "json", "value": value]]])
    }

    private func deviceReading(_ index: Int) async throws -> Data {
        try await MainActor.run {
            if index == 0 {
                return try Self.json(["capturedAt": Self.now(), "platform": "ios", "systemVersion": UIDevice.current.systemVersion,
                                      "locale": Locale.current.identifier.replacingOccurrences(of: "_", with: "-"), "timezone": TimeZone.current.identifier])
            }
            let device = UIDevice.current
            let monitoring = device.isBatteryMonitoringEnabled
            device.isBatteryMonitoringEnabled = true
            defer { device.isBatteryMonitoringEnabled = monitoring }
            let level = device.batteryLevel
            let charging: Any = device.batteryState == .unknown ? NSNull() : (device.batteryState == .charging || device.batteryState == .full)
            return try Self.json(["capturedAt": Self.now(), "levelPercent": level >= 0 && level <= 1 ? Double(level) * 100 : NSNull(), "charging": charging])
        }
    }

    private func send(_ kind: String, _ payload: [String: Any]) async throws {
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

    private static func json(_ value: [String: Any]) throws -> Data {
        try JSONSerialization.data(withJSONObject: value, options: [.sortedKeys, .withoutEscapingSlashes])
    }

    private static func now() -> Int64 {
        Int64(Date().timeIntervalSince1970 * 1000)
    }
}

private extension DeviceEndpointHost {
    private static let personalNames = [
        "mobile.file.pick", "mobile.media.pick", "mobile.camera.capture", "mobile.contacts.pick",
        "mobile.calendar.query_events", "mobile.calendar.query_free_busy", "mobile.contacts.find_by_name",
        "mobile.calendar.create_event", "mobile.media.list_recent", "mobile.media.read_image", "mobile.media.add_to_album"
    ]

    private func invokePersonal(_ data: Data, id: String) async throws {
        do {
            let request = try JSONDecoder().decode(PersonalDeviceRequest.self, from: data)
            let calendar = try validatePersonalRequest(request)
            let remaining = request.deadlineAt - Self.now()
            guard remaining > 0 else { throw PersonalDeviceFailure(code: "TOOL_TIMEOUT") }
            try await send("tool.received", ["invocationId": id])
            let timeout = Task {
                try? await Task.sleep(for: .milliseconds(min(remaining, 120_000)))
                if !Task.isCancelled {
                    self.invocations[id]?.cancel()
                }
            }
            defer { timeout.cancel() }
            let gatewayIdentity = client.configuration.localIdentity ?? client.configuration.baseURL.absoluteString
            let capabilityScope = pairedDeviceID.map { gatewayIdentity + "." + $0 }
            let selected = try await DevicePersonalTools.shared.acquire(request, capabilityScope: capabilityScope)
            try Task.checkCancellation()
            let contentData: Data
            if calendar || request.toolName.hasPrefix("mobile.contacts.") || ["mobile.media.list_recent", "mobile.media.add_to_album"].contains(request.toolName) {
                contentData = selected
            } else {
                let file = try JSONDecoder().decode(DevicePersonalTools.SelectionWire.self, from: selected)
                guard let grant = request.uploadGrant, grant.path == "/api/endpoint-tools/invocations/\(id)/files", grant.expiresAt > Self.now(), file.data.count <= grant.maxBytes,
                      let endpointId = claim?.endpointId else { throw PersonalDeviceFailure(code: "PERMISSION_DENIED") }
                var upload = try URLRequest(url: client.makeURL(path: grant.path, queryItems: [URLQueryItem(name: "name", value: file.name)]))
                upload.httpMethod = "POST"; upload.httpBody = file.data
                upload.setValue("Bearer \(client.configuration.token)", forHTTPHeaderField: "Authorization")
                upload.setValue(file.mimeType, forHTTPHeaderField: "Content-Type")
                upload.setValue(endpointId, forHTTPHeaderField: "x-endpoint-id")
                upload.setValue(grant.token, forHTTPHeaderField: "x-endpoint-upload-token")
                let (body, response) = try await client.session.data(for: GatewayPairingService.shared.signedRequest(upload))
                guard (response as? HTTPURLResponse)?.statusCode == 201,
                      let envelope = try JSONSerialization.jsonObject(with: body) as? [String: Any], let payload = envelope["payload"] as? [String: Any] else { throw PersonalDeviceFailure(code: "PERMISSION_DENIED") }
                contentData = try Self.json(payload)
            }
            try Task.checkCancellation()
            let content = try JSONSerialization.jsonObject(with: contentData)
            try await send("tool.result", ["invocationId": id, "content": [content]])
        } catch is CancellationError { try await send("tool.cancelled", ["invocationId": id]) }
        catch {
            let code = (error as? PersonalDeviceFailure)?.code ?? "PERMISSION_DENIED"
            try await send("tool.error", ["invocationId": id, "code": code, "message": "Personal device request failed: \(code)"])
        }
    }

    private func validatePersonalRequest(_ request: PersonalDeviceRequest) throws -> Bool {
        guard let index = Self.personalNames.firstIndex(of: request.toolName),
              request.descriptorRevision == DeviceToolCatalog.revisions[index + 3]
        else { throw PersonalDeviceFailure(code: "TOOL_REVISION_MISMATCH") }
        let calendar = request.toolName.hasPrefix("mobile.calendar.")
        guard request.confirmationRequired == (["mobile.calendar.create_event", "mobile.media.add_to_album"].contains(request.toolName)) else { throw PersonalDeviceFailure(code: "INVALID_ARGUMENTS") }
        if calendar {
            guard let start = request.arguments.startAt, let end = request.arguments.endAt,
                  start >= 0, end > start, end - start <= 7 * 86_400_000
            else { throw PersonalDeviceFailure(code: "INVALID_ARGUMENTS") }
        }
        if request.toolName == "mobile.contacts.pick", !["phone", "email"].contains(request.arguments.field ?? "") {
            throw PersonalDeviceFailure(code: "INVALID_ARGUMENTS")
        }
        return calendar
    }

    private func invokeLocation(_ request: [String: Any], id: String) async throws {
        func fail(_ code: String) async throws {
            try await send("tool.error", ["invocationId": id, "code": code, "message": "Device reading unavailable: \(code)"])
        }
        guard request["descriptorRevision"] as? String == DeviceToolCatalog.revisions[2] else { try await fail("TOOL_REVISION_MISMATCH"); return }
        guard request["confirmationRequired"] as? Bool == false,
              let args = request["arguments"] as? [String: Any], let purpose = args["purpose"] as? String,
              let precision = args["precision"] as? String, ["weather", "nearby"].contains(purpose), ["approximate", "precise"].contains(precision),
              args.count == (purpose == "weather" ? 2 : 3), purpose == "weather" || ["restaurant", "cafe", "pharmacy", "park"].contains(args["category"] as? String ?? ""),
              let deadline = request["deadlineAt"] as? Double else { try await fail("INVALID_ARGUMENTS"); return }
        guard deadline > Double(Self.now()) else { try await fail("TOOL_TIMEOUT"); return }
        try await send("tool.received", ["invocationId": id])
        do {
            let reading = try await DeviceLocation.shared.acquire(precision: precision, deadline: deadline)
            try Task.checkCancellation()
            guard deadline > Double(Self.now()) else { try await fail("TOOL_TIMEOUT"); return }
            try await send("tool.result", ["invocationId": id, "content": [["type": "json", "value": JSONSerialization.jsonObject(with: reading)]]])
        } catch let error as DeviceLocation.LocationFailure { try await fail(error.code) }
        catch { try await fail(Task.isCancelled ? "TOOL_CANCELLED" : "PROTOCOL_ERROR") }
    }
}
