import Foundation

struct ProjectTaskMutation: Encodable {
    let idempotencyKey: String
    let title: String
    let projectId: String
    let contract: Contract
    let dependencies: [String] = []
    let context: [String] = []
    let authorityGrants: [String] = []
    let activation: Activation

    struct Contract: Encodable {
        let objective: String
        let expectedOutputs: [String] = []
        let acceptanceCriteria: [String] = []
        let constraints: [String] = []
        let approvalRequired: [String] = []
        let assumptions: [String] = []
        let risks: [String] = []
        let acceptancePolicy = "manual"
        let outputDestinations: [String] = []
    }

    struct Activation: Encodable {
        let mode: String
        let phase: String
    }
}

struct ProjectTaskCreationEnvelope: Decodable {
    let ok: Bool
}
