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

    @Test func localEndpointCapabilitiesAreNotSentAsPartOfTheClaim() throws {
        let claim = DeviceEndpointOrigin(endpointId: "phone", token: "test-token",
                                         supportsDeviceContext: true, supportsMultiQuestion: true)
        let body = try JSONEncoder().encode(claim)
        let json = try #require(JSONSerialization.jsonObject(with: body) as? [String: String])
        #expect(json == ["type": "endpoint", "endpointId": "phone", "token": "test-token"])
        #expect(claim.environment != nil)
    }

    @Test func agentConfigDecodesWithAndWithoutTranscriptIdentity() throws {
        let older = Data(#"{"model":"test/model","configVersion":17}"#.utf8)
        let current = Data(#"{"model":"test/model","configVersion":17,"transcriptId":"current"}"#.utf8)
        let decoder = JSONDecoder()
        let legacy = try decoder.decode(SessionAgentConfiguration.self, from: older)
        let snapshot = try decoder.decode(SessionAgentConfiguration.self, from: current)
        #expect(legacy.transcriptId == nil)
        #expect(snapshot.transcriptId == "current")
        #expect(snapshot.configVersion == legacy.configVersion)
    }
}
