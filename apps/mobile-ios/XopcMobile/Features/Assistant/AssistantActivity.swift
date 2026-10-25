import Foundation

struct AssistantRunProgress: Equatable {
    var runID: String?
    var stages: [ExecutionActivityItem] = []
    var status: String?

    var terminalStatus: String? {
        status.flatMap { ["error", "cancelled", "suspended"].contains($0) ? $0 : nil }
    }

    mutating func begin(_ id: String) {
        if runID != id {
            self = Self(runID: id)
        }
    }

    mutating func record(id: String, text: String) {
        let title = String(text.split(whereSeparator: \.isWhitespace).joined(separator: " ").prefix(160))
        guard !title.isEmpty, !stages.contains(where: { $0.id == id }) else { return }
        stages.append(.init(id: id, title: title, status: "done"))
    }

    mutating func restore(_ messages: [WireMessage]) {
        guard let runID else { return }
        let live = stages
        stages = []
        for message in messages where message.role == "assistant" && message.turnId == runID {
            guard let id = message.id ?? message.messageId,
                  case let .blocks(blocks) = message.rawContent ?? message.content else { continue }
            for block in blocks where block.type == "text" && block.presentation == "narration" {
                record(id: block.segmentId ?? id, text: block.text ?? "")
            }
        }
        for stage in live {
            record(id: stage.id, text: stage.title)
        }
    }

    func visibleStages(answerStarted: Bool) -> [ExecutionActivityItem] {
        if status == "success" || status == "completed" || (answerStarted && terminalStatus == nil) {
            return []
        }
        return stages
    }
}

extension AssistantState {
    static func activity(_ event: RunStreamEvent, label: String?, items: [ExecutionActivityItem])
        -> (label: String?, items: [ExecutionActivityItem])
    {
        var label = label
        var items = items
        func append(id: String, title: String) {
            guard !items.contains(where: { $0.id == id }) else { return }
            items.append(.init(id: id, title: title, status: "running"))
        }
        switch event.name {
        case "thinking_delta":
            label = AppLocalization.resolve("正在思考")
            append(id: "thinking", title: AppLocalization.resolve("分析问题"))
        case "tool_start":
            let title = event.toolName.map { AppLocalization.resolve("正在使用 \($0)") }
                ?? AppLocalization.resolve("正在使用工具")
            label = title
            append(id: "event:\(event.sequence)", title: title)
        case "tool_end":
            if let index = items.lastIndex(where: { $0.status == "running" }) {
                items[index].status = event.status == "error" ? "error" : "done"
            }
            label = AppLocalization.resolve(event.status == "error" ? "工具执行失败" : "继续处理")
        case "progress":
            label = event.stage ?? event.errorMessage ?? AppLocalization.resolve("正在处理")
        case "assistant_delta":
            label = AppLocalization.resolve("正在回答")
        case "run_end":
            label = nil
        default:
            break
        }
        return (label, items)
    }
}
