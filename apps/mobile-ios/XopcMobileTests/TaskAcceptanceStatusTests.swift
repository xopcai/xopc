import Foundation
import Testing
@testable import XopcMobile

struct TaskAcceptanceStatusTests {
    @Test func verifiedCriterionNeedsCurrentRunAndVerifiedEvidence() throws {
        let base = #"""
        {"ok":true,"task":{"id":"t","version":1,"title":"Task","phase":"review",
        "createdAt":1,"updatedAt":2,"latestContractVersion":2,
        "contract":{"objective":"Task","acceptanceCriteria":["A"],
        "acceptancePolicy":"verified_auto"}},"operationalState":"review",
        "runs":[{"id":"r","status":"succeeded","attempt":1,"contractVersion":2}],
        "receipts":[{"runId":"r","status":"succeeded","summary":"Done","finalizedAt":5,
        "evidence":[{"kind":"test","title":"proof","strength":"verified"}],
        "verification":{"checks":[{"criterion":"A","status":"passed",
        "evidenceTitles":["proof"]}]}}]}
        """#
        let verified = try JSONDecoder().decode(TaskDetailEnvelope.self, from: Data(base.utf8))
        #expect(TaskAcceptanceStatus.resolve("A", index: 0, detail: verified) == .passed)
        #expect(TaskAcceptanceStatus.allPassed(in: verified))

        let observed = try JSONDecoder().decode(
            TaskDetailEnvelope.self,
            from: Data(base.replacingOccurrences(of: #""strength":"verified""#, with: #""strength":"observed""#).utf8)
        )
        #expect(TaskAcceptanceStatus.resolve("A", index: 0, detail: observed) == .pending)
        #expect(!TaskAcceptanceStatus.allPassed(in: observed))

        let staleRun = try JSONDecoder().decode(
            TaskDetailEnvelope.self,
            from: Data(base.replacingOccurrences(of: #""contractVersion":2"#,
                                                 with: #""contractVersion":1"#).utf8)
        )
        #expect(TaskAcceptanceStatus.resolve("A", index: 0, detail: staleRun) == .pending)
    }
}
