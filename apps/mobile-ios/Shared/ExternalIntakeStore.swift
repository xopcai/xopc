import Foundation
import UniformTypeIdentifiers

struct ExternalIntakeFile: Codable, Equatable, Identifiable, Sendable {
    let id: UUID
    let name: String
    let mimeType: String
    let size: Int
}

struct ExternalIntakeTarget: Codable, Equatable, Sendable {
    let scope: String
    let conversationID: String
    let title: String
    let agentID: String
    let isDraft: Bool
    var projectID: String? = nil
    var executionMode: String? = nil
    var model: String? = nil
    var thinkingLevel: String? = nil
}

struct ExternalIntakeBatch: Codable, Equatable, Identifiable, Sendable {
    let id: UUID
    let createdAt: Date
    var files: [ExternalIntakeFile]
    var errors: [String]
    var target: ExternalIntakeTarget?
}

/// Files live in an App Group so the Share Extension can finish without launching the app.
struct ExternalIntakeStore: Sendable {
    var baseDirectory: URL? = nil
    static let groupID = "group.ai.xopc.xopc"
    static let maximumBytes = 10 * 1024 * 1024

    private func root() throws -> URL {
        guard let container = baseDirectory ?? FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: Self.groupID) else {
            throw CocoaError(.fileNoSuchFile, userInfo: [NSLocalizedDescriptionKey: "共享存储不可用"])
        }
        let directory = container.appendingPathComponent("external-intake", isDirectory: true)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        return directory
    }

    private func directory(_ id: UUID) throws -> URL {
        let directory = try root().appendingPathComponent(id.uuidString, isDirectory: true)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        return directory
    }

    func newBatch() -> ExternalIntakeBatch {
        ExternalIntakeBatch(id: UUID(), createdAt: Date(), files: [], errors: [])
    }

    func capture(_ url: URL, into batchID: UUID) throws -> ExternalIntakeFile {
        guard url.isFileURL else { throw CocoaError(.fileReadUnsupportedScheme) }
        let granted = url.startAccessingSecurityScopedResource()
        defer { if granted { url.stopAccessingSecurityScopedResource() } }
        let values = try url.resourceValues(forKeys: [.isRegularFileKey, .fileSizeKey])
        guard values.isRegularFile == true, let size = values.fileSize, size > 0, size <= Self.maximumBytes else {
            throw CocoaError(.fileReadTooLarge, userInfo: [NSLocalizedDescriptionKey: "文件须小于 10 MB，且不能为空"])
        }
        let handle = try FileHandle(forReadingFrom: url)
        defer { try? handle.close() }
        let data = try handle.read(upToCount: Self.maximumBytes + 1) ?? Data()
        guard !data.isEmpty, data.count <= Self.maximumBytes else { throw CocoaError(.fileReadTooLarge) }
        let id = UUID()
        let type = UTType(filenameExtension: url.pathExtension)
        try data.write(to: directory(batchID).appendingPathComponent(id.uuidString), options: [.atomic, .completeFileProtection])
        return ExternalIntakeFile(id: id, name: url.lastPathComponent,
            mimeType: type?.preferredMIMEType ?? "application/octet-stream", size: data.count)
    }

    func save(_ batch: ExternalIntakeBatch) throws {
        try JSONEncoder().encode(batch).write(to: directory(batch.id).appendingPathComponent("manifest.json"), options: [.atomic, .completeFileProtection])
    }

    func capture(_ urls: [URL]) throws -> ExternalIntakeBatch {
        var batch = newBatch()
        for url in urls {
            do { batch.files.append(try capture(url, into: batch.id)) }
            catch { batch.errors.append("\(url.lastPathComponent): \(error.localizedDescription)") }
        }
        try save(batch)
        return batch
    }

    func pending() throws -> [ExternalIntakeBatch] {
        var batches: [ExternalIntakeBatch] = []
        for url in try FileManager.default.contentsOfDirectory(at: root(), includingPropertiesForKeys: nil) {
            guard let id = UUID(uuidString: url.lastPathComponent) else { continue }
            let manifest = url.appendingPathComponent("manifest.json")
            guard FileManager.default.fileExists(atPath: manifest.path) else { continue }
            let batch = try JSONDecoder().decode(ExternalIntakeBatch.self, from: Data(contentsOf: manifest))
            guard batch.id == id else { continue }
            if batch.target == nil, Date().timeIntervalSince(batch.createdAt) > 86_400 { try remove(id) }
            else { batches.append(batch) }
        }
        return batches.sorted { $0.createdAt < $1.createdAt }
    }

    func data(_ file: ExternalIntakeFile, in batch: ExternalIntakeBatch) throws -> Data {
        guard batch.files.contains(file) else { throw CocoaError(.fileReadNoPermission) }
        let bytes = try Data(contentsOf: directory(batch.id).appendingPathComponent(file.id.uuidString))
        guard bytes.count == file.size, bytes.count <= Self.maximumBytes else { throw CocoaError(.fileReadCorruptFile) }
        return bytes
    }

    func remove(_ id: UUID) throws {
        let path = try root().appendingPathComponent(id.uuidString)
        if FileManager.default.fileExists(atPath: path.path) { try FileManager.default.removeItem(at: path) }
    }
}
