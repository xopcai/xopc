import Foundation

@MainActor final class ChatStreamBuffer {
    private final class Pending {
        let base: TimelineMessage
        let text: NSMutableString
        init(_ base: TimelineMessage) {
            self.base = base; text = NSMutableString(string: base.text)
        }
    }

    private var pending: [String: Pending] = [:]
    private var order: [String] = []
    private var liveIDs: Set<String> = []
    private var narrations: Set<String> = []

    func reset() {
        pending = [:]; order = []; liveIDs = []; narrations = []
    }

    func containsLive(_ id: String) -> Bool {
        liveIDs.contains(id)
    }

    func confirm(_ ids: Set<String>) {
        liveIDs.subtract(ids)
    }

    func closeNarration(_ id: String) {
        narrations.insert(id); liveIDs.remove(id)
    }

    func append(_ event: RunStreamEvent, runID: String, visible: [TimelineMessage]) -> String {
        guard let delta = event.delta, !delta.isEmpty else { return "replay" }
        let id = event.messageId ?? runID
        if narrations.contains(id) || visible.contains(where: { !$0.isPending && $0.id == id }) {
            return "replay"
        }
        let retained = pending[id]
        let displayed = retained == nil ? visible.first { $0.id == id } : nil
        let next = retained ?? Pending(displayed ?? TimelineMessage(id: id, role: "assistant", text: "", isPending: true, answerConfirmed: false, turnId: runID))
        let offset = event.offset ?? next.text.length
        guard offset >= 0, offset <= next.text.length else { liveIDs.insert(id); return "gap" }
        let overlap = min(next.text.length - offset, delta.utf16.count)
        if overlap > 0 {
            let prior = next.text.substring(with: NSRange(location: offset, length: overlap))
            guard Array(prior.utf16) == Array(delta.utf16.prefix(overlap)) else { return "gap" }
        }
        let remainder = String(decoding: delta.utf16.dropFirst(overlap), as: UTF16.self)
        guard !remainder.isEmpty else { return "replay" }
        next.text.append(remainder)
        if retained == nil {
            order.append(id)
        }
        pending[id] = next; liveIDs.insert(id)
        return displayed == nil && retained == nil ? "first" : "accepted"
    }

    func drain(_ visible: [TimelineMessage]) -> [TimelineMessage] {
        guard !order.isEmpty else { return visible }
        var rows = visible
        for id in order {
            guard let next = pending[id] else { continue }
            if let index = rows.firstIndex(where: { $0.id == id }) {
                rows[index].text = next.text as String
            } else {
                var row = next.base; row.text = next.text as String; rows.append(row)
            }
        }
        pending = [:]; order = []
        return rows
    }

    func finish(_ visible: [TimelineMessage]) -> [TimelineMessage] {
        visible.map { message in
            guard liveIDs.contains(message.id) else { return message }
            var finished = message; finished.isPending = false; return finished
        }
    }
}
