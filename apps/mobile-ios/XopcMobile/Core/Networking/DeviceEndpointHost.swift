import CryptoKit
import Foundation
import Security
import UIKit

struct DeviceEndpointOrigin: Encodable, Sendable {
    let type = "endpoint"
    let endpointId: String
    let token: String
}

private struct DeviceCompatibility: Decodable {
    let deviceId: String?
    let turnDeviceContextV1: Bool?
    let deviceLocationTasksV1: Bool?
    let deviceStateToolsV1: Bool?
}

actor DeviceEndpointPool {
    static let shared = DeviceEndpointPool()
    private var hosts: [GatewayConfiguration: DeviceEndpointHost] = [:]

    func origin(for client: GatewayClient) async throws -> DeviceEndpointOrigin {
        let configuration = client.configuration
        if let host = hosts[configuration] {
            return try await host.origin()
        }
        for (key, host) in hosts where key.baseURL == configuration.baseURL {
            await host.stop()
            hosts.removeValue(forKey: key)
        }
        if hosts.count >= 8, let key = hosts.keys.first {
            await hosts.removeValue(forKey: key)?.stop()
        }
        let host = DeviceEndpointHost(client: client)
        hosts[configuration] = host
        return try await host.origin()
    }

    func environment(for client: GatewayClient) async -> DeviceTurnEnvironment? {
        guard let host = hosts[client.configuration], await host.supportsContext() else { return nil }
        return DeviceTurnEnvironment(capturedAt: Int64(Date().timeIntervalSince1970 * 1000),
                                     timezone: TimeZone.current.identifier, locale: Locale.current.identifier.replacingOccurrences(of: "_", with: "-"))
    }
}

actor DeviceEndpointHost {
    private let client: GatewayClient
    private var socket: URLSessionWebSocketTask?
    private var claim: DeviceEndpointOrigin?
    private var contextSupported = false
    func supportsContext() -> Bool {
        contextSupported
    }

    private var connection: Task<DeviceEndpointOrigin, Error>?
    private var invocations: [String: Task<Void, Never>] = [:]
    private var reader: Task<Void, Never>?
    private var heartbeat: Task<Void, Never>?
    private let instance = UUID().uuidString.lowercased()

    init(client: GatewayClient) {
        self.client = client
    }

    func origin() async throws -> DeviceEndpointOrigin {
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
        claim = nil
        for task in invocations.values {
            task.cancel()
        }; invocations.removeAll()
        reader?.cancel(); heartbeat?.cancel()
        socket?.cancel(with: .normalClosure, reason: nil)
        socket = nil
    }

    private func connect() async throws -> DeviceEndpointOrigin {
        let compatibility: GatewayEnvelope<DeviceCompatibility> = try await client.request(path: "/api/endpoint-tools/compatibility")
        contextSupported = compatibility.payload?.turnDeviceContextV1 == true
        let key = try Self.signingKey()
        let fallback = "ios-" + SHA256.hash(data: key.publicKey.derRepresentation).prefix(16).map { String(format: "%02x", $0) }.joined()
        let principalId = compatibility.payload?.deviceId ?? fallback
        let endpointId = "ios:\(principalId):\(instance)"
        let registration: [String: Any] = ["principalId": principalId, "kind": "mobile", "platform": "ios",
                                           "displayName": "xopc iOS", "publicKey": key.publicKey.derRepresentation.base64URL()]
        let registered: GatewayEnvelope<IgnoredResponse> = try await client.request(path: "/api/endpoint-tools/principals",
                                                                                    method: "POST", body: Self.json(registration))
        guard registered.isSuccessful else { throw GatewayClientError.server("无法注册设备能力") }
        let ticket: GatewayEnvelope<RealtimeTicket> = try await client.request(path: "/api/realtime/tickets", method: "POST",
                                                                               body: client.encoder.encode(RealtimeTicketCommand(clientId: endpointId, clientKind: "mobile", protocolVersion: 2)))
        guard let ticket = ticket.payload, ticket.realtime.minVersion <= 2, ticket.realtime.maxVersion >= 2 else {
            throw GatewayClientError.invalidResponse
        }
        let catalogJson: String = if compatibility.payload?.deviceStateToolsV1 != true {
            "[]"
        } else if compatibility.payload?.deviceLocationTasksV1 == true {
            DeviceToolCatalog.json
        } else {
            DeviceToolCatalog.stateJson
        }
        let tools = try JSONSerialization.jsonObject(with: Data(catalogJson.utf8))
        var endpoint: [String: Any] = ["principalId": principalId, "endpointId": endpointId, "connectionInstanceId": UUID().uuidString.lowercased(),
                                       "displayName": "xopc iOS", "kind": "mobile", "platform": "ios", "appVersion": "1", "availability": "foreground",
                                       "nonce": UUID().uuidString.lowercased(), "signedAt": Self.now(), "tools": tools]
        endpoint["signature"] = try key.signature(for: Self.json(endpoint)).rawRepresentation.base64URL()
        let url = try websocketURL()
        let socket = client.session.webSocketTask(with: url)
        self.socket = socket; socket.resume()
        do {
            try await send("realtime.hello", ["ticket": ticket.ticket, "clientId": endpointId, "clientKind": "mobile", "subscriptions": [], "endpoint": endpoint])
            let timeout = Task {
                try? await Task.sleep(for: .seconds(10))
                if !Task.isCancelled {
                    socket.cancel(with: .goingAway, reason: nil)
                }
            }
            defer { timeout.cancel() }
            let ready = try await receive(socket)
            guard ready["kind"] as? String == "realtime.ready", let payload = ready["payload"] as? [String: Any],
                  let endpoint = payload["endpoint"] as? [String: Any], endpoint["endpointId"] as? String == endpointId,
                  let token = endpoint["turnToken"] as? String, token.count >= 32 else { throw GatewayClientError.invalidResponse }
            let claim = DeviceEndpointOrigin(endpointId: endpointId, token: token)
            self.claim = claim
            startLoops(socket)
            return claim
        } catch { stop(); throw error }
    }

    private func startLoops(_ socket: URLSessionWebSocketTask) {
        reader = Task { await readLoop(socket) }
        heartbeat = Task {
            while !Task.isCancelled {
                do { try await Task.sleep(for: .seconds(15)); try Task.checkCancellation(); try await send("realtime.ping", [:]) }
                catch { break }
            }
        }
    }

    private func websocketURL() throws -> URL {
        guard var components = URLComponents(url: client.configuration.baseURL, resolvingAgainstBaseURL: false) else {
            throw GatewayClientError.invalidURL
        }
        components.scheme = components.scheme == "https" ? "wss" : "ws"
        components.path = "/api/realtime/v1/ws"
        components.query = nil
        components.fragment = nil
        guard let url = components.url else { throw GatewayClientError.invalidURL }
        return url
    }

    private func readLoop(_ socket: URLSessionWebSocketTask) async {
        do {
            while !Task.isCancelled {
                let frame = try await receive(socket)
                if frame["kind"] as? String == "endpoint.message", let inner = frame["payload"] as? [String: Any],
                   let request = inner["payload"] as? [String: Any], let id = request["invocationId"] as? String
                {
                    if inner["type"] as? String == "tool.invoke" {
                        guard invocations[id] == nil else { continue }
                        let requestData = try Self.json(request)
                        invocations[id] = Task { [weak self] in
                            guard let self else { return }
                            do { try await invoke(requestData) } catch {}
                            await completedInvocation(id)
                        }
                    } else if inner["type"] as? String == "tool.cancel" {
                        invocations.removeValue(forKey: id)?.cancel()
                    }
                } else if frame["kind"] as? String == "realtime.error" {
                    break
                }
            }
        } catch { /* The next input reconnects and obtains a fresh claim. */ }
        if self.socket === socket {
            stop()
        }
    }

    private func completedInvocation(_ id: String) {
        invocations.removeValue(forKey: id)
    }

    private func invoke(_ requestData: Data) async throws {
        guard let request = try JSONSerialization.jsonObject(with: requestData) as? [String: Any] else { throw GatewayClientError.invalidResponse }
        guard let id = request["invocationId"] as? String else { throw GatewayClientError.invalidResponse }
        func fail(_ code: String) async throws {
            try await send("tool.error", ["invocationId": id, "code": code, "message": "Device reading unavailable: \(code)"])
        }
        if request["toolName"] as? String == "mobile.device.get_location" {
            try await invokeLocation(request, id: id)
            return
        }
        let index: Int
        switch request["toolName"] as? String {
        case "mobile.device.get_state": index = 0
        case "mobile.device.get_power": index = 1
        default: try await fail("TOOL_NOT_FOUND"); return
        }
        guard request["descriptorRevision"] as? String == DeviceToolCatalog.revisions[index] else {
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

    private func invokeLocation(_ request: [String: Any], id: String) async throws {
        func fail(_ code: String) async throws {
            try await send("tool.error", ["invocationId": id, "code": code, "message": "Device reading unavailable: \(code)"])
        }
        guard request["descriptorRevision"] as? String == DeviceToolCatalog.revisions[2] else { try await fail("TOOL_REVISION_MISMATCH"); return }
        guard request["confirmationRequired"] as? Bool == true,
              let args = request["arguments"] as? [String: Any], let purpose = args["purpose"] as? String,
              let precision = args["precision"] as? String, ["weather", "nearby"].contains(purpose), ["approximate", "precise"].contains(precision),
              args.count == (purpose == "weather" ? 2 : 3), purpose == "weather" || ["restaurant", "cafe", "pharmacy", "park"].contains(args["category"] as? String ?? ""),
              let deadline = request["deadlineAt"] as? Double else { try await fail("INVALID_ARGUMENTS"); return }
        guard deadline > Double(Self.now()) else { try await fail("TOOL_TIMEOUT"); return }
        try await send("tool.received", ["invocationId": id])
        do {
            let reading = try await DeviceLocation.shared.acquire(purpose: purpose, precision: precision, deadline: deadline)
            try Task.checkCancellation()
            guard deadline > Double(Self.now()) else { try await fail("TOOL_TIMEOUT"); return }
            try await send("tool.result", ["invocationId": id, "content": [["type": "json", "value": JSONSerialization.jsonObject(with: reading)]]])
        } catch let error as DeviceLocation.LocationFailure { try await fail(error.code) }
        catch { try await fail(Task.isCancelled ? "TOOL_CANCELLED" : "PROTOCOL_ERROR") }
    }

    private func send(_ kind: String, _ payload: [String: Any]) async throws {
        if kind.hasPrefix("tool.") {
            try await send("endpoint.message", ["protocolVersion": 2, "messageId": UUID().uuidString, "type": kind, "sentAt": Self.now(), "payload": payload]); return
        }

        guard let socket else { throw GatewayClientError.transport }
        try await socket.send(.data(Self.json(["protocolVersion": 2, "messageId": UUID().uuidString.lowercased(),
                                               "sentAt": Self.now(), "kind": kind, "payload": payload])))
    }

    private func receive(_ socket: URLSessionWebSocketTask) async throws -> [String: Any] {
        let data: Data
        switch try await socket.receive() {
        case let .data(bytes): data = bytes
        case let .string(text): data = Data(text.utf8)
        @unknown default: throw GatewayClientError.invalidResponse
        }
        guard data.count <= 256 * 1024, let frame = try JSONSerialization.jsonObject(with: data) as? [String: Any],
              frame["protocolVersion"] as? Int == 2 else { throw GatewayClientError.invalidResponse }
        return frame
    }

    private static func json(_ value: [String: Any]) throws -> Data {
        try JSONSerialization.data(withJSONObject: value, options: [.sortedKeys, .withoutEscapingSlashes])
    }

    private static func now() -> Int64 {
        Int64(Date().timeIntervalSince1970 * 1000)
    }

    private static func signingKey() throws -> P256.Signing.PrivateKey {
        let query: [String: Any] = [kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: "ai.xopc.device-tools",
                                    kSecAttrAccount as String: "endpoint-p256", kSecReturnData as String: true]
        var result: CFTypeRef?
        let status = SecItemCopyMatching(query as CFDictionary, &result)
        if status == errSecSuccess, let data = result as? Data {
            return try P256.Signing.PrivateKey(rawRepresentation: data)
        }
        guard status == errSecItemNotFound else { throw GatewayClientError.server("无法读取设备身份") }
        let key = P256.Signing.PrivateKey()
        var item = query; item.removeValue(forKey: kSecReturnData as String)
        item[kSecValueData as String] = key.rawRepresentation
        item[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
        guard SecItemAdd(item as CFDictionary, nil) == errSecSuccess else { throw GatewayClientError.server("无法保存设备身份") }
        return key
    }
}

private extension Data {
    func base64URL() -> String {
        base64EncodedString().replacingOccurrences(of: "+", with: "-")
            .replacingOccurrences(of: "/", with: "_").replacingOccurrences(of: "=", with: "")
    }
}
