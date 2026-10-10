import Foundation

private struct VoiceTranscription: Decodable {
    let text: String
}

private struct RealtimeVoiceCancellation: Encodable {
    let sessionId: String
    let ticket: String
}

private struct RealtimeVoiceAcknowledgement: Decodable {
    let ok: Bool
    let timingMetrics: [String]?
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
    func materializeVoiceConversation(_ conversation: ConversationSelection, commandID: String) async throws -> ConversationSelection {
        guard conversation.isDraft else { return conversation }
        let catalog = try await fetchModels(agentID: conversation.agentId)
        guard let model = conversation.model ?? catalog.defaultId ?? catalog.models.first?.id else {
            throw GatewayClientError.server("当前助手没有可用模型")
        }
        let thinking = conversation.thinkingLevel
            ?? catalog.models.first(where: { $0.id == model })?.thinking?.initialValue
            ?? "off"
        let command = MaterializeVoiceCommand(
            commandId: commandID,
            creation: .init(
                agentId: conversation.agentId,
                projectId: conversation.projectId,
                execution: conversation.executionMode.map { ExecutionCommand(mode: $0, baseRef: nil) },
                temporary: false, model: model, thinkingLevel: thinking
            )
        )
        let envelope: GatewayEnvelope<SessionCommandResult> = try await request(
            path: "/api/sessions/\(conversation.id)/materialize",
            method: "POST", body: encoder.encode(command)
        )
        guard envelope.isSuccessful, let result = envelope.payload,
              result.receipt.conversationId == conversation.id,
              result.receipt.lifecycle == "ready"
        else {
            throw GatewayClientError.server(envelope.error?.message ?? "语音会话尚未准备好，请重试")
        }
        return conversation.materialized(transcriptId: result.receipt.transcriptId)
    }

    func transcribeVoice(_ audio: RecordedAudio, language: String?) async throws -> String {
        let boundary = "xopc-\(UUID().uuidString)"
        var body = Data()
        body.append(Data("--\(boundary)\r\nContent-Disposition: form-data; name=\"audio\"; filename=\"recording.wav\"\r\nContent-Type: \(audio.mimeType)\r\n\r\n".utf8))
        body.append(audio.data)
        body.append(Data("\r\n".utf8))
        if let language, !language.isEmpty {
            body.append(Data("--\(boundary)\r\nContent-Disposition: form-data; name=\"language\"\r\n\r\n\(language)\r\n".utf8))
        }
        body.append(Data("--\(boundary)--\r\n".utf8))

        var request = try URLRequest(url: makeURL(path: "/api/voice/transcriptions", queryItems: []))
        request.httpMethod = "POST"
        request.httpBody = body
        request.setValue("multipart/form-data; boundary=\(boundary)", forHTTPHeaderField: "Content-Type")
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        if !configuration.token.isEmpty {
            request.setValue("Bearer \(configuration.token)", forHTTPHeaderField: "Authorization")
        }
        let data: Data
        let response: URLResponse
        do {
            (data, response) = try await session.data(for: request)
        } catch is CancellationError {
            throw CancellationError()
        } catch {
            throw GatewayClientError.transport
        }
        guard let httpResponse = response as? HTTPURLResponse else {
            throw GatewayClientError.invalidResponse
        }
        let envelope = try decoder.decode(GatewayEnvelope<VoiceTranscription>.self, from: data)
        guard (200 ..< 300).contains(httpResponse.statusCode) else {
            throw GatewayClientError.http(statusCode: httpResponse.statusCode, message: envelope.error?.message)
        }
        guard envelope.isSuccessful, let text = envelope.payload?.text.trimmingCharacters(in: .whitespacesAndNewlines),
              !text.isEmpty
        else {
            throw GatewayClientError.server(envelope.error?.message ?? "没有识别出文字，请重试或发送语音")
        }
        return text
    }

    func fetchRealtimeVoiceStatus() async throws -> RealtimeVoiceStatus {
        let result: VoicePayload<RealtimeVoiceStatus> = try await request(path: "/api/voice/realtime/status")
        return result.payload
    }

    func preflightRealtimeVoice(conversationID: String, mode: RealtimeVoiceMode) async throws -> [String] {
        let body = try encoder.encode(RealtimeVoiceSessionRequest(conversationId: conversationID, mode: mode))
        let result: RealtimeVoiceAcknowledgement = try await request(
            path: "/api/voice/realtime/preflight", method: "POST", body: body
        )
        guard result.ok else { throw GatewayClientError.invalidResponse }
        return result.timingMetrics ?? []
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
