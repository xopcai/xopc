import Foundation

struct ChatReplySpace: Equatable {
    private(set) var anchorID: String?
    private(set) var budget: CGFloat = 0
    private(set) var remaining: CGFloat = 0

    mutating func begin(anchorID: String, availableHeight: CGFloat, following: Bool) {
        guard following else { return }
        self.anchorID = anchorID
        budget = min(64, max(0, availableHeight) * 0.1)
        remaining = budget
    }

    mutating func consume(replyHeight: CGFloat, availableHeight: CGFloat, following: Bool) {
        guard following, anchorID != nil else { return }
        remaining = max(0, min(remaining, min(budget, min(64, max(0, availableHeight) * 0.1)) - max(0, replyHeight)))
    }

    mutating func reanchor(_ anchorID: String) {
        guard self.anchorID != nil else { return }
        self.anchorID = anchorID
    }
}
