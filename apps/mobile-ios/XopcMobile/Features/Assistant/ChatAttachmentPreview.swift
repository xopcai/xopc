import QuickLook
import SwiftUI
import WebKit

struct ChatAttachmentPreview: View {
    let attachment: HistoryAttachment
    let configuration: GatewayConfiguration
    let conversationID: String?

    @State private var previewURL: URL?
    @State private var temporaryDirectory: URL?
    @State private var isLoading = false
    @State private var error: String?
    @State private var showsExtractedText = false
    @State private var previewText: String?
    @State private var managedFile: FileResource?
    @State private var share: ChatManagedShare?

    private var isManaged: Bool {
        attachment.uri?.hasPrefix("xopc-file:") == true || attachment.workspaceRelativePath != nil
    }

    private var isMarkdown: Bool {
        let name = attachment.name?.lowercased() ?? ""
        return attachment.mimeType?.lowercased() == "text/markdown" ||
            name.hasSuffix(".md") || name.hasSuffix(".markdown")
    }

    private var isHTML: Bool {
        let name = attachment.name?.lowercased() ?? ""
        return attachment.mimeType?.lowercased().hasPrefix("text/html") == true ||
            name.hasSuffix(".html") || name.hasSuffix(".htm")
    }

    private var isTextPreview: Bool {
        let mime = attachment.mimeType?.lowercased() ?? ""
        let name = attachment.name?.lowercased() ?? ""
        return mime.hasPrefix("text/") || mime == "application/json" || mime == "application/xml" ||
            [".txt", ".md", ".markdown", ".json", ".jsonc", ".csv", ".xml", ".yaml", ".yml",
             ".toml", ".log", ".sql", ".swift", ".ts", ".js", ".py"].contains(where: name.hasSuffix)
    }

    var body: some View {
        Button {
            Task { await open() }
        } label: {
            Label(attachment.name ?? "附件", systemImage: "doc")
                .font(.caption)
                .lineLimit(1)
                .padding(.horizontal, 9)
                .frame(minHeight: 44)
                .background(Color.secondary.opacity(0.1), in: .capsule)
        }
        .buttonStyle(.plain)
        .disabled(isLoading)
        .accessibilityIdentifier("chat-attachment-preview-\(attachment.id)")
        .contextMenu {
            if isManaged {
                Button("打开文件详情", systemImage: "pencil") { Task { await openManagedFile() } }
                Button("创建分享链接", systemImage: "square.and.arrow.up") { Task { await createShare() } }
            }
        }
        .quickLookPreview($previewURL)
        .sheet(item: $managedFile) { file in
            NavigationStack {
                FilePreviewView(configuration: configuration, file: file)
                    .toolbar { Button("关闭") { managedFile = nil } }
            }
        }
        .sheet(item: $share) { item in
            NavigationStack {
                Form {
                    Section("分享链接") {
                        Text(item.url.absoluteString).textSelection(.enabled)
                        ShareLink(item: item.url) { Label("系统分享", systemImage: "square.and.arrow.up") }
                        Button("复制链接", systemImage: "doc.on.doc") {
                            UIPasteboard.general.url = item.url
                        }
                    }
                    Section("可访问范围") { Text(item.reachabilityText) }
                }
                .navigationTitle("文件分享")
                .toolbar { Button("关闭") { share = nil } }
            }
        }
        .sheet(isPresented: $showsExtractedText) {
            NavigationStack {
                ScrollView {
                    if isHTML {
                        SafeHTMLAttachmentView(html: previewText ?? "")
                            .frame(minHeight: 600)
                    } else if isMarkdown {
                        MarkdownBodyView(
                            parts: MarkdownBlock.parse(previewText ?? "").map(MarkdownPart.init),
                            configuration: configuration,
                            conversationID: conversationID
                        )
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .padding()
                    } else {
                        Text(previewText ?? attachment.extractedText ?? "")
                            .textSelection(.enabled)
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .padding()
                    }
                }
                .navigationTitle(attachment.name ?? "附件")
                .toolbar { Button("关闭") { showsExtractedText = false } }
            }
        }
        .onChange(of: previewURL) { _, value in
            if value == nil {
                removeTemporaryFile()
            }
        }
        .alert("无法预览附件", isPresented: Binding(
            get: { error != nil },
            set: {
                if !$0 {
                    error = nil
                }
            }
        )) {
            Button("好", role: .cancel) {}
        } message: {
            Text(error ?? "未知错误")
        }
    }

    @MainActor private func open() async {
        guard !isLoading else { return }
        if (attachment.uri ?? "").isEmpty, attachment.workspaceRelativePath == nil,
           attachment.extractedText?.isEmpty == false
        {
            previewText = attachment.extractedText
            showsExtractedText = true
            return
        }
        isLoading = true
        defer { isLoading = false }
        do {
            let bytes = try await ChatAttachmentLoader(configuration: configuration).load(
                attachment, conversationID: conversationID
            )
            try Task.checkCancellation()
            if isTextPreview {
                guard let text = String(data: bytes, encoding: .utf8) else {
                    throw ChatAttachmentPreviewError.unavailable
                }
                if isHTML, bytes.count > 4 * 1024 * 1024 {
                    throw ChatAttachmentPreviewError.htmlTooLarge
                }
                previewText = isHTML ? text : String(text.prefix(100_000))
                showsExtractedText = true
                return
            }
            removeTemporaryFile()
            let directory = FileManager.default.temporaryDirectory
                .appending(path: "xopc-chat-preview-\(UUID().uuidString)", directoryHint: .isDirectory)
            try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: false)
            let rawName = URL(fileURLWithPath: attachment.name ?? "attachment").lastPathComponent
            let name = rawName.isEmpty || rawName == "." || rawName == ".." ? "attachment" : rawName
            let fileURL = directory.appending(path: name)
            do {
                try bytes.write(to: fileURL, options: .atomic)
            } catch {
                try? FileManager.default.removeItem(at: directory)
                throw error
            }
            temporaryDirectory = directory
            previewURL = fileURL
        } catch is CancellationError {
        } catch {
            if let extracted = attachment.extractedText, !extracted.isEmpty {
                previewText = extracted
                showsExtractedText = true
            } else {
                self.error = error.localizedDescription
            }
        }
    }

    private func removeTemporaryFile() {
        if let temporaryDirectory {
            try? FileManager.default.removeItem(at: temporaryDirectory)
        }
        temporaryDirectory = nil
    }

    @MainActor private func openManagedFile() async {
        do {
            managedFile = try await ChatAttachmentLoader(configuration: configuration)
                .resolveManagedFile(attachment, conversationID: conversationID)
        } catch {
            self.error = error.localizedDescription
        }
    }

    @MainActor private func createShare() async {
        do {
            let request = try ChatManagedShareRequest(attachment: attachment, conversationID: conversationID)
            let gateway = GatewayClient(configuration: configuration)
            let response: ChatManagedShareEnvelope = try await gateway.request(
                path: "/api/shares/auto", method: "POST", body: JSONEncoder().encode(request)
            )
            guard response.ok, let payload = response.payload,
                  !payload.share.id.isEmpty,
                  ["public", "lan", "local-only"].contains(payload.share.reachability),
                  let url = URL(string: payload.share.shareUrl),
                  url.scheme == "https" || url.scheme == "http"
            else { throw ChatAttachmentPreviewError.unavailable }
            share = ChatManagedShare(
                id: payload.share.id,
                url: url,
                reachabilityText: payload.share.reachabilityText
            )
        } catch {
            self.error = error.localizedDescription
        }
    }
}

struct ChatAttachmentLoader: Sendable {
    static let byteLimit = ChatImageSource.byteLimit
    let configuration: GatewayConfiguration
    var session: URLSession = .shared

    func load(_ attachment: HistoryAttachment, conversationID: String?) async throws -> Data {
        let uri = try await resolvedURI(attachment, conversationID: conversationID)
        if uri.hasPrefix("data:"), let marker = uri.range(of: ";base64,") {
            let payload = String(uri[marker.upperBound...])
            guard payload.count <= Self.byteLimit * 4 / 3 + 4,
                  let data = Data(base64Encoded: payload), !data.isEmpty,
                  data.count <= Self.byteLimit
            else { throw ChatAttachmentPreviewError.tooLarge }
            return data
        }
        guard let source = ChatImageSource.resolve(uri, conversationID: conversationID),
              let request = source.request(configuration: configuration)
        else { throw ChatAttachmentPreviewError.unavailable }
        let (bytes, response) = try await session.bytes(for: request, delegate: ChatAttachmentRedirectBlocker())
        guard let response = response as? HTTPURLResponse, response.statusCode == 200 else {
            throw ChatAttachmentPreviewError.unavailable
        }
        guard response.expectedContentLength <= Self.byteLimit else {
            throw ChatAttachmentPreviewError.tooLarge
        }
        var data = Data()
        for try await byte in bytes {
            guard data.count < Self.byteLimit else { throw ChatAttachmentPreviewError.tooLarge }
            data.append(byte)
        }
        guard !data.isEmpty else { throw ChatAttachmentPreviewError.unavailable }
        return data
    }

    func resolveManagedFile(_ attachment: HistoryAttachment, conversationID: String?) async throws -> FileResource {
        let gateway = GatewayClient(configuration: configuration)
        if let uri = attachment.uri, uri.hasPrefix("xopc-file:"),
           let id = String(uri.dropFirst("xopc-file:".count)).removingPercentEncoding
        {
            let result: FileResourceEnvelope = try await gateway.request(path: "/api/files/\(id)")
            return result.resource
        }
        guard let path = attachment.workspaceRelativePath, !path.isEmpty,
              let conversationID, !conversationID.isEmpty else { throw ChatAttachmentPreviewError.unavailable }
        let context: ChatAttachmentSpace = try await gateway.request(
            path: "/api/files/contexts/session/\(conversationID)"
        )
        let body = try JSONEncoder().encode(ChatAttachmentResolution(spaceId: context.space.id, path: path))
        let result: FileResourceEnvelope = try await gateway.request(path: "/api/files/resolve", method: "POST", body: body)
        return result.resource
    }

    private func resolvedURI(_ attachment: HistoryAttachment, conversationID: String?) async throws -> String {
        if let uri = attachment.uri, !uri.isEmpty {
            return uri
        }
        let file = try await resolveManagedFile(attachment, conversationID: conversationID)
        return "xopc-file:\(file.id)"
    }
}

private struct ChatManagedShareRequest: Encodable {
    let fileId: String?
    let path: String?
    let conversationId: String?
    let audience = "friend"

    init(attachment: HistoryAttachment, conversationID: String?) throws {
        conversationId = conversationID
        if let uri = attachment.uri, uri.hasPrefix("xopc-file:"),
           let id = String(uri.dropFirst("xopc-file:".count)).removingPercentEncoding, !id.isEmpty
        {
            fileId = id
            path = nil
        } else if let relativePath = attachment.workspaceRelativePath, !relativePath.isEmpty,
                  conversationID != nil
        {
            fileId = nil
            path = relativePath
        } else {
            throw ChatAttachmentPreviewError.unavailable
        }
    }
}

private struct ChatManagedShareEnvelope: Decodable {
    let ok: Bool
    let payload: Payload?

    struct Payload: Decodable { let share: Share }
    struct Share: Decodable {
        let id: String
        let shareUrl: String
        let reachability: String
        let reachabilityHint: String?

        var reachabilityText: String {
            let label: String = switch reachability {
            case "public": AppLocalization.resolve("公网可访问")
            case "lan": AppLocalization.resolve("仅同一局域网可访问")
            default: AppLocalization.resolve("目前仅本机可访问")
            }
            return reachabilityHint.map { "\(label)\n\($0)" } ?? label
        }
    }
}

private struct ChatManagedShare: Identifiable {
    let id: String
    let url: URL
    let reachabilityText: String
}

private struct ChatAttachmentSpace: Decodable {
    let space: FileSpace
}

private struct ChatAttachmentResolution: Encodable {
    let spaceId: String
    let path: String
}

private enum ChatAttachmentPreviewError: LocalizedError {
    case unavailable, tooLarge, htmlTooLarge

    var errorDescription: String? {
        switch self {
        case .unavailable: AppLocalization.resolve("附件无法读取或已失效")
        case .tooLarge: AppLocalization.resolve("附件超过 16 MiB，无法在聊天中预览")
        case .htmlTooLarge: AppLocalization.resolve("HTML 文件超过 4 MiB，无法预览")
        }
    }
}

private final class ChatAttachmentRedirectBlocker: NSObject, URLSessionTaskDelegate, @unchecked Sendable {
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

private struct SafeHTMLAttachmentView: UIViewRepresentable {
    let html: String

    func makeCoordinator() -> Coordinator {
        Coordinator()
    }

    func makeUIView(context: Context) -> WKWebView {
        let configuration = WKWebViewConfiguration()
        configuration.websiteDataStore = .nonPersistent()
        configuration.defaultWebpagePreferences.allowsContentJavaScript = false
        let view = WKWebView(frame: .zero, configuration: configuration)
        view.navigationDelegate = context.coordinator
        view.isOpaque = false
        view.backgroundColor = .clear
        return view
    }

    func updateUIView(_ view: WKWebView, context _: Context) {
        let policy = "default-src 'none'; script-src 'none'; connect-src 'none'; img-src data:; " +
            "media-src data:; font-src data:; style-src 'unsafe-inline'; frame-src 'none'; " +
            "object-src 'none'; form-action 'none'; base-uri 'none'"
        let document = "<!doctype html><html><head><meta charset='utf-8'>" +
            "<meta name='viewport' content='width=device-width,initial-scale=1'>" +
            "<meta http-equiv='Content-Security-Policy' content=\"\(policy)\">" +
            "<style>body{margin:16px;overflow-wrap:anywhere}img,svg,video{max-width:100%;height:auto}</style>" +
            "</head><body>\(html)</body></html>"
        view.loadHTMLString(document, baseURL: nil)
    }

    final class Coordinator: NSObject, WKNavigationDelegate {
        func webView(
            _: WKWebView,
            decidePolicyFor action: WKNavigationAction,
            decisionHandler: @escaping @MainActor @Sendable (WKNavigationActionPolicy) -> Void
        ) {
            decisionHandler(action.request.url?.scheme == "about" ? .allow : .cancel)
        }
    }
}
