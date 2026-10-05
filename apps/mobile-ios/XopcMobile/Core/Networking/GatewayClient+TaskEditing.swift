import Foundation

extension GatewayClient {
    func updateTask(_ task: TaskRecord, title: String, body: String, priority: String) async throws -> TaskRecord {
        let mutation = TaskUpdateMutation(expectedVersion: task.version, title: title, body: body, priority: priority)
        let payload = try encoder.encode(mutation)
        let result: TaskUpdateEnvelope = try await request(
            path: "/api/tasks/\(task.id)", method: "PATCH", body: payload
        )
        guard result.ok else { throw GatewayClientError.server("任务更新未完成") }
        return result.task
    }
}

struct TaskUpdateMutation: Encodable {
    let expectedVersion: Int
    let title: String
    let body: String
    let priority: String
}

private struct TaskUpdateEnvelope: Decodable {
    let ok: Bool
    let task: TaskRecord
}
