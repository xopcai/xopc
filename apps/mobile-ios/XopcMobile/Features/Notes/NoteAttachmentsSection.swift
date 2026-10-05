import QuickLook
import SwiftUI

struct NoteAttachmentsSection: View {
    let configuration: GatewayConfiguration
    let noteID: String
    let attachments: [NoteAttachment]

    @State private var previewURL: URL?
    @State private var previewFileURL: URL?
    @State private var loadingAttachmentID: String?
    @State private var error: String?

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("附件").font(.headline)
            ForEach(attachments) { attachment in
                if attachment.mimeType.hasPrefix("audio/") {
                    NoteAudioPlayerView(
                        configuration: configuration,
                        noteID: noteID,
                        attachment: attachment
                    )
                } else {
                    Button {
                        Task { await open(attachment) }
                    } label: {
                        Label {
                            Text(attachment.fileName)
                                .fixedSize(horizontal: false, vertical: true)
                        } icon: {
                            Image(systemName: "paperclip")
                        }
                        .frame(maxWidth: .infinity, minHeight: 48, alignment: .leading)
                    }
                    .buttonStyle(.bordered)
                    .disabled(loadingAttachmentID != nil)
                }
                if let transcript = attachment.transcript?.trimmingCharacters(in: .whitespacesAndNewlines),
                   !transcript.isEmpty
                {
                    VStack(alignment: .leading, spacing: 4) {
                        Text("转写结果").font(.caption.weight(.semibold)).foregroundStyle(.secondary)
                        Text(transcript).textSelection(.enabled)
                    }
                }
            }
        }
        .quickLookPreview($previewURL)
        .onChange(of: previewURL) { _, newValue in
            if newValue == nil, let previewFileURL {
                try? FileManager.default.removeItem(at: previewFileURL.deletingLastPathComponent())
                self.previewFileURL = nil
            }
        }
        .alert("无法预览附件", isPresented: Binding(get: { error != nil }, set: {
            if !$0 {
                error = nil
            }
        })) {
            Button("好", role: .cancel) {}
        } message: { Text(error ?? "未知错误") }
    }

    @MainActor
    private func open(_ attachment: NoteAttachment) async {
        loadingAttachmentID = attachment.id
        defer { loadingAttachmentID = nil }
        do {
            let data = try await GatewayClient(configuration: configuration)
                .fetchNoteAttachment(noteID: noteID, attachmentID: attachment.id)
            let directory = FileManager.default.temporaryDirectory
                .appendingPathComponent("xopc-note-preview-\(UUID().uuidString.lowercased())", isDirectory: true)
            try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: false)
            let fileName = URL(fileURLWithPath: attachment.fileName).lastPathComponent
            let safeName = fileName.isEmpty || fileName == "." || fileName == ".." ? "attachment" : fileName
            let fileURL = directory.appendingPathComponent(safeName)
            do {
                try data.write(to: fileURL, options: .atomic)
            } catch {
                try? FileManager.default.removeItem(at: directory)
                throw error
            }
            previewFileURL = fileURL
            previewURL = fileURL
        } catch {
            self.error = error.localizedDescription
        }
    }
}
