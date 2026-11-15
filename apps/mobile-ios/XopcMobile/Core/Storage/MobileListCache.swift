import Foundation

actor RecentConversationsStore {
    static let shared = RecentConversationsStore()

    private struct Record: Codable {
        let requestedAt: Date
        let rows: [ConversationSummary]
    }

    private let maximumAge: TimeInterval = 72 * 60 * 60
    private let baseDirectory: URL?
    private var records: [String: Record] = [:]
    private var removedAt: [String: Date] = [:]

    init(baseDirectory: URL? = nil) {
        self.baseDirectory = baseDirectory
    }

    func read(scope: String) -> [ConversationSummary]? {
        record(scope)?.rows
    }

    func write(_ rows: [ConversationSummary], scope: String, requestedAt: Date) {
        guard !Task.isCancelled, (removedAt[scope] ?? .distantPast) < requestedAt,
              (record(scope)?.requestedAt ?? .distantPast) <= requestedAt else { return }
        let record = Record(requestedAt: requestedAt, rows: Array(rows.prefix(20)))
        records[scope] = record
        pruneMemory()
        guard let url = try? url(scope), let data = try? JSONEncoder().encode(record),
              data.count <= 64 * 1024 else { return }
        try? data.write(to: url, options: [.atomic, .completeFileProtection])
        pruneDisk(in: url.deletingLastPathComponent(), retaining: url)
    }

    func removeConversation(_ id: String, scope: String) {
        guard let rows = read(scope: scope), rows.contains(where: { $0.id == id }) else { return }
        write(rows.filter { $0.id != id }, scope: scope, requestedAt: .now)
    }

    func remove(scope: String) {
        removedAt[scope] = .now
        records.removeValue(forKey: scope)
        if let url = try? url(scope) {
            try? FileManager.default.removeItem(at: url)
        }
    }

    private func record(_ scope: String) -> Record? {
        if let record = records[scope], fresh(record.requestedAt) {
            return record
        }
        guard let url = try? url(scope), let size = try? url.resourceValues(forKeys: [.fileSizeKey]).fileSize,
              size <= 64 * 1024, let data = try? Data(contentsOf: url),
              let record = try? JSONDecoder().decode(Record.self, from: data), fresh(record.requestedAt),
              (removedAt[scope] ?? .distantPast) < record.requestedAt else { return nil }
        records[scope] = record
        pruneMemory()
        return record
    }

    private func fresh(_ date: Date) -> Bool {
        (0 ... maximumAge).contains(Date.now.timeIntervalSince(date))
    }

    private func url(_ scope: String) throws -> URL {
        let parent = try (baseDirectory ?? FileManager.default.url(
            for: .cachesDirectory, in: .userDomainMask, appropriateFor: nil, create: true
        ))
        let directory = parent.appendingPathComponent("recent-conversations-v1", isDirectory: true)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        return directory.appendingPathComponent(scope + ".json")
    }

    private func pruneMemory() {
        if records.count > 4, let oldest = records.min(by: { $0.value.requestedAt < $1.value.requestedAt }) {
            records.removeValue(forKey: oldest.key)
        }
    }

    private func pruneDisk(in directory: URL, retaining current: URL) {
        let keys: Set<URLResourceKey> = [.contentModificationDateKey]
        guard let files = try? FileManager.default.contentsOfDirectory(
            at: directory, includingPropertiesForKeys: Array(keys), options: .skipsHiddenFiles
        ) else { return }
        let otherFiles = files.filter { $0 != current }.sorted {
            let left = (try? $0.resourceValues(forKeys: keys).contentModificationDate) ?? .distantPast
            let right = (try? $1.resourceValues(forKeys: keys).contentModificationDate) ?? .distantPast
            return left > right
        }
        for file in otherFiles.dropFirst(3) {
            try? FileManager.default.removeItem(at: file)
        }
    }
}

@MainActor
final class MobileListCache {
    static let shared = MobileListCache()

    enum ListKind: Hashable {
        case conversations, projects, automations, notes, recentFiles, generatedMedia, spaceLibrary
    }

    private struct Key: Hashable {
        let scope: String
        let kind: ListKind
    }

    private var entries: [Key: (date: Date, value: any Sendable)] = [:]

    func read<T: Sendable>(_ kind: ListKind, scope: String) -> T? {
        let key = Key(scope: scope, kind: kind)
        guard let entry = entries[key], Date.now.timeIntervalSince(entry.date) < 30 * 60 else {
            entries.removeValue(forKey: key)
            return nil
        }
        return entry.value as? T
    }

    func write(_ value: some Sendable, to kind: ListKind, scope: String, requestedAt: Date) {
        let key = Key(scope: scope, kind: kind)
        guard (entries[key]?.date ?? .distantPast) <= requestedAt else { return }
        entries[key] = (requestedAt, value)
        if entries.count > 20, let oldest = entries.min(by: { $0.value.date < $1.value.date }) {
            entries.removeValue(forKey: oldest.key)
        }
    }

    func remove(_ kind: ListKind, scope: String) {
        entries.removeValue(forKey: Key(scope: scope, kind: kind))
    }

    func remove(scope: String) {
        entries = entries.filter { $0.key.scope != scope }
    }
}
