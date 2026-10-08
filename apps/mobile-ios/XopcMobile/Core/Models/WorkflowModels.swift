import Foundation

struct WorkflowRunPage: Decodable, Sendable {
    let runs: [WorkflowRunSummary]
}

struct WorkflowRunSummary: Decodable, Identifiable, Sendable {
    let id: String
    let title: String
    let status: String
    let goal: String?
    let result: WorkflowRunResult?
}

struct WorkflowRunResult: Decodable, Sendable {
    let summary: String
}

struct WorkflowRunStep: Decodable, Identifiable, Sendable {
    let id: String
    let title: String?
    let label: String?
    let status: String
    let resultPreview: String?
    let error: String?
}

struct WorkflowRunDetail: Decodable, Sendable {
    let run: WorkflowRunSummary
    let phases: [WorkflowRunStep]
    let agents: [WorkflowRunStep]
    let controls: WorkflowRunControls
}

struct WorkflowRunControls: Decodable, Sendable {
    let canCancel: Bool
}

struct WorkflowRunDetailEnvelope: Decodable, Sendable {
    let view: WorkflowRunDetail
}

struct WorkflowCancelResponse: Decodable, Sendable {
    let cancelled: Bool
    let alreadyFinished: Bool
}
