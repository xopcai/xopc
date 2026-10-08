import Testing
@testable import XopcMobile

struct TaskConversationCommandTests {
    @Test func rejectsCommandsThatBreakTaskConversationContinuity() {
        for command in ["/new", "/reset now", "/RESTART@main", "/clear", "/archive reason"] {
            #expect(GatewayClient.isTaskDestructiveCommand(command))
        }
        for text in ["/news", "/skill:new", "Discuss /reset later", "normal message"] {
            #expect(!GatewayClient.isTaskDestructiveCommand(text))
        }
    }
}
