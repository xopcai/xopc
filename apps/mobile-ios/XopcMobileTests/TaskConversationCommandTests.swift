import Foundation
import Testing
@testable import XopcMobile

struct TaskConversationCommandTests {
    @Test func signoffEncodesExactResultAndRequiresIt() throws {
        let command = try TaskCommandMutation.Command.make(type: "signoff", phase: nil,
                                                            resolution: "done", agentID: nil, resultID: "run:3")
        let body = try JSONEncoder().encode(command)
        let json = try #require(JSONSerialization.jsonObject(with: body) as? [String: String])
        #expect(json == ["type": "signoff", "resultId": "run:3"])
        #expect(throws: GatewayClientError.self) {
            try TaskCommandMutation.Command.make(type: "signoff", phase: nil, resolution: "done", agentID: nil)
        }
    }

    @Test func rejectsCommandsThatBreakTaskConversationContinuity() {
        for command in ["/new", "/reset now", "/RESTART@main", "/clear", "/archive reason"] {
            #expect(GatewayClient.isTaskDestructiveCommand(command))
        }
        for text in ["/news", "/skill:new", "Discuss /reset later", "normal message"] {
            #expect(!GatewayClient.isTaskDestructiveCommand(text))
        }
    }
}
