import Foundation

enum TaskAcceptanceStatus: String {
    case passed
    case failed
    case pending

    static func resolve(_ criterion: String, index: Int, detail: TaskDetailEnvelope) -> TaskAcceptanceStatus {
        guard let checks = detail.acceptanceChecks, checks.indices.contains(index),
              checks[index].criterion == criterion else { return .pending }
        return resolve(checks[index], detail: detail)
    }

    static func resolve(_ criterion: TaskAcceptanceCheck, detail: TaskDetailEnvelope) -> TaskAcceptanceStatus {
        if let review = detail.criterionReviews?.first(where: { $0.checkId == criterion.id }) {
            return TaskAcceptanceStatus(rawValue: review.status) ?? .pending
        }
        guard detail.task.contract?.acceptancePolicy != "manual",
              let runID = detail.acceptanceTarget?.runId,
              detail.runs?.contains(where: { $0.id == runID && $0.contractVersion == detail.task.latestContractVersion }) == true,
              let receipt = detail.receipts?.first(where: { $0.runId == runID }),
              let checks = receipt.verification?.checks.filter({ $0.checkId == criterion.id }),
              checks.count == 1, let check = checks.first else { return .pending }
        if check.status == "failed" {
            return .failed
        }
        let byTitle = Dictionary(grouping: receipt.evidence ?? [], by: \.title)
        let verified = check.evidenceTitles.contains { title in
            byTitle[title]?.count == 1 && byTitle[title]?.first?.strength == "verified"
        }
        return check.status == "passed" && verified ? .passed : .pending
    }

    static func completionBlock(in detail: TaskDetailEnvelope) -> String? {
        if (detail.waits ?? []).contains(where: { $0.status == "active" })
            || (detail.runs ?? []).contains(where: {
                $0.parentRunId == nil && ["queued", "running", "waiting", "verifying"].contains($0.status)
            })
        {
            return "execution"
        }
        guard let criteria = detail.task.contract?.acceptanceCriteria, !criteria.isEmpty else { return "criteria" }
        return allPassed(in: detail) ? nil : "acceptance"
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

extension TaskDetailEnvelope {
    var signoffResultID: String? {
        guard let action = presentation?.primaryAction, action.type == "signoff",
              let target = acceptanceTarget, target.canSignOff, action.resultId == target.id else { return nil }
        return target.id
    }

    func phaseCommand(for phase: String) -> String? {
        guard phase != task.phase, ["backlog", "ready", "active", "review", "closed"].contains(phase) else { return nil }
        let command = "move"
        return allowedCommands?.contains(command) == true ? command : nil
    }
}
