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

    var id: String { name }
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

    func matches(_ query: String) -> Bool {
        query.isEmpty || ([title, id] + aliases).contains { $0.localizedCaseInsensitiveContains(query) }
    }
}
