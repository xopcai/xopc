import Foundation

struct ChatImageLoader: Sendable {
    let configuration: GatewayConfiguration
    let session: URLSession

    init(configuration: GatewayConfiguration, session: URLSession = .shared) {
        self.configuration = configuration
        self.session = session
    }

    func load(_ source: ChatImageSource) async throws -> Data {
        if case let .embedded(data) = source {
            return data
        }
        guard let request = source.request(configuration: configuration) else { throw ChatImageError.invalidSource }
        let (bytes, response) = try await session.bytes(for: request, delegate: ChatImageRedirectBlocker())
        guard let response = response as? HTTPURLResponse, response.statusCode == 200,
              response.value(forHTTPHeaderField: "Content-Type")?.lowercased().hasPrefix("image/") == true
        else { throw ChatImageError.invalidResponse }
        guard response.expectedContentLength <= ChatImageSource.byteLimit else { throw ChatImageError.tooLarge }
        var data = Data()
        if response.expectedContentLength > 0 {
            data.reserveCapacity(Int(response.expectedContentLength))
        }
        for try await byte in bytes {
            guard data.count < ChatImageSource.byteLimit else { throw ChatImageError.tooLarge }
            data.append(byte)
        }
        guard !data.isEmpty else { throw ChatImageError.invalidResponse }
        return data
    }
}

enum ChatImageError: Error {
    case invalidSource
    case invalidResponse
    case tooLarge
}

private final class ChatImageRedirectBlocker: NSObject, URLSessionTaskDelegate, @unchecked Sendable {
    func urlSession(
        _: URLSession,
        task _: URLSessionTask,
        willPerformHTTPRedirection _: HTTPURLResponse,
        newRequest _: URLRequest,
        completionHandler: @escaping (URLRequest?) -> Void
    ) {
        completionHandler(nil)
    }
}
