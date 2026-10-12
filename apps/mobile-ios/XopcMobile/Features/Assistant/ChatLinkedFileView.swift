import SwiftUI

struct ChatLinkedFileView: View {
    let link: ChatMessageLink
    let configuration: GatewayConfiguration
    let conversationID: String?
    @State private var file: FileResource?
    @State private var error: String?

    var body: some View {
        Group {
            if let file {
                FilePreviewView(configuration: configuration, file: file)
            } else if let error {
                Label(error, systemImage: "exclamationmark.triangle").foregroundStyle(.secondary).padding()
            } else {
                VStack(spacing: 12) {
                    ForEach(0 ..< 4) { _ in RoundedRectangle(cornerRadius: 8).fill(.quaternary).frame(height: 40) }
                }.padding()
            }
        }
        .task(id: link) {
            file = nil
            error = nil
            let uri: String?
            let path: String?
            switch link {
            case let .managedFile(id): uri = "xopc-file:\(id)"; path = nil
            case let .workspaceFile(relative): uri = nil; path = relative
            case let .route(_, id): uri = "xopc-file:\(id)"; path = nil
            }
            let attachment = HistoryAttachment(mediaID: uri, type: "file", name: path ?? "文件", mimeType: nil,
                                               size: nil, uri: uri, duration: nil, workspaceRelativePath: path, extractedText: nil)
            do {
                let resolved = try await ChatAttachmentLoader(configuration: configuration)
                    .resolveManagedFile(attachment, conversationID: conversationID)
                guard !Task.isCancelled else { return }
                file = resolved
            } catch is CancellationError { } catch {
                guard !Task.isCancelled else { return }
                self.error = error.localizedDescription
            }
        }
    }
}
