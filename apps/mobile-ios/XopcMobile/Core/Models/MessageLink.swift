import Foundation

enum ChatMessageLink: Equatable, Identifiable {
    case route(page: String, itemID: String)
    case workspaceFile(path: String)
    case managedFile(id: String)

    var id: String {
        switch self {
        case let .route(page, itemID): "route:\(page):\(itemID)"
        case let .workspaceFile(path): "workspace:\(path)"
        case let .managedFile(id): "file:\(id)"
        }
    }

    static func resolve(_ raw: String) -> ChatMessageLink? {
        guard !raw.contains("\\"), raw.rangeOfCharacter(from: .controlCharacters) == nil else { return nil }
        let source = raw.replacingOccurrences(of: "&amp;", with: "&")
        let addressed = source.hasPrefix("#/") ? String(source.dropFirst()) : source
        guard let components = URLComponents(string: addressed) else { return nil }
        let query = Dictionary((components.queryItems ?? []).map { ($0.name, $0.value ?? "") },
                               uniquingKeysWith: { _, latest in latest })
        if source.hasPrefix("xopc-file:"), let id = String(source.dropFirst(10)).removingPercentEncoding,
           validID(id) { return .managedFile(id: id) }
        if (components.scheme == "xopc" && components.host == "workspace" && components.path == "/file") ||
            (components.scheme == nil && source.hasPrefix("/") && !source.hasPrefix("//") && components.path == "/xopc/workspace/file") {
            guard let path = query["path"], !path.isEmpty, validPath(path) else { return nil }
            return .workspaceFile(path: path)
        }
        if components.scheme == "xopc", components.host == "open" {
            let pages = ["note": "notes", "task": "tasks", "project": "projects", "session": "chat",
                         "automation": "automations", "workflow_run": "workflows", "file": "files"]
            guard let page = pages[query["kind"] ?? ""], let id = query["id"] ?? query["key"], validID(id) else { return nil }
            return .route(page: page, itemID: id)
        }
        return relativeRoute(source, components: components, query: query)
    }

    private static func relativeRoute(_ source: String, components: URLComponents, query: [String: String]) -> ChatMessageLink? {
        guard (source.hasPrefix("/") && !source.hasPrefix("//")) || source.hasPrefix("#/") else { return nil }
        let path = components.path
        if path == "/automations", let id = query["automation"], validID(id) {
            return .route(page: "automations", itemID: id)
        }
        if path.hasPrefix("/workflows/runs/"),
           let id = String(path.dropFirst("/workflows/runs/".count)).removingPercentEncoding, validID(id) {
            return .route(page: "workflows", itemID: id)
        }
        let pieces = path.split(separator: "/", omittingEmptySubsequences: false)
        guard pieces.count >= 3, ["notes", "tasks", "projects", "chat", "sessions", "automations", "workflows", "files"].contains(String(pieces[1])),
              let id = pieces.dropFirst(2).joined(separator: "/").removingPercentEncoding, validID(id) else { return nil }
        return .route(page: pieces[1] == "sessions" ? "chat" : String(pieces[1]), itemID: id)
    }

    static func externalURL(_ url: URL) -> Bool {
        guard let components = URLComponents(url: url, resolvingAgainstBaseURL: false),
              ["http", "https"].contains(components.scheme?.lowercased() ?? ""),
              components.host?.isEmpty == false, components.user == nil, components.password == nil,
              !url.absoluteString.contains("\\"), url.absoluteString.rangeOfCharacter(from: .controlCharacters) == nil else { return false }
        return true
    }

    private static func validID(_ id: String) -> Bool { !id.isEmpty && !id.contains("/") && validPath(id) }
    private static func validPath(_ path: String) -> Bool {
        !path.contains("\\") && path.rangeOfCharacter(from: .controlCharacters) == nil && !path.split(separator: "/").contains("..")
    }
}
