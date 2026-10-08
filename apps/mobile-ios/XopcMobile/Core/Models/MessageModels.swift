import Foundation

struct WireMessage: Decodable, Sendable {
    let id: String?
    let messageId: String?
    let turnId: String?
    let role: String
    let content: MessageContent
    let rawContent: MessageContent?
    let toolCalls: [HistoryToolCall]?
    let attachments: [HistoryAttachment]?
    let media: [HistoryAttachment]?
    let metadata: WireMessageMetadata?

    var details: [TimelineDetail] {
        let rawDetails = rawContent?.details ?? content.details
        let toolResults = toolCalls?.map { call in
            TimelineDetail(
                id: "\(call.id)-result",
                kind: "tool",
                title: "\(call.name) · \(AppLocalization.resolve(call.isError == true ? "失败" : "完成"))",
                text: call.result?.trimmingCharacters(in: .whitespacesAndNewlines).nonEmpty
                    ?? AppLocalization.resolve("已执行")
            )
        } ?? []
        return rawDetails + toolResults
    }
}

struct HistoryToolCall: Decodable, Sendable {
    let id: String
    let name: String
    let result: String?
    let isError: Bool?
}

struct WireMessageMetadata: Decodable, Sendable {
    let sourceContexts: [SourceContextMetadata]?
    var turnOutcome: HistoryTurnOutcome? = nil
}

struct HistoryTurnOutcome: Decodable, Sendable {
    let deliverables: [HistoryDeliverable]
}

struct HistoryDeliverable: Decodable, Sendable {
    let artifactId: String
    let title: String
    let kind: String
    let mimeType: String?
    let sizeBytes: Int?
    let availability: String
    let uri: String?
    let shareUrl: String?

    var attachment: HistoryAttachment? {
        guard availability == "available", kind != "site", let uri else { return nil }
        return HistoryAttachment(mediaID: artifactId, type: kind, name: title, mimeType: mimeType,
                                 size: sizeBytes, uri: uri, duration: nil, workspaceRelativePath: nil, extractedText: nil)
    }

    var link: HistoryResultLink? {
        guard availability == "available", kind == "site", let url = URL(string: shareUrl ?? uri ?? ""),
              url.scheme == "https", url.user == nil, url.password == nil else { return nil }
        return HistoryResultLink(id: artifactId, title: title, url: url)
    }
}

struct HistoryResultLink: Equatable, Identifiable, Sendable {
    let id: String
    let title: String
    let url: URL
}

struct SourceContextMetadata: Decodable, Sendable {
    let kind: String
    let sourceId: String
    let version: String
    let title: String?
}

enum MessageContent: Decodable, Sendable {
    case text(String)
    case blocks([MessageBlock])

    init(from decoder: Decoder) throws {
        let container = try decoder.singleValueContainer()
        if let text = try? container.decode(String.self) {
            self = .text(text)
        } else {
            self = try .blocks(container.decode([MessageBlock].self))
        }
    }

    var text: String {
        switch self {
        case let .text(value): value
        case let .blocks(blocks): blocks.filter { $0.type == "text" }.compactMap(\.text).joined(separator: "\n")
        }
    }

    var details: [TimelineDetail] {
        guard case let .blocks(blocks) = self else { return [] }
        return blocks.timelineDetails
    }
}

private extension [MessageBlock] {
    var timelineDetails: [TimelineDetail] {
        enumerated().compactMap { index, block in
            switch block.type {
            case "thinking":
                let content = block.thinking ?? block.text ?? ""
                guard !content.isEmpty else { return nil }
                return TimelineDetail(
                    id: block.id ?? "thinking-\(index)",
                    kind: "thinking",
                    title: "思考过程",
                    text: content
                )
            case "toolCall", "tool_use", "tool_call":
                return TimelineDetail(
                    id: block.id ?? "tool-\(index)",
                    kind: "tool",
                    title: block.name ?? AppLocalization.resolve("工具调用"),
                    text: block.status ?? AppLocalization.resolve("已执行")
                )
            default: return nil
            }
        }
    }
}

private extension String {
    var nonEmpty: String? {
        isEmpty ? nil : self
    }
}

struct MessageBlock: Decodable, Sendable {
    let type: String
    let text: String?
    let thinking: String?
    let name: String?
    let id: String?
    let status: String?
}

struct TimelineMessage: Equatable, Identifiable, Sendable {
    let id: String
    let role: String
    var text: String
    var isPending: Bool
    var turnId: String?
    var markdownParts: [MarkdownPart] = []
    var details: [TimelineDetail] = []
    var attachments: [HistoryAttachment] = []
    var references: [ContextReference] = []
    var resultLinks: [HistoryResultLink] = []
    var unavailableOutputs: [String] = []
}

struct TimelineDetail: Equatable, Identifiable, Sendable {
    let id: String
    let kind: String
    let title: String
    let text: String
}
