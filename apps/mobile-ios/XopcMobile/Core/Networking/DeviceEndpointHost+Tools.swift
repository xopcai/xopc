import Foundation
import UIKit

extension DeviceEndpointHost {
    func invoke(_ requestData: Data) async throws {
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
                    self.cancelInvocation(id)
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

    static func json(_ value: [String: Any]) throws -> Data {
        try JSONSerialization.data(withJSONObject: value, options: [.sortedKeys, .withoutEscapingSlashes])
    }

    static func now() -> Int64 {
        Int64(Date().timeIntervalSince1970 * 1000)
    }
}
