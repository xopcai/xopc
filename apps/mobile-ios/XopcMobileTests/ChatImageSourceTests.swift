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

    @MainActor @Test func chatHistoryRestoresImageAndVoiceOnlyMessages() throws {
        let data = Data(#"""
        [
          {"id":"photo","role":"user","content":"","media":[{"id":"image-1","type":"image","name":"trip.png","mimeType":"image/png","size":128,"uri":"media://inbound/trip.png"}]},
          {"id":"voice","role":"user","content":"","media":[{"id":"audio-1","type":"audio","name":"voice.m4a","mimeType":"audio/mp4","size":256,"uri":"media://inbound/voice.m4a","duration":4.2}]}
        ]
        """#.utf8)
        let wire = try JSONDecoder().decode([WireMessage].self, from: data)
        let timeline = AssistantState.timeline(from: wire)

        #expect(timeline.count == 2)
        #expect(timeline[0].attachments.first?.isImage == true)
        #expect(timeline[0].attachments.first?.uri == "media://inbound/trip.png")
        #expect(timeline[1].attachments.first?.isAudio == true)
        #expect(timeline[1].attachments.first?.duration == 4.2)
    }

    @Test func legacyStringRawContentDoesNotDiscardHistory() throws {
        let data = Data(#"{"id":"legacy","role":"assistant","content":"Done","rawContent":"Done"}"#.utf8)
        let message = try JSONDecoder().decode(WireMessage.self, from: data)
        #expect(message.content.text == "Done")
        #expect(message.details.isEmpty)
    }

    @Test func chatHistoryKeepsDocumentResolutionAndPreviewText() throws {
        let data = Data(#"{"type":"file","name":"report.pdf","mimeType":"application/pdf","size":128,"workspaceRelativePath":"reports/report.pdf","extractedText":"Report summary"}"#.utf8)
        let attachment = try JSONDecoder().decode(HistoryAttachment.self, from: data)
        #expect(attachment.id == "reports/report.pdf")
        #expect(attachment.workspaceRelativePath == "reports/report.pdf")
        #expect(attachment.extractedText == "Report summary")
        #expect(attachment.isImage == false)
        #expect(attachment.isAudio == false)
    }

    @Test func chatAttachmentsMatchHarmonySizeLimits() throws {
        func attachment(size: Int) -> MessageAttachment {
            MessageAttachment(type: "file", name: "file.txt", mimeType: "text/plain", size: size, data: "")
        }
        #expect(throws: AttachmentImportError.self) {
            try AttachmentPolicy.validateChat(size: 10 * 1024 * 1024 + 1, current: [])
        }
        try AttachmentPolicy.validateChat(size: 10 * 1024 * 1024, current: [])
        #expect(throws: AttachmentImportError.self) {
            try AttachmentPolicy.validateChat(size: 1, current: [attachment(size: 20 * 1024 * 1024)])
        }
        #expect(throws: AttachmentImportError.self) {
            try AttachmentPolicy.validateChat(size: 1, current: Array(repeating: attachment(size: 1), count: 10))
        }
    }
}
