import Foundation

enum MobileSettingsSection: String, Hashable {
    case language, appearance, notifications, about
}

enum ChatMessageLink: Equatable, Identifiable {
    case route(page: String, itemID: String)
    case workspaceFile(path: String)
    case managedFile(id: String)
    case mcpSetup(name: String, serverURL: String)

    var id: String {
        switch self {
        case let .route(page, itemID): "route:\(page):\(itemID)"
        case let .workspaceFile(path): "workspace:\(path)"
        case let .managedFile(id): "file:\(id)"
        case let .mcpSetup(name, serverURL): "mcp:\(name):\(serverURL)"
        }
    }

    static func resolve(_ raw: String) -> ChatMessageLink? {
        let trimmed = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty, trimmed.utf8.count <= 4096,
              !trimmed.contains("\\"), trimmed.rangeOfCharacter(from: .controlCharacters) == nil else { return nil }
        let source = trimmed.replacingOccurrences(of: "&amp;", with: "&")
        if source.hasPrefix("xopc-file:") {
            let encoded = String(source.dropFirst(10))
            guard !encoded.contains("?"), !encoded.contains("#"),
                  let id = encoded.removingPercentEncoding, validResourceID(id) else { return nil }
            return .managedFile(id: id)
        }
        let addressed = source.hasPrefix("#/") ? String(source.dropFirst()) : source
        guard let components = URLComponents(string: addressed),
              components.user == nil, components.password == nil, components.port == nil else { return nil }
        let query = Dictionary((components.queryItems ?? []).map { ($0.name, $0.value ?? "") },
                               uniquingKeysWith: { _, latest in latest })
        if (components.scheme == "xopc" && components.host == "workspace" && components.path == "/file") ||
            (components.scheme == nil && source.hasPrefix("/") && !source.hasPrefix("//") && components.path == "/xopc/workspace/file")
        {
            guard let path = query["path"], !path.isEmpty, validPath(path) else { return nil }
            return .workspaceFile(path: path)
        }
        if components.scheme == "xopc", components.host == "open", components.path.isEmpty || components.path == "/" {
            return openRoute(query)
        }
        if components.scheme == "xopc", components.host == "settings" {
            return settingsRoute(components.path)
        }
        if components.scheme == "xopc", components.host == "capabilities", components.path == "/mcp" {
            return mcpSetupRoute(query)
        }
        guard components.scheme == nil else { return nil }
        return relativeRoute(source, components: components, query: query)
    }

    private static func openRoute(_ query: [String: String]) -> ChatMessageLink? {
        if query["kind"] == "settings" {
            let id = query["id"] ?? ""
            if id.isEmpty {
                return .route(page: "settings", itemID: "")
            }
            guard let section = MobileSettingsSection(rawValue: id) else { return nil }
            return .route(page: "settings", itemID: section.rawValue)
        }
        let pages = ["note": "notes", "task": "tasks", "project": "projects", "session": "chat",
                     "automation": "automations", "file": "files"]
        guard let page = pages[query["kind"] ?? ""], let id = query["id"] ?? query["key"], validResourceID(id) else { return nil }
        return .route(page: page, itemID: id)
    }

    private static func mcpSetupRoute(_ query: [String: String]) -> ChatMessageLink? {
        guard let name = query["id"], name.wholeMatch(of: /[a-zA-Z0-9_-]{1,64}/) != nil,
              let serverURL = query["url"], serverURL.count <= 2048,
              !serverURL.contains(where: { $0.isWhitespace || $0.isNewline || $0 == "\\" }),
              serverURL.rangeOfCharacter(from: .controlCharacters) == nil,
              let url = URLComponents(string: serverURL), url.scheme == "https", url.host?.isEmpty == false,
              url.user == nil, url.password == nil, url.query == nil, url.fragment == nil else { return nil }
        return .mcpSetup(name: name, serverURL: serverURL)
    }

    private static func relativeRoute(_ source: String, components: URLComponents, query: [String: String]) -> ChatMessageLink? {
        guard (source.hasPrefix("/") && !source.hasPrefix("//")) || source.hasPrefix("#/") else { return nil }
        let path = components.path
        if path == "/settings" || path.hasPrefix("/settings/") {
            return settingsRoute(String(path.dropFirst("/settings".count)))
        }
        if path == "/automations", let id = query["run"], validResourceID(id) {
            return .route(page: "automation-run", itemID: id)
        }
        if path == "/automations", let id = query["automation"], validResourceID(id) {
            return .route(page: "automations", itemID: id)
        }
        let pieces = path.split(separator: "/", omittingEmptySubsequences: false)
        guard pieces.count >= 3, ["notes", "tasks", "projects", "chat", "sessions", "automations", "files"].contains(String(pieces[1])),
              let id = pieces.dropFirst(2).joined(separator: "/").removingPercentEncoding, validResourceID(id) else { return nil }
        return .route(page: pieces[1] == "sessions" ? "chat" : String(pieces[1]), itemID: id)
    }

    private static func settingsRoute(_ path: String) -> ChatMessageLink? {
        if path.isEmpty || path == "/" {
            return .route(page: "settings", itemID: "")
        }
        guard path.hasPrefix("/"), let section = MobileSettingsSection(rawValue: String(path.dropFirst())) else { return nil }
        return .route(page: "settings", itemID: section.rawValue)
    }

    static func externalURL(_ url: URL) -> Bool {
        guard let components = URLComponents(url: url, resolvingAgainstBaseURL: false),
              ["http", "https"].contains(components.scheme?.lowercased() ?? ""),
              components.host?.isEmpty == false, components.user == nil, components.password == nil,
              !url.absoluteString.contains("\\"), url.absoluteString.rangeOfCharacter(from: .controlCharacters) == nil else { return false }
        return true
    }

    static func validResourceID(_ id: String) -> Bool {
        !id.isEmpty && id != "." && id != ".." && !id.contains("/") && !id.contains("\\")
            && id.rangeOfCharacter(from: .controlCharacters) == nil
    }

    private static func validPath(_ path: String) -> Bool {
        !path.isEmpty && !path.hasPrefix("/") && !path.hasSuffix("/") && !path.contains("\\")
            && path.rangeOfCharacter(from: .controlCharacters) == nil
            && !path.split(separator: "/", omittingEmptySubsequences: false).contains { $0.isEmpty || $0 == "." || $0 == ".." }
    }
}
