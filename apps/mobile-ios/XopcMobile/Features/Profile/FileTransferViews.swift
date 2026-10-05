import SwiftUI
import UniformTypeIdentifiers

struct FileShareItem: Identifiable {
    let id = UUID()
    let url: URL
}

struct FileShareSheet: UIViewControllerRepresentable {
    let url: URL

    func makeUIViewController(context _: Context) -> UIActivityViewController {
        UIActivityViewController(activityItems: [url], applicationActivities: nil)
    }

    func updateUIViewController(_: UIActivityViewController, context _: Context) {}
}

struct FileUploadButton: View {
    let configuration: GatewayConfiguration
    let spaceID: String
    let directory: String
    let onUploaded: @MainActor () async -> Void

    @State private var isImporting = false
    @State private var isUploading = false
    @State private var error: String?
    @State private var selectedFile: SelectedFile?
    @State private var renameDraft = ""
    @State private var isRenamingConflict = false

    var body: some View {
        Button {
            isImporting = true
        } label: {
            if isUploading {
                ProgressView().accessibilityLabel("正在上传文件…")
            } else {
                Label("上传", systemImage: "plus")
            }
        }
        .disabled(isUploading)
        .fileImporter(isPresented: $isImporting, allowedContentTypes: [.item]) { result in
            if case let .failure(importError) = result {
                let nsError = importError as NSError
                if nsError.domain == NSCocoaErrorDomain, nsError.code == NSUserCancelledError {
                    return
                }
            }
            Task { await prepareUpload(result) }
        }
        .alert("上传失败", isPresented: Binding(get: { error != nil }, set: {
            if !$0 {
                error = nil
            }
        })) {
            if selectedFile != nil {
                Button("重试") { Task { await uploadSelected() } }
            }
            Button("取消", role: .cancel) {}
        } message: {
            Text(error ?? "未知错误")
        }
        .alert("同名文件已存在", isPresented: $isRenamingConflict) {
            TextField("文件名", text: $renameDraft)
            Button("改名上传") {
                guard FileUploadName.isValid(renameDraft), let selectedFile else { return }
                self.selectedFile = SelectedFile(name: renameDraft, mimeType: selectedFile.mimeType, data: selectedFile.data)
                Task { await uploadSelected() }
            }
            .disabled(!FileUploadName.isValid(renameDraft))
            Button("取消", role: .cancel) {}
        } message: {
            Text("输入新的文件名，原文件不会被覆盖。")
        }
    }

    @MainActor
    private func prepareUpload(_ result: Result<URL, Error>) async {
        do {
            let url = try result.get()
            let granted = url.startAccessingSecurityScopedResource()
            defer {
                if granted {
                    url.stopAccessingSecurityScopedResource()
                }
            }
            if let size = (try? url.resourceValues(forKeys: [.fileSizeKey]))?.fileSize,
               size > FileTransferLimit.uploadBytes
            {
                throw FileTransferError.tooLargeForUpload
            }
            let data = try Data(contentsOf: url)
            guard data.count <= FileTransferLimit.uploadBytes else { throw FileTransferError.tooLargeForUpload }
            selectedFile = SelectedFile(
                name: url.lastPathComponent,
                mimeType: UTType(filenameExtension: url.pathExtension)?.preferredMIMEType ?? "application/octet-stream",
                data: data
            )
            await uploadSelected()
        } catch {
            self.error = error.localizedDescription
        }
    }

    @MainActor
    private func uploadSelected() async {
        guard let selectedFile else { return }
        isUploading = true
        defer { isUploading = false }
        do {
            _ = try await GatewayClient(configuration: configuration).uploadFile(
                spaceID: spaceID,
                directory: directory,
                name: selectedFile.name,
                mimeType: selectedFile.mimeType,
                data: selectedFile.data
            )
            self.selectedFile = nil
            error = nil
            await onUploaded()
        } catch {
            if case GatewayClientError.http(statusCode: 409, message: _) = error {
                renameDraft = FileUploadName.suggestedAlternative(to: selectedFile.name)
                isRenamingConflict = true
            } else {
                self.error = FileUploadFailureMessage.resolve(error)
            }
        }
    }
}

private struct SelectedFile {
    let name: String
    let mimeType: String
    let data: Data
}
