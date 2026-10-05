import Foundation

enum ChatImageSource: Equatable, Sendable {
    static let byteLimit = 16 * 1024 * 1024

    case embedded(Data)
    case gateway(path: String, query: [URLQueryItem])
    case external(URL)

    static func resolve(_ raw: String, conversationID: String?) -> ChatImageSource? {
        if raw.hasPrefix("data:image/") {
            guard let separator = raw.range(of: ";base64,"),
                  raw[..<separator.lowerBound].range(of: #"^data:image/[A-Za-z0-9.+-]+$"#, options: .regularExpression) != nil,
                  raw.distance(from: separator.upperBound, to: raw.endIndex) <= byteLimit * 4 / 3 + 4,
                  let bytes = Data(base64Encoded: String(raw[separator.upperBound...])), bytes.count <= byteLimit
            else { return nil }
            return .embedded(bytes)
        }
        if raw.hasPrefix("xopc-file:") {
            guard let id = encodedSegment(String(raw.dropFirst("xopc-file:".count))) else { return nil }
            return .gateway(path: "/api/files/\(id)/content", query: [])
        }
        if raw.hasPrefix("xopc-attachment://notes/") {
            let suffix = String(raw.dropFirst("xopc-attachment://notes/".count))
            let components = suffix.split(separator: "/", omittingEmptySubsequences: false)
            guard components.count == 2,
                  let noteID = encodedSegment(String(components[0])),
                  let attachmentID = encodedSegment(String(components[1]))
            else { return nil }
            return .gateway(path: "/api/notes/\(noteID)/media/\(attachmentID)", query: [])
        }
        if raw.hasPrefix("media://") {
            guard let conversationID, !conversationID.isEmpty else { return nil }
            return .gateway(path: "/api/media/read", query: [
                URLQueryItem(name: "uri", value: raw),
                URLQueryItem(name: "conversationId", value: conversationID)
            ])
        }
        guard raw.hasPrefix("https://"), !raw.unicodeScalars.contains(where: { CharacterSet.whitespacesAndNewlines.contains($0) || CharacterSet.controlCharacters.contains($0) || $0 == "\\" }),
              let components = URLComponents(string: raw), components.scheme == "https",
              let host = components.host, !host.isEmpty, components.user == nil, components.password == nil,
              let url = components.url
        else { return nil }
        return .external(url)
    }

    func request(configuration: GatewayConfiguration) -> URLRequest? {
        switch self {
        case .embedded:
            return nil
        case let .gateway(path, query):
            guard var components = URLComponents(url: configuration.baseURL, resolvingAgainstBaseURL: false) else { return nil }
            components.percentEncodedPath = components.percentEncodedPath.trimmingCharacters(in: CharacterSet(charactersIn: "/")) + path
            if !components.percentEncodedPath.hasPrefix("/") {
                components.percentEncodedPath = "/" + components.percentEncodedPath
            }
            components.queryItems = query.isEmpty ? nil : query
            guard let url = components.url else { return nil }
            var request = URLRequest(url: url)
            if !configuration.token.isEmpty {
                request.setValue("Bearer \(configuration.token)", forHTTPHeaderField: "Authorization")
            }
            return request
        case let .external(url):
            return URLRequest(url: url)
        }
    }

    private static func encodedSegment(_ raw: String) -> String? {
        guard let decoded = raw.removingPercentEncoding, !decoded.isEmpty,
              !decoded.unicodeScalars.contains(where: CharacterSet.controlCharacters.contains)
        else { return nil }
        return decoded.addingPercentEncoding(withAllowedCharacters: CharacterSet(charactersIn: "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-._~"))
    }
}
