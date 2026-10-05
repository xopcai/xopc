import Foundation

struct ClarificationSnapshot: Decodable, Sendable {
    let transcriptId: String
    let revision: Int
    let serverTime: Int
    let clarification: ClarificationRequest?
}

struct ClarificationRequest: Decodable, Equatable, Identifiable, Sendable {
    let id: String
    let conversationId: String
    let kind: String
    let status: String
    let question: String
    let choices: [String]?
    let suggestedAnswer: String?
    let version: Int
    let expiresAt: Int?

    var isOpen: Bool {
        status == "open"
    }
}

struct InputState: Decodable, Sendable {
    let conversationId: String?
    let revision: Int?
    let activeRunId: String?
    let inputs: [QueuedInput]

    init(
        conversationId: String? = nil,
        revision: Int? = nil,
        activeRunId: String?,
        inputs: [QueuedInput] = []
    ) {
        self.conversationId = conversationId
        self.revision = revision
        self.activeRunId = activeRunId
        self.inputs = inputs
    }
}

struct QueuedInput: Decodable, Equatable, Identifiable, Sendable {
    let id: String
    let content: String
    let status: String
    let version: Int
    let position: Int
    let requestedDelivery: String
    let effectiveDelivery: String
    let error: String?
    let attachments: [QueuedAttachment]?
    let contextRefs: [QueuedContextReference]?

    var isPending: Bool {
        status == "queued" || status == "injecting" || status == "interrupted"
    }

    var payloadDescription: String {
        if !content.isEmpty {
            return content
        }
        var parts: [String] = []
        if let count = attachments?.count, count > 0 {
            parts.append(AppLocalization.resolve("\(count) 个附件"))
        }
        if let count = contextRefs?.count, count > 0 {
            parts.append(AppLocalization.resolve("\(count) 个引用"))
        }
        return parts.isEmpty ? AppLocalization.resolve("待处理消息") : parts.joined(separator: AppLocalization.resolve("、"))
    }
}

struct QueuedAttachment: Decodable, Equatable, Sendable {
    let name: String
}

struct QueuedContextReference: Decodable, Equatable, Sendable {
    let kind: String
    let sourceId: String
    let version: String
    let title: String?
}

struct MessageAttachment: Equatable, Identifiable, Sendable {
    let id: UUID
    let type: String
    let name: String
    let mimeType: String
    let size: Int
    let data: String

    init(
        id: UUID = UUID(),
        type: String,
        name: String,
        mimeType: String,
        size: Int,
        data: String
    ) {
        self.id = id
        self.type = type
        self.name = name
        self.mimeType = mimeType
        self.size = size
        self.data = data
    }
}

enum ContextReferenceKind: String, CaseIterable, Sendable {
    case note
    case task
    case file

    var title: String {
        switch self {
        case .note: "笔记"
        case .task: "任务"
        case .file: "文件"
        }
    }

    var systemImage: String {
        switch self {
        case .note: "note.text"
        case .task: "checklist"
        case .file: "doc"
        }
    }
}

struct ContextReference: Equatable, Identifiable, Sendable {
    let kind: ContextReferenceKind
    let sourceId: String
    let expectedVersion: String
    let title: String

    var id: String {
        "\(kind.rawValue):\(sourceId)"
    }
}

struct ReferenceItem: Equatable, Identifiable, Sendable {
    let kind: ContextReferenceKind
    let id: String
    let title: String
    let description: String
    let version: String

    var reference: ContextReference {
        ContextReference(
            kind: kind,
            sourceId: id,
            expectedVersion: version,
            title: title
        )
    }
}

struct HistoryAttachment: Decodable, Equatable, Identifiable, Sendable {
    let name: String?
    let mimeType: String?

    var id: String {
        "\(name ?? "attachment")|\(mimeType ?? "application/octet-stream")"
    }
}

enum MessageDelivery: String, Sendable {
    case next
    case steer
}
