import SwiftUI
import UIKit
import UniformTypeIdentifiers

@MainActor
final class ShareViewController: UIViewController {
    override func viewDidLoad() {
        super.viewDidLoad()
        let host = UIHostingController(rootView: ShareIntakeView(context: extensionContext))
        addChild(host)
        host.view.frame = view.bounds
        host.view.autoresizingMask = [.flexibleWidth, .flexibleHeight]
        view.addSubview(host.view)
        host.didMove(toParent: self)
    }
}

private struct ShareIntakeView: View {
    let context: NSExtensionContext?
    @State private var batch = ExternalIntakeStore().newBatch()
    @State private var receiving = true
    @State private var errorMessage: String?

    var body: some View {
        NavigationStack {
            List {
                Section("添加到 xopc") {
                    ForEach(batch.files) { file in Label(file.name, systemImage: file.mimeType.hasPrefix("image/") ? "photo" : "doc") }
                    ForEach(batch.errors.indices, id: \.self) { index in Text(batch.errors[index]).foregroundStyle(.red) }
                    if receiving { RoundedRectangle(cornerRadius: 8).fill(.quaternary).frame(height: 48).redacted(reason: .placeholder) }
                }
                Section { Text("保存后，打开 xopc 选择新对话或已有对话。文件会加入输入框，由你确认发送。") }
                if let errorMessage { Text(errorMessage).foregroundStyle(.red) }
            }
            .navigationTitle("分享到 xopc")
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("取消") {
                        try? ExternalIntakeStore().remove(batch.id)
                        context?.cancelRequest(withError: CocoaError(.userCancelled))
                    }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("保存草稿") {
                        do {
                            try ExternalIntakeStore().save(batch)
                            context?.completeRequest(returningItems: nil)
                        } catch { errorMessage = error.localizedDescription }
                    }.disabled(receiving || batch.files.isEmpty)
                }
            }
            .task { await receive() }
        }
    }

    @MainActor private func receive() async {
        guard receiving else { return }
        let store = ExternalIntakeStore()
        for item in context?.inputItems as? [NSExtensionItem] ?? [] {
            for provider in item.attachments ?? [] {
                guard let type = provider.registeredTypeIdentifiers.first(where: {
                    UTType($0)?.conforms(to: .data) == true
                }) else { continue }
                do {
                    let batchID = batch.id
                    let file = try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<ExternalIntakeFile, Error>) in
                        provider.loadFileRepresentation(forTypeIdentifier: type) { url, error in
                            do {
                                if let error { throw error }
                                guard let url else { throw CocoaError(.fileReadUnknown) }
                                continuation.resume(returning: try store.capture(url, into: batchID))
                            } catch { continuation.resume(throwing: error) }
                        }
                    }
                    guard !Task.isCancelled else { try? store.remove(batch.id); return }
                    batch.files.append(file)
                } catch { batch.errors.append(error.localizedDescription) }
            }
        }
        receiving = false
    }
}
