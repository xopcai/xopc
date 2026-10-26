import CryptoKit
import Foundation

struct ClarificationSnapshot: Decodable, Sendable {
    let transcriptId: String
    let revision: Int
    let serverTime: Int
    let clarification: ClarificationRequest?
}

struct ClarificationChoice: Codable, Equatable, Identifiable, Sendable {
    let id: String
    let label: String
    let description: String?
}

indirect enum ClarificationJSON: Codable, Equatable, Sendable {
    case string(String), number(Double), bool(Bool), object([String: ClarificationJSON]), array([ClarificationJSON]), null
    init(from decoder: any Decoder) throws {
        let container = try decoder.singleValueContainer()
        if container.decodeNil() {
            self = .null
        } else if let value = try? container.decode(Bool.self) {
            self = .bool(value)
        } else if let value = try? container.decode(Double.self) {
            self = .number(value)
        } else if let value = try? container.decode(String.self) {
            self = .string(value)
        } else if let value = try? container.decode([String: ClarificationJSON].self) {
            self = .object(value)
        } else {
            self = try .array(container.decode([ClarificationJSON].self))
        }
    }

    func encode(to encoder: any Encoder) throws {
        var container = encoder.singleValueContainer()
        switch self {
        case let .string(value): try container.encode(value)
        case let .number(value): try container.encode(value)
        case let .bool(value): try container.encode(value)
        case let .object(value): try container.encode(value)
        case let .array(value): try container.encode(value)
        case .null: try container.encodeNil()
        }
    }
}

struct ClarificationApproval: Codable, Equatable, Sendable {
    let operation: String
    let target: String?
    let impact: String?
    let argumentsPreview: [String: ClarificationJSON]?
    var preview: String? {
        guard let argumentsPreview else { return nil }
        let encoder = JSONEncoder(); encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
        return (try? encoder.encode(argumentsPreview)).flatMap { String(data: $0, encoding: .utf8) }
    }
}

struct ClarificationQuestion: Codable, Equatable, Identifiable, Sendable {
    let id: String
    let header: String
    let question: String
    let type: String
    let choices: [ClarificationChoice]?
    let recommendedChoiceId: String?
}

struct ClarificationAnswer: Codable, Equatable, Sendable {
    let questionId: String
    var choiceId: String?
    var text: String?
    var valid: Bool { (choiceId != nil || !(text ?? "").trimmingCharacters(in: .whitespacesAndNewlines).isEmpty) && (text ?? "").trimmingCharacters(in: .whitespacesAndNewlines).utf16.count <= 2000 }
}

struct ClarificationPrincipal: Decodable { let deviceId: String? }
struct ClarificationHealth: Decodable { let clarificationVersions: [Int]? }
struct ClarificationCapabilities: Codable, Equatable, Sendable { var clarificationVersions = [1, 2] }

struct ClarificationSubmission: Codable, Equatable, Sendable {
    struct Response: Codable, Equatable, Sendable { let choiceId: String?; let text: String? }
    let response: Response?
    let decision: String?
    var answers: [ClarificationAnswer]?
    static func input(choiceId: String? = nil, text: String? = nil) -> Self {
        .init(response: .init(choiceId: choiceId, text: text), decision: nil)
    }

    static func approval(_ decision: String) -> Self {
        .init(response: nil, decision: decision)
    }
}

struct ClarificationRequest: Decodable, Equatable, Identifiable, Sendable {
    let id: String
    let conversationId: String
    let kind: String
    let status: String
    let question: String
    let choiceDetails: [ClarificationChoice]?
    let interactionMode: String?
    let recommendedChoiceId: String?
    let approval: ClarificationApproval?
    let version: Int
    let expiresAt: Int?
    var schemaVersion: Int?
    var questions: [ClarificationQuestion]?
    var scope: String?
    var clockOffset: Int?
    var validQuestions: Bool {
        guard let questions, kind == "input", (1 ... 3).contains(questions.count), Set(questions.map(\.id)).count == questions.count else { return false }
        return questions.allSatisfy { question in
            ["text", "single_choice"].contains(question.type) && (question.type != "single_choice" || (2 ... 10).contains(question.choices?.count ?? 0))
        }
    }
    func accepts(_ answers: [ClarificationAnswer]) -> Bool {
        guard validQuestions, let questions, answers.count == questions.count, Set(answers.map(\.questionId)).count == answers.count else { return false }
        let summary = questions.map { question in
            let answer = answers.first { $0.questionId == question.id }
            let label = question.choices?.first { $0.id == answer?.choiceId }?.label
            return "\(question.header): \(question.question)\n" + [label, answer?.text?.trimmingCharacters(in: .whitespacesAndNewlines)].compactMap { $0 }.filter { !$0.isEmpty }.joined(separator: "\n")
        }.joined(separator: "\n\n")
        return summary.utf16.count <= 8000 && questions.allSatisfy { question in
            guard let answer = answers.first(where: { $0.questionId == question.id }), answer.valid else { return false }
            return answer.choiceId == nil || (question.type == "single_choice" && question.choices?.contains(where: { $0.id == answer.choiceId }) == true)
        }
    }
    var isOpen: Bool {
        status == "open"
    }

    var isExpired: Bool {
        expiresAt.map { Double($0) <= Date().timeIntervalSince1970 * 1000 + Double(clockOffset ?? 0) } ?? false
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

    var title: LocalizedStringResource {
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
    let mediaID: String?
    let type: String?
    let name: String?
    let mimeType: String?
    let size: Int?
    let uri: String?
    let duration: Double?
    let workspaceRelativePath: String?
    let extractedText: String?

    enum CodingKeys: String, CodingKey {
        case mediaID = "id"
        case type, name, mimeType, size, uri, duration, durationSeconds, workspaceRelativePath, extractedText
    }

    var id: String {
        mediaID ?? uri ?? workspaceRelativePath ?? "\(name ?? "attachment")|\(mimeType ?? "application/octet-stream")"
    }

    var isImage: Bool {
        type == "image" || type == "photo" || mimeType?.hasPrefix("image/") == true
    }

    var isAudio: Bool {
        type == "audio" || type == "voice" || mimeType?.hasPrefix("audio/") == true
    }
}

enum MessageDelivery: String, Sendable {
    case next
    case steer
}

extension HistoryAttachment {
    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        mediaID = try container.decodeIfPresent(String.self, forKey: .mediaID)
        type = try container.decodeIfPresent(String.self, forKey: .type)
        name = try container.decodeIfPresent(String.self, forKey: .name)
        mimeType = try container.decodeIfPresent(String.self, forKey: .mimeType)
        size = try container.decodeIfPresent(Int.self, forKey: .size)
        uri = try container.decodeIfPresent(String.self, forKey: .uri)
        duration = try container.decodeIfPresent(Double.self, forKey: .duration)
            ?? container.decodeIfPresent(Double.self, forKey: .durationSeconds)
        workspaceRelativePath = try container.decodeIfPresent(String.self, forKey: .workspaceRelativePath)
        extractedText = try container.decodeIfPresent(String.self, forKey: .extractedText)
    }
}

@MainActor
enum ClarificationPersistence {
    nonisolated static func scope(_ identity: String) -> String {
        SHA256.hash(data: Data(identity.utf8)).map { String(format: "%02x", $0) }.joined()
    }
    static func key(_ prompt: ClarificationRequest, _ kind: String) -> String {
        "clarify.\(prompt.scope ?? "local").\(prompt.conversationId).\(prompt.id).\(prompt.version).\(kind)"
    }
    static func read<T: Decodable>(_ prompt: ClarificationRequest, _ kind: String, as recordType: T.Type, store: any GatewayTokenStoring = SystemGatewayTokenStore()) -> T? {
        guard let raw = store.load(account: key(prompt, kind)), let data = raw.data(using: .utf8) else { return nil }
        return try? JSONDecoder().decode(T.self, from: data)
    }
    static func write<T: Encodable>(_ prompt: ClarificationRequest, _ kind: String, _ record: T, store: any GatewayTokenStoring = SystemGatewayTokenStore()) throws {
        let data = try JSONEncoder().encode(record)
        guard let text = String(data: data, encoding: .utf8) else { throw CocoaError(.fileWriteInapplicableStringEncoding) }
        try store.save(text, account: key(prompt, kind))
    }
    static func clear(_ prompt: ClarificationRequest, store: any GatewayTokenStoring = SystemGatewayTokenStore()) throws {
        try store.save("", account: key(prompt, "draft"))
        try store.save("", account: key(prompt, "attempt"))
    }
}
