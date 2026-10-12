import Foundation

extension GatewayClient {
    func updateTask(_ task: TaskRecord, mutation: TaskUpdateMutation) async throws -> TaskRecord {
        guard mutation.expectedVersion == task.version else { throw GatewayClientError.invalidResponse }
        let payload = try encoder.encode(mutation)
        let result: TaskUpdateEnvelope = try await request(
            path: "/api/tasks/\(task.id)", method: "PATCH", body: payload
        )
        guard result.ok, result.task.id == task.id, result.task.version > task.version else { throw GatewayClientError.server("任务更新未完成") }
        return result.task
    }
}

struct TaskUpdateMutation: Encodable {
    let expectedVersion: Int
    let title: String
    let body: String
    let priority: String
    var projectId: String?
    var dueAt: Int64?

    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(expectedVersion, forKey: .expectedVersion)
        try container.encode(title, forKey: .title)
        try container.encode(body, forKey: .body)
        try container.encode(priority, forKey: .priority)
        try container.encode(projectId, forKey: .projectId)
        try container.encode(dueAt, forKey: .dueAt)
    }

    private enum CodingKeys: String, CodingKey {
        case expectedVersion, title, body, priority, projectId, dueAt
    }
}

private struct TaskUpdateEnvelope: Decodable {
    let ok: Bool
    let task: TaskRecord
}
