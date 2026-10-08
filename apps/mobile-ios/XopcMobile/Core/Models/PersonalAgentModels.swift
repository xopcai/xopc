import Foundation

struct PersonalAgentRecord: Decodable, Equatable, Sendable {
    let agentId: String
    let conversationId: String
    let state: String
    let displayName: String
    let appearance: String
    let revision: Int?
    let preferences: [String: String]?
    let voicePreference: PersonalVoicePreference?
    let errorMessage: String?

    var isReady: Bool {
        state == "ready"
    }
}

struct PersonalVoicePreference: Codable, Equatable, Sendable {
    let provider: String
    let model: String
    let voice: String
}

private struct PersonalProfileUpdate: Encodable {
    let revision: Int
    let displayName: String
    let appearance: String
    let preferences: [String: String]
    let voicePreference: PersonalVoicePreference?

    enum CodingKeys: String, CodingKey {
        case revision, displayName, appearance, preferences, voicePreference
    }

    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(revision, forKey: .revision)
        try container.encode(displayName, forKey: .displayName)
        try container.encode(appearance, forKey: .appearance)
        try container.encode(preferences, forKey: .preferences)
        if let voicePreference {
            try container.encode(voicePreference, forKey: .voicePreference)
        } else {
            try container.encodeNil(forKey: .voicePreference)
        }
    }
}

struct PersonalVoiceOption: Decodable, Identifiable, Sendable {
    let id: String
    let name: String
}

struct PersonalVoiceSelection: Sendable {
    let provider: String
    let model: String
    let voices: [PersonalVoiceOption]
}

private struct PersonalVoiceOptions: Decodable, Sendable {
    let voices: [PersonalVoiceOption]
}

extension GatewayClient {
    func fetchPersonalAgent() async throws -> PersonalAgentRecord? {
        let response: GatewayEnvelope<PersonalAgentRecord> = try await request(path: "/api/personal-agent")
        guard response.isSuccessful else {
            throw GatewayClientError.server(response.error?.message ?? "无法读取我的助手")
        }
        return response.payload
    }

    func createPersonalAgent() async throws -> PersonalAgentRecord {
        let response: GatewayEnvelope<PersonalAgentRecord> = try await request(
            path: "/api/personal-agent", method: "POST", body: Data("{}".utf8)
        )
        guard response.isSuccessful, let record = response.payload, record.isReady else {
            throw GatewayClientError.server(
                response.error?.message ?? response.payload?.errorMessage ?? "无法创建我的助手"
            )
        }
        return record
    }

    func updatePersonalAgentProfile(
        record: PersonalAgentRecord,
        displayName: String,
        appearance: String,
        preferences: [String: String],
        voicePreference: PersonalVoicePreference?
    ) async throws -> PersonalAgentRecord {
        guard let revision = record.revision else { throw GatewayClientError.invalidResponse }
        let body = try JSONEncoder().encode(PersonalProfileUpdate(
            revision: revision,
            displayName: displayName,
            appearance: appearance,
            preferences: preferences,
            voicePreference: voicePreference
        ))
        let response: GatewayEnvelope<PersonalAgentRecord> = try await request(
            path: "/api/personal-agent/profile", method: "PATCH", body: body
        )
        guard response.isSuccessful, let updated = response.payload else {
            throw GatewayClientError.server(response.error?.message ?? "无法保存助手设置")
        }
        return updated
    }

    func personalVoiceOptions() async throws -> PersonalVoiceSelection? {
        let status: PersonalVoiceStatusEnvelope = try await request(path: "/api/voice/realtime/status")
        guard let route = status.payload.tts else { return nil }
        let queryAllowed = CharacterSet.alphanumerics.union(CharacterSet(charactersIn: "-._~"))
        guard let provider = route.provider.addingPercentEncoding(withAllowedCharacters: queryAllowed),
              let model = route.model.addingPercentEncoding(withAllowedCharacters: queryAllowed)
        else { return nil }
        let response: GatewayEnvelope<PersonalVoiceOptions> = try await request(
            path: "/api/voice/tts-voices?provider=\(provider)&model=\(model)&purpose=realtime"
        )
        guard response.isSuccessful else {
            throw GatewayClientError.server(response.error?.message ?? "无法获取声音列表")
        }
        return PersonalVoiceSelection(
            provider: route.provider,
            model: route.model,
            voices: response.payload?.voices ?? []
        )
    }
}

private struct PersonalVoiceStatusEnvelope: Decodable, Sendable {
    let payload: PersonalVoiceStatus
}

private struct PersonalVoiceStatus: Decodable, Sendable {
    let tts: Route?
    struct Route: Decodable, Sendable {
        let provider: String
        let model: String
    }
}
