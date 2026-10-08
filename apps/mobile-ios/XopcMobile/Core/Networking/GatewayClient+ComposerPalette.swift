import Foundation

extension GatewayClient {
    func fetchComposerPalette(language: String) async throws -> [ComposerPaletteItem] {
        async let commandsRequest: GatewayEnvelope<ComposerCommandCatalog> = request(path: "/api/commands")
        async let skillsRequest: GatewayEnvelope<ComposerSkillCatalog> = request(path: "/api/skills")
        let (commands, skills) = try await (commandsRequest, skillsRequest)
        guard commands.isSuccessful, skills.isSuccessful,
              let commandCatalog = commands.payload, let skillCatalog = skills.payload else {
            throw GatewayClientError.server("无法读取命令与技能")
        }
        let skillItems = skillCatalog.catalog.filter(\.enabled).map { skill in
            let copy = skill.localizations?[language.hasPrefix("zh") ? "zh-CN" : "en"]
                ?? skill.localizations?["en"]
            return ComposerPaletteItem(
                id: "skill:\(skill.name)", title: copy?.displayName ?? skill.name,
                detail: copy?.description ?? skill.description,
                token: "/skill:\(skill.name) ",
                aliases: [skill.name] + (skill.localizations?.values.map(\.displayName) ?? [])
            )
        }
        let commandItems = commandCatalog.commands.map { command in
            ComposerPaletteItem(
                id: "command:\(command.id)", title: command.name, detail: command.description,
                token: "/\(command.name)\(command.acceptsArgs ? " " : "")",
                aliases: command.aliases ?? []
            )
        }
        return skillItems + commandItems
    }
}
