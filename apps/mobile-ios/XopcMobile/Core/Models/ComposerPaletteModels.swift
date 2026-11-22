import Foundation

struct ComposerCommandCatalog: Decodable {
    let commands: [ComposerCommand]
}

struct ComposerCommand: Decodable, Identifiable {
    let id: String
    let name: String
    let description: String
    let aliases: [String]?
    let acceptsArgs: Bool
}

struct ComposerSkillCatalog: Decodable {
    let catalog: [ComposerSkill]
}

struct ComposerSkill: Decodable, Identifiable {
    let name: String
    let description: String
    let enabled: Bool
    let localizations: [String: ComposerSkillLocalization]?

    var id: String {
        name
    }
}

struct ComposerSkillLocalization: Decodable {
    let displayName: String
    let description: String
}

struct ComposerPaletteItem: Identifiable {
    let id: String
    let title: String
    let detail: String
    let token: String
    let aliases: [String]

    private var bareID: String {
        if id.hasPrefix("skill:") { return String(id.dropFirst(6)) }
        if id.hasPrefix("command:") { return String(id.dropFirst(8)) }
        return id
    }

    func rank(for query: String) -> Int? {
        let needle = query.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        if needle.isEmpty { return 0 }
        let name = title.lowercased()
        let key = bareID.lowercased()
        let lowerAliases = aliases.map { $0.lowercased() }
        if name == needle || key == needle { return 0 }
        if lowerAliases.contains(needle) { return 1 }
        if name.hasPrefix(needle) || key.hasPrefix(needle) { return 2 }
        if lowerAliases.contains(where: { $0.hasPrefix(needle) }) { return 3 }
        if name.contains(needle) || key.contains(needle) { return 4 }
        if lowerAliases.contains(where: { $0.contains(needle) }) { return 5 }
        return detail.lowercased().contains(needle) ? 100 : nil
    }

    func matches(_ query: String) -> Bool {
        rank(for: query) != nil
    }
}

struct ComposerPaletteToken {
    let range: Range<String.Index>
    let query: String

    static func atCaret(in draft: String, utf16Offset: Int?) -> Self? {
        let offset = min(max(0, utf16Offset ?? draft.utf16.count), draft.utf16.count)
        guard let cursor = String.Index(draft.utf16.index(draft.utf16.startIndex, offsetBy: offset), within: draft),
              let start = draft[..<cursor].lastIndex(of: "/"),
              start == draft.startIndex || draft[draft.index(before: start)].isWhitespace
        else { return nil }
        let query = String(draft[draft.index(after: start) ..< cursor])
        guard !query.contains(where: \.isWhitespace), !query.hasPrefix("skill:") else { return nil }
        return Self(range: start ..< cursor, query: query)
    }
}
