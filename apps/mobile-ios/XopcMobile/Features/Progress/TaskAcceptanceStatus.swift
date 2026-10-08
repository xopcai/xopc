import Foundation

enum TaskAcceptanceStatus: String {
    case passed
    case failed
    case pending

    static func resolve(_ criterion: String, index: Int, detail: TaskDetailEnvelope) -> TaskAcceptanceStatus {
        let version = detail.task.latestContractVersion
        if detail.task.contract?.acceptancePolicy != "verified_auto",
           let review = detail.criterionReviews?.first(where: {
               $0.contractVersion == version && $0.criterionIndex == index
           }) {
            return review.status == "passed" ? .passed : .failed
        }
        if detail.task.contract?.acceptancePolicy == "manual" { return .pending }

        let runIDs = Set((detail.runs ?? []).filter { $0.contractVersion == version }.map(\.id))
        let receipts = (detail.receipts ?? [])
            .filter { runIDs.contains($0.runId) }
            .sorted { ($0.finalizedAt ?? 0) > ($1.finalizedAt ?? 0) }
        for receipt in receipts {
            guard let check = receipt.verification?.checks.first(where: { $0.criterion == criterion }),
                  check.status != "unverified" else { continue }
            if check.status == "failed" { return .failed }
            let hasVerifiedEvidence = (receipt.evidence ?? []).contains {
                $0.strength == "verified" && check.evidenceTitles.contains($0.title)
            }
            return hasVerifiedEvidence ? .passed : .pending
        }
        return .pending
    }

    static func allPassed(in detail: TaskDetailEnvelope) -> Bool {
        guard let criteria = detail.task.contract?.acceptanceCriteria, !criteria.isEmpty else { return false }
        return passedCount(in: detail) == criteria.count
    }

    static func passedCount(in detail: TaskDetailEnvelope) -> Int {
        let criteria = detail.task.contract?.acceptanceCriteria ?? []
        return criteria.enumerated().filter { index, criterion in
            resolve(criterion, index: index, detail: detail) == .passed
        }.count
    }
}
