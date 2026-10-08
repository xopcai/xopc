import Foundation

struct PersonalAgentRecord: Decodable, Equatable, Sendable {
    let agentId: String
    let conversationId: String
    let state: String
    let displayName: String
    let appearance: String
    let errorMessage: String?

    var isReady: Bool { state == "ready" }
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
}
