import Foundation
import Testing
@testable import XopcMobile

struct ClarificationV2Tests {
    @Test func decodesSharedMultiQuestionFixtureAndEncodesBatch() throws {
        let root = URL(fileURLWithPath: #filePath).deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent()
        let fixture = try Data(contentsOf: root.appendingPathComponent("packages/gateway-contract/fixtures/clarification-v2.json"))
        var payload = try #require(JSONSerialization.jsonObject(with: fixture) as? [String: Any])
        payload.merge(["id": "batch-1", "conversationId": "conversation-1", "kind": "input", "status": "open", "question": "Three questions", "version": 4]) { _, new in new }
        let prompt = try JSONDecoder().decode(ClarificationRequest.self, from: JSONSerialization.data(withJSONObject: payload))
        #expect(prompt.schemaVersion == 2)
        #expect(prompt.validQuestions)
        #expect(prompt.questions?.map(\.id) == ["channel", "frequency", "direction"])
        #expect(prompt.questions?.first?.recommendedChoiceId == "blog")
        #expect(prompt.choiceDetails == nil)
        let answers = [ClarificationAnswer(questionId: "channel", choiceId: "blog"),
                       ClarificationAnswer(questionId: "frequency", choiceId: "weekly"),
                       ClarificationAnswer(questionId: "direction", text: "Engineering notes\n中文")]
        #expect(prompt.accepts(answers))
        #expect(!prompt.accepts(Array(answers.prefix(2))))
        #expect(!prompt.accepts([answers[0], answers[0], answers[2]]))
        var long = prompt
        long.questions = prompt.questions?.map { ClarificationQuestion(id: $0.id, header: $0.header, question: String(repeating: "x", count: 1000),
                                                                       type: $0.type, choices: $0.choices, recommendedChoiceId: $0.recommendedChoiceId) }
        #expect(!long.accepts((long.questions ?? []).map { ClarificationAnswer(questionId: $0.id, text: String(repeating: "y", count: 2000)) }))
        var command = ClarificationResponseCommand(action: "answer", response: nil, decision: nil, expectedVersion: 4, idempotencyKey: "attempt")
        command.schemaVersion = 2; command.answers = answers
        let data = try JSONEncoder().encode(command)
        let json = try #require(JSONSerialization.jsonObject(with: data) as? [String: Any])
        #expect(json["schemaVersion"] as? Int == 2)
        #expect((json["answers"] as? [[String: Any]])?.count == 3)
        #expect(json["response"] == nil)
        #expect(try JSONDecoder().decode(ClarificationResponseCommand.self, from: data) == command)
    }

    @MainActor @Test func persistsFrozenClarificationAttemptAcrossReadersAndIsolatesVersions() throws {
        var prompt = ClarificationRequest(id: UUID().uuidString, conversationId: "conversation", kind: "input", status: "open",
                                          question: "Question", choiceDetails: nil, interactionMode: nil, recommendedChoiceId: nil, approval: nil,
                                          version: 3, expiresAt: nil)
        prompt.scope = UUID().uuidString
        let store = ClarificationMemoryTokenStore()
        defer { try? ClarificationPersistence.clear(prompt, store: store) }
        var command = ClarificationResponseCommand(action: "answer", response: nil, decision: nil, expectedVersion: 3, idempotencyKey: UUID().uuidString)
        command.schemaVersion = 2
        command.answers = [.init(questionId: "direction", text: "Engineering notes")]
        try ClarificationPersistence.write(prompt, "attempt", command, store: store)
        let restored: ClarificationResponseCommand? = ClarificationPersistence.read(prompt, "attempt", as: ClarificationResponseCommand.self, store: store)
        #expect(restored == command)
        var next = prompt; next.scope = UUID().uuidString
        #expect(ClarificationPersistence.read(next, "attempt", as: ClarificationResponseCommand.self, store: store) == nil)
        #expect(ClarificationPersistence.key(prompt, "attempt") != ClarificationPersistence.key(prompt, "draft"))
    }
}

@MainActor
private final class ClarificationMemoryTokenStore: GatewayTokenStoring {
    private var records: [String: String] = [:]
    func load(account: String) -> String? {
        records[account]
    }

    func save(_ token: String, account: String) {
        records[account] = token.isEmpty ? nil : token
    }
}
