import ImageIO
import SwiftUI

struct MarkdownImageView: View {
    let alt: String
    let source: String
    let configuration: GatewayConfiguration
    let conversationID: String?

    @Environment(\.displayScale) private var displayScale
    @State private var image: UIImage?
    @State private var isLoading = true
    @State private var failed = false
    @State private var showsPreview = false

    private var requestIdentity: RequestIdentity {
        RequestIdentity(source: source, configuration: configuration, conversationID: conversationID)
    }

    var body: some View {
        Group {
            if let image {
                Button {
                    showsPreview = true
                } label: {
                    Image(uiImage: image)
                        .resizable()
                        .scaledToFit()
                        .frame(maxWidth: 360, maxHeight: 300)
                        .clipShape(.rect(cornerRadius: 10))
                }
                .buttonStyle(.plain)
                .accessibilityLabel(alt.isEmpty ? "预览图片" : "预览图片：\(alt)")
            } else if isLoading {
                Label("正在加载图片…", systemImage: "photo")
                    .foregroundStyle(.secondary)
                    .frame(minHeight: 72)
            } else if failed {
                HStack {
                    Label("图片无法显示", systemImage: "photo.badge.exclamationmark")
                    Button("重试") { Task { await load() } }
                }
                .font(.caption)
                .foregroundStyle(.secondary)
                .frame(minHeight: 72)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .task(id: requestIdentity) { await load() }
        .sheet(isPresented: $showsPreview) {
            NavigationStack {
                ScrollView([.horizontal, .vertical]) {
                    if let image {
                        Image(uiImage: image).resizable().scaledToFit()
                            .frame(maxWidth: .infinity, maxHeight: .infinity)
                            .accessibilityLabel(alt.isEmpty ? "图片" : alt)
                    }
                }
                .navigationTitle(alt.isEmpty ? "图片" : alt)
                .navigationBarTitleDisplayMode(.inline)
                .toolbar {
                    ToolbarItem(placement: .topBarTrailing) {
                        Button("关闭", systemImage: "xmark") { showsPreview = false }
                    }
                }
            }
        }
    }

    @MainActor
    private func load() async {
        image = nil
        failed = false
        isLoading = true
        defer { isLoading = false }
        guard let reference = ChatImageSource.resolve(source, conversationID: conversationID) else {
            failed = true
            return
        }
        do {
            let data = try await ChatImageLoader(configuration: configuration).load(reference)
            try Task.checkCancellation()
            let maxPixel = Int(1600 * displayScale)
            guard let thumbnail = await Self.makeThumbnail(data, maxPixel: maxPixel) else {
                failed = true
                return
            }
            try Task.checkCancellation()
            image = UIImage(cgImage: thumbnail)
        } catch is CancellationError {
        } catch {
            failed = true
        }
    }

    private static func makeThumbnail(_ data: Data, maxPixel: Int) async -> CGImage? {
        await Task.detached(priority: .utility) {
            guard let source = CGImageSourceCreateWithData(data as CFData, [kCGImageSourceShouldCache: false] as CFDictionary) else {
                return nil
            }
            let options: [CFString: Any] = [
                kCGImageSourceCreateThumbnailFromImageAlways: true,
                kCGImageSourceCreateThumbnailWithTransform: true,
                kCGImageSourceThumbnailMaxPixelSize: maxPixel
            ]
            return CGImageSourceCreateThumbnailAtIndex(source, 0, options as CFDictionary)
        }.value
    }
}

private struct RequestIdentity: Hashable {
    let source: String
    let configuration: GatewayConfiguration
    let conversationID: String?
}
