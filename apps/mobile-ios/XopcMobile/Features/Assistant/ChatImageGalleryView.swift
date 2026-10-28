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
    @State private var imageOffset: CGSize = .zero
    @State private var viewportSize: CGSize = .zero
    @State private var pinchStartZoom: CGFloat?
    @State private var pinchStartOffset: CGSize = .zero
    @State private var dragStartOffset: CGSize?
    @GestureState private var isPinching = false

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
                            .offset(imageOffset)
                            .contentShape(Rectangle())
                            .gesture(MagnifyGesture()
                                .updating($isPinching) { _, active, _ in active = true }
                                .onChanged { value in
                                    if pinchStartZoom == nil {
                                        pinchStartZoom = zoom
                                        pinchStartOffset = imageOffset
                                    }
                                    let start = pinchStartZoom ?? zoom
                                    let next = min(3, max(1, start * value.magnification))
                                    let ratio = next / start
                                    let focal = CGSize(
                                        width: (value.startAnchor.x - 0.5) * geometry.size.width,
                                        height: (value.startAnchor.y - 0.5) * geometry.size.height
                                    )
                                    zoom = next
                                    imageOffset = bounded(CGSize(
                                        width: focal.width - (focal.width - pinchStartOffset.width) * ratio,
                                        height: focal.height - (focal.height - pinchStartOffset.height) * ratio
                                    ),
                                    image: image, viewport: geometry.size)
                                }
                                .onEnded { _ in pinchStartZoom = nil })
                            .simultaneousGesture(DragGesture(minimumDistance: 10).onChanged { value in
                                guard !isPinching, zoom > 1 else { return }
                                if dragStartOffset == nil {
                                    dragStartOffset = imageOffset
                                }
                                let start = dragStartOffset ?? .zero
                                imageOffset = bounded(CGSize(width: start.width + value.translation.width,
                                                             height: start.height + value.translation.height),
                                                      image: image, viewport: geometry.size)
                            }.onEnded { value in
                                defer { dragStartOffset = nil }
                                guard !isPinching, zoom == 1, abs(value.translation.width) > 60,
                                      abs(value.translation.width) > abs(value.translation.height) else { return }
                                move(value.translation.width < 0 ? 1 : -1)
                            })
                            .onTapGesture(count: 2) { location in
                                if zoom > 1 {
                                    zoom = 1; imageOffset = .zero
                                } else {
                                    zoom = 2
                                    imageOffset = bounded(CGSize(width: geometry.size.width / 2 - location.x,
                                                                 height: geometry.size.height / 2 - location.y),
                                                          image: image, viewport: geometry.size)
                                }
                            }
                            .onChange(of: isPinching) { _, active in
                                if !active {
                                    pinchStartZoom = nil; dragStartOffset = nil
                                }
                            }
                            .accessibilityLabel(items[index].title)
                    } else if let error {
                        ContentUnavailableView("图片无法显示", systemImage: "photo.badge.exclamationmark", description: Text(error))
                    } else {
                        ProgressView("正在加载图片…")
                    }
                }
                .frame(maxWidth: .infinity, maxHeight: .infinity)
                .clipped()
                .onAppear { viewportSize = geometry.size }
                .onChange(of: geometry.size) { _, newSize in
                    viewportSize = newSize
                    if let image {
                        imageOffset = bounded(imageOffset, image: image, viewport: newSize)
                    }
                }
            }
            .navigationTitle("图片")
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
                    Button("缩小", systemImage: "minus.magnifyingglass") { changeZoom(max(1, zoom - 0.5)) }
                        .disabled(zoom <= 1)
                    Button("放大", systemImage: "plus.magnifyingglass") { changeZoom(min(3, zoom + 0.5)) }
                        .disabled(zoom >= 3)
                }
                ToolbarItem(placement: .topBarTrailing) {
                    Button("关闭", systemImage: "xmark") { dismiss() }
                }
            }
            .task(id: index) { await load() }
        }
    }

    private func changeZoom(_ next: CGFloat) {
        let ratio = next / zoom
        imageOffset = CGSize(width: imageOffset.width * ratio, height: imageOffset.height * ratio)
        zoom = next
        if let image {
            imageOffset = bounded(imageOffset, image: image, viewport: viewportSize)
        }
        if next == 1 {
            imageOffset = .zero
        }
    }

    private func bounded(_ proposed: CGSize, image: UIImage, viewport: CGSize) -> CGSize {
        let fit = min(viewport.width / image.size.width, viewport.height / image.size.height)
        let limitX = max(0, (image.size.width * fit * zoom - viewport.width) / 2)
        let limitY = max(0, (image.size.height * fit * zoom - viewport.height) / 2)
        return CGSize(width: min(limitX, max(-limitX, proposed.width)),
                      height: min(limitY, max(-limitY, proposed.height)))
    }

    private func move(_ offset: Int) {
        let next = index + offset
        guard items.indices.contains(next) else { return }
        zoom = 1
        imageOffset = .zero
        pinchStartZoom = nil
        dragStartOffset = nil
        index = next
    }

    @MainActor private func load() async {
        guard items.indices.contains(index) else { return }
        image = nil
        error = nil
        zoom = 1
        imageOffset = .zero
        pinchStartZoom = nil
        dragStartOffset = nil
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
              let height = info[kCGImagePropertyPixelHeight] as? Int,
              width > 0, height > 0 else { return nil }
        let scale = min(1, 4096 / CGFloat(max(width, height)), sqrt(8_000_000 / (CGFloat(width) * CGFloat(height))))
        let options: [CFString: Any] = [
            kCGImageSourceCreateThumbnailFromImageAlways: true,
            kCGImageSourceCreateThumbnailWithTransform: true,
            kCGImageSourceThumbnailMaxPixelSize: max(1, Int(CGFloat(max(width, height)) * scale))
        ]
        return CGImageSourceCreateThumbnailAtIndex(source, 0, options as CFDictionary)
    }
}
