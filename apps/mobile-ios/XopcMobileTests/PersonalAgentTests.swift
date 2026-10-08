import Foundation
import Testing
@testable import XopcMobile

@MainActor
struct PersonalAgentTests {
    @Test func decodesEmptyAndReadyPersonalAgentResponses() throws {
        let decoder = JSONDecoder()
        let empty = try decoder.decode(
            GatewayEnvelope<PersonalAgentRecord>.self,
            from: Data(#"{"ok":true,"payload":null}"#.utf8)
        )
        #expect(empty.isSuccessful)
        #expect(empty.payload == nil)

        let ready = try decoder.decode(
            GatewayEnvelope<PersonalAgentRecord>.self,
            from: Data(#"{"ok":true,"payload":{"agentId":"personal","conversationId":"fixed","state":"ready","displayName":"Ada","appearance":"loopi","errorMessage":null}}"#.utf8)
        )
        #expect(ready.payload?.isReady == true)
        #expect(ready.payload?.conversationId == "fixed")

        let configured = try decoder.decode(
            GatewayEnvelope<PersonalAgentRecord>.self,
            from: Data(#"{"ok":true,"payload":{"agentId":"personal","conversationId":"fixed","state":"ready","displayName":"Ada","appearance":"loopi-care","revision":4,"preferences":{"warmth":"gentle"},"voicePreference":{"provider":"alibaba","model":"tts","voice":"voice-a"},"errorMessage":null}}"#.utf8)
        )
        #expect(configured.payload?.revision == 4)
        #expect(configured.payload?.preferences?["warmth"] == "gentle")
        #expect(configured.payload?.voicePreference?.voice == "voice-a")

        let failure = try decoder.decode(
            GatewayEnvelope<PersonalAgentRecord>.self,
            from: Data(#"{"ok":false,"error":"No compatible model"}"#.utf8)
        )
        #expect(failure.error?.message == "No compatible model")
    }
}
