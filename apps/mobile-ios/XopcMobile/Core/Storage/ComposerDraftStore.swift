import CryptoKit
import Foundation

struct SavedComposerDraft: Codable, Equatable {
    var text = ""
    var attachments: [MessageAttachment] = []
    var references: [ContextReference] = []
    var intakeReceipts: [UUID] = []
    func addingExternalFiles(_ batch: ExternalIntakeBatch, store: ExternalIntakeStore) throws -> SavedComposerDraft {
        if intakeReceipts.contains(batch.id) { return self }
        var result = self
        for file in batch.files where !result.attachments.contains(where: { $0.id == file.id }) {
            try AttachmentPolicy.validateChat(size: file.size, current: result.attachments)
            let bytes = try store.data(file, in: batch)
            result.attachments.append(MessageAttachment(id: file.id, type: file.mimeType.hasPrefix("image/") ? "image" : "file",
                name: file.name, mimeType: file.mimeType, size: file.size, data: bytes.base64EncodedString()))
        }
        result.intakeReceipts.append(batch.id)
        return result
    }

}

struct ComposerDraftStore {
    var baseDirectory: URL? = nil
    static func accountScope(_ configuration: GatewayConfiguration) -> String {
        SHA256.hash(data: Data((configuration.localIdentity ?? (configuration.baseURL.absoluteString + "\n" + configuration.token)).utf8))
            .map { String(format: "%02x", $0) }.joined()
    }

    static func scope(_ configuration: GatewayConfiguration, conversationID: String?) -> String {
        accountScope(configuration) + ":" + (conversationID ?? "unassigned")
    }

    private func url(_ scope: String) throws -> URL {
        let root = try (baseDirectory ?? FileManager.default.url(for: .applicationSupportDirectory, in: .userDomainMask, appropriateFor: nil, create: true))
            .appendingPathComponent("composer-drafts", isDirectory: true)
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        let key = SHA256.hash(data: Data(scope.utf8)).map { String(format: "%02x", $0) }.joined()
        return root.appendingPathComponent(key + ".json")
    }

    func saveSelection(_ selection: ConversationSelection, configuration: GatewayConfiguration) throws {
        try JSONEncoder().encode(selection).write(to: url(Self.accountScope(configuration) + ":selection"), options: [.atomic, .completeFileProtection])
    }

    func readSelection(configuration: GatewayConfiguration) throws -> ConversationSelection? {
        let path = try url(Self.accountScope(configuration) + ":selection")
        guard FileManager.default.fileExists(atPath: path.path) else { return nil }
        return try JSONDecoder().decode(ConversationSelection.self, from: Data(contentsOf: path))
    }

    func read(_ scope: String) throws -> SavedComposerDraft {
        let path = try url(scope)
        guard FileManager.default.fileExists(atPath: path.path) else { return SavedComposerDraft() }
        return try JSONDecoder().decode(SavedComposerDraft.self, from: Data(contentsOf: path))
    }

    func save(_ draft: SavedComposerDraft, scope: String) throws {
        try JSONEncoder().encode(draft).write(to: url(scope), options: [.atomic, .completeFileProtection])
    }
}
