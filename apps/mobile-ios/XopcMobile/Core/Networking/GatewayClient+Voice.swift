import Foundation

private struct RealtimeVoiceCancellation: Encodable {
    let sessionId: String
    let ticket: String
}

private struct RealtimeVoiceAcknowledgement: Decodable {
    let ok: Bool
}

private struct RealtimeVoiceClarificationResponse: Encodable {
    let action: String
    let answer: String?
    let expectedVersion: Int
    let idempotencyKey: String
}

private struct RealtimeVoiceApprovalDecision: Encodable {
    let id: String
    let decision: String
    let conversationId: String
}

extension GatewayClient {
    func fetchRealtimeVoiceStatus() async throws -> RealtimeVoiceStatus {
        let result: VoicePayload<RealtimeVoiceStatus> = try await request(path: "/api/voice/realtime/status")
        return result.payload
    }

    func preflightRealtimeVoice(conversationID: String, mode: RealtimeVoiceMode) async throws {
        let body = try encoder.encode(RealtimeVoiceSessionRequest(conversationId: conversationID, mode: mode))
        let result: RealtimeVoiceAcknowledgement = try await request(
            path: "/api/voice/realtime/preflight", method: "POST", body: body
        )
        guard result.ok else { throw GatewayClientError.invalidResponse }
    }

    func createRealtimeVoiceSession(conversationID: String, mode: RealtimeVoiceMode) async throws -> RealtimeVoiceSession {
        let body = try encoder.encode(RealtimeVoiceSessionRequest(conversationId: conversationID, mode: mode))
        let result: VoicePayload<RealtimeVoiceSession> = try await request(
            path: "/api/voice/realtime/sessions", method: "POST", body: body
        )
        guard result.payload.supportsNativePCM else { throw GatewayClientError.invalidResponse }
        return result.payload
    }

    func cancelRealtimeVoiceSession(_ session: RealtimeVoiceSession) async throws {
        let body = try encoder.encode(RealtimeVoiceCancellation(sessionId: session.sessionId, ticket: session.ticket))
        let result: RealtimeVoiceAcknowledgement = try await request(
            path: "/api/voice/realtime/sessions/cancel", method: "POST", body: body
        )
        guard result.ok else { throw GatewayClientError.invalidResponse }
    }

    func respondToRealtimeVoiceClarification(id: String, version: Int, action: String, answer: String?) async throws {
        let body = try encoder.encode(RealtimeVoiceClarificationResponse(
            action: action, answer: answer, expectedVersion: version,
            idempotencyKey: UUID().uuidString.lowercased()
        ))
        let result: RealtimeVoiceAcknowledgement = try await request(
            path: "/api/clarifications/\(id)/responses", method: "POST", body: body
        )
        guard result.ok else { throw GatewayClientError.invalidResponse }
    }

    func fetchRealtimeVoiceApprovals(conversationID: String) async throws -> [RealtimeVoiceApproval] {
        let result: VoicePayload<RealtimeVoiceApprovals> = try await request(
            path: "/api/connectors/approvals",
            queryItems: [
                URLQueryItem(name: "status", value: "pending"),
                URLQueryItem(name: "conversationId", value: conversationID)
            ]
        )
        return result.payload.approvals.filter { $0.conversationId == conversationID && $0.status == "pending" && $0.isUnexpired }
    }

    func respondToRealtimeVoiceApproval(_ approval: RealtimeVoiceApproval, approved: Bool) async throws {
        let body = try encoder.encode(RealtimeVoiceApprovalDecision(
            id: approval.id, decision: approved ? "approved" : "denied", conversationId: approval.conversationId
        ))
        let result: RealtimeVoiceAcknowledgement = try await request(
            path: "/api/connectors/approvals/respond", method: "POST", body: body
        )
        guard result.ok else { throw GatewayClientError.invalidResponse }
    }
}
