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
    @Test func completionRequiresCurrentAcceptanceAndNoActiveRootRunOrWait() throws {
        let raw = #"""
        {"ok":true,"task":{"id":"t","version":3,"title":"Task","phase":"review",
        "createdAt":1,"updatedAt":2,"latestContractVersion":2,
        "contract":{"acceptanceCriteria":["A"],"acceptancePolicy":"manual"}},
        "operationalState":"idle","allowedCommands":["move","close"],
        "criterionReviews":[{"contractVersion":2,"criterionIndex":0,"status":"passed"}],
        "runs":[],"waits":[]}
        """#
        func decode(_ value: String) throws -> TaskDetailEnvelope {
            try JSONDecoder().decode(TaskDetailEnvelope.self, from: Data(value.utf8))
        }
        let ready = try decode(raw)
        #expect(TaskAcceptanceStatus.completionBlock(in: ready) == nil)
        #expect(ready.phaseCommand(for: "active") == "move")
        #expect(ready.phaseCommand(for: "review") == nil)
        #expect(ready.phaseCommand(for: "closed") == nil)
        let stale = try decode(raw.replacingOccurrences(of: #""contractVersion":2"#, with: #""contractVersion":1"#))
        #expect(TaskAcceptanceStatus.completionBlock(in: stale) == "acceptance")
        let run = try decode(raw.replacingOccurrences(of: #""runs":[]"#,
          with: #""runs":[{"id":"r","status":"running","attempt":1}]"#))
        #expect(TaskAcceptanceStatus.completionBlock(in: run) == "execution")
        let wait = try decode(raw.replacingOccurrences(of: #""waits":[]"#,
          with: #""waits":[{"id":"w","status":"active"}]"#))
        #expect(TaskAcceptanceStatus.completionBlock(in: wait) == "execution")
        let closed = try decode(raw.replacingOccurrences(of: #""phase":"review""#, with: #""phase":"closed""#)
          .replacingOccurrences(of: #"["move","close"]"#, with: #"["reopen"]"#))
        #expect(closed.phaseCommand(for: "ready") == "reopen")
    }

}
