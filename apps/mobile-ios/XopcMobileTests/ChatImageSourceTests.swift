import Foundation
import Testing
@testable import XopcMobile

struct ChatImageSourceTests {
    private let configuration = GatewayConfiguration(
        baseURL: URL(string: "http://127.0.0.1:18790")!,
        token: "secret-token"
    )

    @Test func gatewayImagesUseAuthenticatedRoutes() throws {
        let references = [
            ("xopc-file:file%2Fone", "/api/files/file%2Fone/content"),
            ("xopc-attachment://notes/note-1/attachment-2", "/api/notes/note-1/media/attachment-2")
        ]
        for (source, path) in references {
            let request = ChatImageSource.resolve(source, conversationID: nil)?.request(configuration: configuration)
            #expect(try URLComponents(url: #require(request?.url), resolvingAgainstBaseURL: false)?.percentEncodedPath == path)
            #expect(request?.value(forHTTPHeaderField: "Authorization") == "Bearer secret-token")
        }
        let media = ChatImageSource.resolve("media://messages/image.png", conversationID: "chat-1")?
            .request(configuration: configuration)
        let query = try URLComponents(url: #require(media?.url), resolvingAgainstBaseURL: false)?.queryItems
        #expect(media?.url?.path == "/api/media/read")
        #expect(query?.first(where: { $0.name == "conversationId" })?.value == "chat-1")
        #expect(query?.first(where: { $0.name == "uri" })?.value == "media://messages/image.png")
    }

    @Test func externalImagesNeverReceiveGatewayCredentials() {
        let request = ChatImageSource.resolve("https://example.com/image.png", conversationID: "chat-1")?
            .request(configuration: configuration)
        #expect(request?.url?.host == "example.com")
        #expect(request?.value(forHTTPHeaderField: "Authorization") == nil)
        #expect(ChatImageSource.resolve("https://user@example.com/image.png", conversationID: nil) == nil)
        #expect(ChatImageSource.resolve("http://example.com/image.png", conversationID: nil) == nil)
        #expect(ChatImageSource.resolve("file:///private/image.png", conversationID: nil) == nil)
        #expect(ChatImageSource.resolve("media://messages/image.png", conversationID: nil) == nil)
    }

    @Test func embeddedImagesAreBoundedAndDoNotMakeRequests() {
        let source = ChatImageSource.resolve("data:image/png;base64,aGVsbG8=", conversationID: nil)
        guard case let .embedded(data)? = source else {
            Issue.record("Expected embedded image bytes")
            return
        }
        #expect(String(data: data, encoding: .utf8) == "hello")
        #expect(source?.request(configuration: configuration)?.url == nil)
        #expect(ChatImageSource.resolve("data:text/html;base64,aGVsbG8=", conversationID: nil) == nil)
    }
}
