import PhotosUI
import SwiftUI
import UIKit
import UniformTypeIdentifiers

enum AttachmentPolicy {
    static let maximumCount = 10
    static let maximumBytes = 32 * 1024 * 1024
}

struct AttachmentPickerModifier: ViewModifier {
    @Binding var attachments: [MessageAttachment]
    @Binding var errorMessage: String?
    @Binding var showingPhotoPicker: Bool
    @Binding var showingFilePicker: Bool
    @Binding var showingCameraPicker: Bool

    @State private var photoItems: [PhotosPickerItem] = []

    func body(content: Content) -> some View {
        content
            .photosPicker(
                isPresented: $showingPhotoPicker,
                selection: $photoItems,
                maxSelectionCount: max(AttachmentPolicy.maximumCount - attachments.count, 1),
                matching: .images
            )
            .fileImporter(
                isPresented: $showingFilePicker,
                allowedContentTypes: [.item],
                allowsMultipleSelection: true,
                onCompletion: importFiles
            )
            .fullScreenCover(isPresented: $showingCameraPicker) {
                CameraPickerView { image in
                    showingCameraPicker = false
                    importCameraImage(image)
                } onCancel: {
                    showingCameraPicker = false
                }
                .ignoresSafeArea()
            }
            .onChange(of: photoItems) {
                guard !photoItems.isEmpty else { return }
                Task { await importPhotos(photoItems) }
            }
    }

    @MainActor
    private func importCameraImage(_ image: UIImage) {
        guard let data = image.jpegData(compressionQuality: 0.86) else {
            errorMessage = "无法读取拍摄的照片"
            return
        }
        do {
            try append(data: data, name: "相机-\(Int(Date().timeIntervalSince1970)).jpg", contentType: .jpeg)
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    @MainActor
    private func importPhotos(_ items: [PhotosPickerItem]) async {
        errorMessage = nil
        defer { photoItems = [] }
        for (index, item) in items.enumerated() {
            guard attachments.count < AttachmentPolicy.maximumCount else {
                errorMessage = "最多添加 \(AttachmentPolicy.maximumCount) 个附件"
                return
            }
            do {
                guard let data = try await item.loadTransferable(type: Data.self) else {
                    throw AttachmentImportError.unreadable
                }
                let contentType = item.supportedContentTypes.first ?? .jpeg
                try append(
                    data: data,
                    name: "照片-\(attachments.count + index + 1).\(contentType.preferredFilenameExtension ?? "jpg")",
                    contentType: contentType
                )
            } catch {
                errorMessage = error.localizedDescription
            }
        }
    }

    @MainActor
    private func importFiles(_ result: Result<[URL], Error>) {
        errorMessage = nil
        do {
            for url in try result.get() {
                guard attachments.count < AttachmentPolicy.maximumCount else {
                    throw AttachmentImportError.tooMany
                }
                let grantedAccess = url.startAccessingSecurityScopedResource()
                defer {
                    if grantedAccess {
                        url.stopAccessingSecurityScopedResource()
                    }
                }
                let data = try Data(contentsOf: url)
                let contentType = UTType(filenameExtension: url.pathExtension) ?? .data
                try append(data: data, name: url.lastPathComponent, contentType: contentType)
            }
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    @MainActor
    private func append(data: Data, name: String, contentType: UTType) throws {
        guard data.count <= AttachmentPolicy.maximumBytes else {
            throw AttachmentImportError.tooLarge
        }
        attachments.append(MessageAttachment(
            type: contentType.conforms(to: .image) ? "image" : "file",
            name: name,
            mimeType: contentType.preferredMIMEType ?? "application/octet-stream",
            size: data.count,
            data: data.base64EncodedString()
        ))
    }
}

private struct CameraPickerView: UIViewControllerRepresentable {
    let onImage: (UIImage) -> Void
    let onCancel: () -> Void

    func makeCoordinator() -> Coordinator {
        Coordinator(onImage: onImage, onCancel: onCancel)
    }

    func makeUIViewController(context: Context) -> UIViewController {
        guard UIImagePickerController.isSourceTypeAvailable(.camera) else {
            return UIHostingController(rootView: CameraUnavailableView(onClose: onCancel))
        }
        let picker = UIImagePickerController()
        picker.sourceType = .camera
        picker.delegate = context.coordinator
        return picker
    }

    func updateUIViewController(_: UIViewController, context _: Context) {}

    @MainActor
    final class Coordinator: NSObject, UIImagePickerControllerDelegate, UINavigationControllerDelegate {
        let onImage: (UIImage) -> Void
        let onCancel: () -> Void

        init(onImage: @escaping (UIImage) -> Void, onCancel: @escaping () -> Void) {
            self.onImage = onImage
            self.onCancel = onCancel
        }

        func imagePickerController(
            _: UIImagePickerController,
            didFinishPickingMediaWithInfo info: [UIImagePickerController.InfoKey: Any]
        ) {
            guard let image = info[.originalImage] as? UIImage else {
                onCancel()
                return
            }
            onImage(image)
        }

        func imagePickerControllerDidCancel(_: UIImagePickerController) {
            onCancel()
        }
    }
}

private struct CameraUnavailableView: View {
    let onClose: () -> Void

    var body: some View {
        NavigationStack {
            ContentUnavailableView(
                "相机不可用",
                systemImage: "camera.fill",
                description: Text("当前设备或模拟器不支持相机。")
            )
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("关闭", action: onClose)
                }
            }
        }
    }
}

private enum AttachmentImportError: LocalizedError {
    case unreadable
    case tooLarge
    case tooMany

    var errorDescription: String? {
        switch self {
        case .unreadable:
            "无法读取所选附件"
        case .tooLarge:
            "单个附件不能超过 32 MiB"
        case .tooMany:
            "最多添加 10 个附件"
        }
    }
}
