import ImageIO
import SwiftUI

struct ChatImageGalleryItem: Identifiable {
    let title: String
    let source: String
    var id: String {
        source
    }
}

struct ChatImageGalleryView: View {
    let items: [ChatImageGalleryItem]
    let configuration: GatewayConfiguration
    let conversationID: String?

    @Environment(\.dismiss) private var dismiss
    @State private var index: Int
    @State private var image: UIImage?
    @State private var error: String?
    @State private var zoom: CGFloat = 1

    init(items: [ChatImageGalleryItem], initialSource: String, configuration: GatewayConfiguration, conversationID: String?) {
        self.items = items
        self.configuration = configuration
        self.conversationID = conversationID
        _index = State(initialValue: items.firstIndex(where: { $0.source == initialSource }) ?? 0)
    }

    var body: some View {
        NavigationStack {
            GeometryReader { geometry in
                Group {
                    if let image {
                        Image(uiImage: image)
                            .resizable()
                            .scaledToFit()
                            .frame(width: geometry.size.width, height: geometry.size.height)
                            .scaleEffect(zoom)
                            .gesture(MagnifyGesture().onChanged { value in
                                zoom = min(3, max(1, value.magnification))
                            })
                            .simultaneousGesture(DragGesture(minimumDistance: 60).onEnded { value in
                                guard zoom == 1, abs(value.translation.width) > abs(value.translation.height) else { return }
                                move(value.translation.width < 0 ? 1 : -1)
                            })
                            .accessibilityLabel(items[index].title)
                    } else if let error {
                        ContentUnavailableView("图片无法显示", systemImage: "photo.badge.exclamationmark", description: Text(error))
                    } else {
                        ProgressView("正在加载图片…")
                    }
                }
                .frame(maxWidth: .infinity, maxHeight: .infinity)
                .clipped()
            }
            .navigationTitle(items.indices.contains(index) ? items[index].title : "图片")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarLeading) {
                    if items.count > 1 {
                        Button("上一张", systemImage: "chevron.left") { move(-1) }
                            .disabled(index == 0)
                    }
                }
                ToolbarItemGroup(placement: .bottomBar) {
                    if items.count > 1 {
                        Text("\(index + 1) / \(items.count)")
                        Button("下一张", systemImage: "chevron.right") { move(1) }
                            .disabled(index == items.count - 1)
                    }
                    Spacer()
                    Button("缩小", systemImage: "minus.magnifyingglass") { zoom = max(1, zoom - 0.5) }
                        .disabled(zoom <= 1)
                    Button("放大", systemImage: "plus.magnifyingglass") { zoom = min(3, zoom + 0.5) }
                        .disabled(zoom >= 3)
                }
                ToolbarItem(placement: .topBarTrailing) {
                    Button("关闭", systemImage: "xmark") { dismiss() }
                }
            }
            .task(id: index) { await load() }
        }
    }

    private func move(_ offset: Int) {
        let next = index + offset
        guard items.indices.contains(next) else { return }
        zoom = 1
        index = next
    }

    @MainActor private func load() async {
        guard items.indices.contains(index) else { return }
        image = nil
        error = nil
        zoom = 1
        guard let source = ChatImageSource.resolve(items[index].source, conversationID: conversationID) else {
            error = AppLocalization.resolve("图片地址无效")
            return
        }
        do {
            let data = try await ChatImageLoader(configuration: configuration).load(source)
            try Task.checkCancellation()
            let decoded = await Task.detached(priority: .utility) {
                Self.decodedImage(data)
            }.value
            try Task.checkCancellation()
            guard let decoded else { throw ChatImageError.invalidResponse }
            image = UIImage(cgImage: decoded)
        } catch is CancellationError {
        } catch {
            self.error = AppLocalization.resolve("请检查网络后重试")
        }
    }

    private nonisolated static func decodedImage(_ data: Data) -> CGImage? {
        guard let source = CGImageSourceCreateWithData(data as CFData, [kCGImageSourceShouldCache: false] as CFDictionary),
              let info = CGImageSourceCopyPropertiesAtIndex(source, 0, nil) as? [CFString: Any],
              let width = info[kCGImagePropertyPixelWidth] as? Int,
              let height = info[kCGImagePropertyPixelHeight] as? Int else { return nil }
        guard width > 0, height > 0 else { return nil }
        let scale = min(1, 4096 / CGFloat(max(width, height)), sqrt(8_000_000 / (CGFloat(width) * CGFloat(height))))
        let options: [CFString: Any] = [
            kCGImageSourceCreateThumbnailFromImageAlways: true,
            kCGImageSourceCreateThumbnailWithTransform: true,
            kCGImageSourceThumbnailMaxPixelSize: max(1, Int(CGFloat(max(width, height)) * scale))
        ]
        return CGImageSourceCreateThumbnailAtIndex(source, 0, options as CFDictionary)
    }
}
