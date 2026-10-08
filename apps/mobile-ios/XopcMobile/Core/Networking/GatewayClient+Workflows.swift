import Foundation

extension GatewayClient {
    func fetchWorkflowRuns() async throws -> [WorkflowRunSummary] {
        let response: WorkflowRunPage = try await request(
            path: "/api/workflows/runs", queryItems: [URLQueryItem(name: "limit", value: "50")]
        )
        return response.runs
    }

    func fetchWorkflowRun(id: String) async throws -> WorkflowRunDetail {
        let response: WorkflowRunDetailEnvelope = try await request(path: "/api/workflows/runs/\(id)")
        return response.view
    }

    func cancelWorkflowRun(id: String) async throws {
        let body = try encoder.encode(EmptyCommand())
        let response: WorkflowCancelResponse = try await request(
            path: "/api/workflows/runs/\(id)/cancel", method: "POST", body: body
        )
        guard response.cancelled || response.alreadyFinished else {
            throw GatewayClientError.server("未能取消工作流")
        }
    }
}
