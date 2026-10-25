import Foundation
import UIKit

struct PhoneBinding: Decodable, Equatable, Sendable {
    let conversationId: String
    let transcriptId: String
    let phoneSessionId: String
}

struct PhoneSummary: Decodable, Equatable, Sendable {
    let available: Bool
    let access: String
    let needsUser: Bool
    let binding: PhoneBinding?
    let deviceName: String?
}

struct PhoneReport: Decodable, Equatable, Sendable {
    let sessionId: String
    let controlEpoch: Int
    let mode: String
    let status: String
    let controlOwner: String?
    let assistanceId: String?
    let reconnectRequired: Bool?
}

struct PhoneLiveState: Decodable, Equatable, Sendable {
    let report: PhoneReport
    let ownControl: Bool
    let textInput: String?
}

struct PhoneAction: Encodable, Sendable {
    let type: String
    var point: [Int]?
    var start: [Int]?
    var end: [Int]?
    var durationMs: Int?
    var text: String?
}

struct PhoneTicket: Decodable, Sendable { let ticket: String; let path: String }
struct PhoneEnvelope<Value: Decodable>: Decodable { let ok: Bool; let payload: Value }
struct PhoneCompatibility: Decodable { let mobilePhoneWorkspaceV1: Bool? }
struct PhoneControlRequest: Encodable {
    let clientId: String
    let operationId: String
    let epoch: Int
    let expectedTranscriptId: String
    // The wire format uses the short "op" field.
    // swiftlint:disable:next identifier_name
    let op: String
    let assistanceId: String?
    let action: PhoneAction?
    let geometry: Int?
    let frameSeq: Int?
}

struct PhoneTicketRequest: Encodable {
    let clientId: String
    let purpose: String
    let expectedTranscriptId: String
    let epoch: Int?
}

struct PhoneFrame { let image: UIImage; let seq: Int; let capturedAt: Double }
struct PhoneRepository: Sendable {
    let client: GatewayClient
    let clientID = UUID().uuidString.lowercased()
    let viewerID = UUID().uuidString.lowercased()
    func base(_ id: String) -> String {
        "/api/phone/conversations/\(id)"
    }

    func supported() async throws -> Bool {
        let result: PhoneEnvelope<PhoneCompatibility> = try await client.request(path: "/api/endpoint-tools/compatibility")
        return result.ok && result.payload.mobilePhoneWorkspaceV1 == true
    }

    func summary(_ id: String) async throws -> PhoneSummary {
        let result: PhoneEnvelope<PhoneSummary> = try await client.request(path: base(id) + "/summary")
        guard result.ok else { throw GatewayClientError.invalidResponse }
        return result.payload
    }

    func state(_ id: String) async throws -> PhoneLiveState? {
        let result: PhoneEnvelope<PhoneLiveState?> = try await client.request(path: base(id), queryItems: [URLQueryItem(name: "clientId", value: clientID)])
        guard result.ok else { throw GatewayClientError.invalidResponse }
        return result.payload
    }

    func command(_ binding: PhoneBinding, state: PhoneLiveState, op operation: String, action: PhoneAction? = nil,
                 geometry: Int? = nil, frameSeq: Int? = nil) async throws -> PhoneLiveState
    {
        let body = PhoneControlRequest(clientId: clientID, operationId: UUID().uuidString.lowercased(), epoch: state.report.controlEpoch,
                                       expectedTranscriptId: binding.transcriptId, op: operation, assistanceId: state.report.assistanceId,
                                       action: action, geometry: geometry, frameSeq: frameSeq)
        let result: PhoneEnvelope<PhoneLiveState> = try await client.request(path: base(binding.conversationId) + "/\(state.report.sessionId)/control",
                                                                             method: "POST", body: client.encoder.encode(body))
        guard result.ok else { throw GatewayClientError.invalidResponse }
        return result.payload
    }

    func ticket(_ binding: PhoneBinding, state: PhoneLiveState) async throws -> PhoneTicket {
        let body = PhoneTicketRequest(clientId: state.ownControl ? clientID : viewerID, purpose: state.ownControl ? "control" : "view",
                                      expectedTranscriptId: binding.transcriptId, epoch: state.ownControl ? state.report.controlEpoch : nil)
        let result: PhoneEnvelope<PhoneTicket> = try await client.request(path: base(binding.conversationId) + "/\(state.report.sessionId)/video-ticket",
                                                                          method: "POST", body: client.encoder.encode(body))
        guard result.ok else { throw GatewayClientError.invalidResponse }
        return result.payload
    }

    @MainActor func frame(_ binding: PhoneBinding) async throws -> PhoneFrame {
        let url = try client.makeURL(path: base(binding.conversationId) + "/\(binding.phoneSessionId)/frame",
                                     queryItems: [URLQueryItem(name: "expectedTranscriptId", value: binding.transcriptId)])
        var request = URLRequest(url: url, cachePolicy: .reloadIgnoringLocalCacheData, timeoutInterval: 10)
        request.setValue("Bearer \(client.configuration.token)", forHTTPHeaderField: "Authorization")
        let (data, response) = try await client.session.data(for: GatewayPairingService.shared.signedRequest(request))
        guard let http = response as? HTTPURLResponse, http.statusCode == 200, data.count <= 8 * 1024 * 1024,
              let image = UIImage(data: data), let seq = Int(http.value(forHTTPHeaderField: "X-Phone-Frame-Seq") ?? ""),
              let captured = Double(http.value(forHTTPHeaderField: "X-Phone-Captured-At") ?? "") else { throw GatewayClientError.invalidResponse }
        return PhoneFrame(image: image, seq: seq, capturedAt: captured)
    }
}
