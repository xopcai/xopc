import SwiftUI
import WebKit

@MainActor
final class ChartWebBudget: ObservableObject {
    static let shared = ChartWebBudget()
    @Published private(set) var active: Set<UUID> = []
    private var waiting: [UUID] = []

    func request(_ id: UUID, priority: Bool = false) {
        guard !active.contains(id) else { return }
        if !waiting.contains(id) {
            waiting.append(id)
        }
        if priority, active.count == 2, let displaced = active.first {
            active.remove(displaced); waiting.append(displaced)
            waiting.removeAll { $0 == id }; active.insert(id)
        }
        promote()
    }

    func release(_ id: UUID) {
        waiting.removeAll { $0 == id }; active.remove(id); promote()
    }

    private func promote() {
        while active.count < 2, !waiting.isEmpty {
            active.insert(waiting.removeFirst())
        }
    }
}

enum ChartSourcePolicy {
    static func allows(_ source: String) -> Bool {
        source.utf8.count <= 102_400
    }
}

@MainActor
private final class ChartWebHandle {
    weak var view: WKWebView?
    var shareRequested = false
}

struct ChartMarkdownView: View {
    let source: String
    let closed: Bool
    @Environment(\.colorScheme) private var colorScheme
    @Environment(\.scenePhase) private var scenePhase
    @ScaledMetric private var fontSize = 14.0
    @State private var id = UUID()
    @State private var visible = false
    @State private var inlinePresent = false
    @State private var previewPresent = false
    @State private var expanded = false
    @State private var showSource = false
    @State private var rendered = false
    @State private var failed = false
    @State private var height = 400.0
    @State private var shareItem: FileShareItem?
    @State private var handle = ChartWebHandle()
    @ObservedObject private var budget = ChartWebBudget.shared

    var body: some View {
        let screenBounds = UIScreen.main.bounds
        Group {
            if expanded {
                Text("图表已在预览中打开。").padding()
            } else {
                content(fullscreen: false)
            }
        }
        .background(Color.secondary.opacity(0.06), in: .rect(cornerRadius: 10))
        .accessibilityIdentifier("markdown-chart")
        .onGeometryChange(for: Bool.self) { geometry in
            geometry.frame(in: .global).intersects(screenBounds)
        } action: { value in visible = value; updateLease() }
        .onChange(of: closed) { _, _ in updateLease() }
        .onChange(of: source) { _, _ in rendered = false; failed = false; updateLease() }
        .onChange(of: expanded) { _, _ in updateLease() }
        .onChange(of: scenePhase) { _, _ in updateLease() }
        .onAppear { inlinePresent = true; updateLease() }
        .onDisappear { inlinePresent = false; updateLease() }
        .fullScreenCover(isPresented: $expanded) {
            ScrollView { content(fullscreen: true).padding(.top, 16) }
                .background(Color(uiColor: .systemBackground))
                .onAppear { previewPresent = true; updateLease() }
                .onDisappear { previewPresent = false; updateLease() }
                .sheet(item: $shareItem) { item in FileShareSheet(url: item.url) }
        }
        .sheet(item: Binding(get: { expanded ? nil : shareItem }, set: { shareItem = $0 })) { item in FileShareSheet(url: item.url) }
    }

    private func updateLease() {
        if visible || expanded, closed, ChartSourcePolicy.allows(source), scenePhase == .active {
            budget.request(id, priority: expanded)
        } else {
            budget.release(id)
        }
    }

    private func content(fullscreen: Bool) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                Button("复制数据") { UIPasteboard.general.string = source }
                Button(fullscreen ? "关闭" : "放大") { expanded = !fullscreen }
                Button("分享图片") {
                    handle.shareRequested = true
                    handle.view?.evaluateJavaScript("window.xopcChart.exportImage()", completionHandler: nil)
                }.disabled(!rendered)
                Button("源码") { showSource.toggle() }
            }.font(.caption).frame(minHeight: 44)
            if !closed {
                Text("等待图表数据完成…")
            } else if !ChartSourcePolicy.allows(source) {
                Text("图表数据超过 100 KiB，请缩小数据范围。")
            } else if failed {
                Text("图表加载失败，可重新打开预览或复制数据。")
                Button("重试") { failed = false }
            } else if budget.active.contains(id) {
                ChartWebContent(source: source, id: id.uuidString, dark: colorScheme == .dark,
                                fontSize: fontSize, expanded: fullscreen, handle: handle,
                                height: $height, rendered: $rendered, failed: $failed, onShare: { shareItem = $0 })
                    .frame(height: height)
            } else {
                Text("图表将在可见时加载；可点放大查看。").frame(height: height)
            }
            if showSource {
                Text(String(source.prefix(4096))).font(.caption.monospaced()).textSelection(.enabled)
            }
        }.padding(8)
    }
}

private struct ChartWebContent: UIViewRepresentable {
    let source: String
    let id: String
    let dark: Bool
    let fontSize: Double
    let expanded: Bool
    let handle: ChartWebHandle
    @Binding var height: Double
    @Binding var rendered: Bool
    @Binding var failed: Bool
    let onShare: (FileShareItem) -> Void

    func makeCoordinator() -> Coordinator {
        Coordinator(self)
    }

    func makeUIView(context: Context) -> WKWebView {
        let configuration = WKWebViewConfiguration()
        configuration.websiteDataStore = .nonPersistent()
        configuration.preferences.javaScriptCanOpenWindowsAutomatically = false
        configuration.userContentController.add(context.coordinator, name: "chart")
        let folder = Bundle.main.resourceURL!.appendingPathComponent("Charts")
        if let script = try? String(contentsOf: folder.appendingPathComponent("host.js"), encoding: .utf8) {
            configuration.userContentController.addUserScript(WKUserScript(source: script, injectionTime: .atDocumentEnd, forMainFrameOnly: true))
        }
        let view = WKWebView(frame: .zero, configuration: configuration)
        handle.view = view
        view.isOpaque = false; view.backgroundColor = .clear
        view.scrollView.isScrollEnabled = false
        view.navigationDelegate = context.coordinator
        view.loadFileURL(folder.appendingPathComponent("index.html"), allowingReadAccessTo: folder)
        return view
    }

    func updateUIView(_ view: WKWebView, context: Context) {
        context.coordinator.parent = self; context.coordinator.update(view)
    }

    static func dismantleUIView(_ view: WKWebView, coordinator: Coordinator) {
        coordinator.loaded = false
        if coordinator.parent.handle.view === view {
            coordinator.parent.handle.view = nil; coordinator.parent.handle.shareRequested = false
        }
        view.configuration.userContentController.removeScriptMessageHandler(forName: "chart")
        view.stopLoading()
    }

    final class Coordinator: NSObject, WKScriptMessageHandler, WKNavigationDelegate {
        var parent: ChartWebContent
        var loaded = false
        var revision = 0
        private var previous = ""
        init(_ parent: ChartWebContent) {
            self.parent = parent
        }

        func update(_ view: WKWebView) {
            guard loaded else { return }
            var payload: [String: Any] = ["id": parent.id, "source": parent.source, "dark": parent.dark,
                                          "fontSize": parent.fontSize, "expanded": parent.expanded]
            guard let data = try? JSONSerialization.data(withJSONObject: payload, options: [.sortedKeys]),
                  let key = String(data: data, encoding: .utf8), key != previous else { return }
            previous = key; revision += 1; payload["revision"] = revision
            parent.handle.shareRequested = false
            view.callAsyncJavaScript("window.xopcChart.update(payload)", arguments: ["payload": payload], in: nil, in: .page, completionHandler: { _ in })
        }

        func webView(_ view: WKWebView, didFinish _: WKNavigation!) {
            loaded = true; update(view)
        }

        func webView(_: WKWebView, decidePolicyFor action: WKNavigationAction, decisionHandler: @escaping @MainActor @Sendable (WKNavigationActionPolicy) -> Void) {
            let expected = Bundle.main.resourceURL!.appendingPathComponent("Charts/index.html").standardizedFileURL
            decisionHandler(action.request.url?.standardizedFileURL == expected ? .allow : .cancel)
        }

        func webView(_ view: WKWebView, didFailProvisionalNavigation _: WKNavigation!, withError _: Error) {
            fail(view)
        }

        func webView(_ view: WKWebView, didFail _: WKNavigation!, withError _: Error) {
            fail(view)
        }

        func webViewWebContentProcessDidTerminate(_ view: WKWebView) {
            fail(view)
        }

        private func fail(_ view: WKWebView) {
            guard parent.handle.view === view else { return }
            loaded = false; parent.rendered = false; parent.failed = true
        }

        func userContentController(_: WKUserContentController, didReceive message: WKScriptMessage) {
            guard loaded, let string = message.body as? String, string.utf8.count <= 12 * 1024 * 1024,
                  let data = string.data(using: .utf8),
                  let value = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
                  value["id"] as? String == parent.id, value["revision"] as? Int == revision else { return }
            switch value["type"] as? String {
            case "height":
                if let height = value["height"] as? Double, height.isFinite {
                    parent.height = min(1600, max(100, height))
                }
            case "rendered": parent.rendered = true
            case "error": parent.rendered = false
            case "image":
                guard parent.handle.shareRequested else { return }
                parent.handle.shareRequested = false
                guard let image = value["data"] as? String, image.hasPrefix("data:image/png;base64,"),
                      let bytes = Data(base64Encoded: String(image.dropFirst(22))), bytes.count <= 8 * 1024 * 1024 else { return }
                storeSharedImage(bytes)
            default: break
            }
        }

        private func storeSharedImage(_ bytes: Data) {
            let directory = FileManager.default.temporaryDirectory.appendingPathComponent("charts")
            do {
                try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
                let files = (try? FileManager.default.contentsOfDirectory(at: directory, includingPropertiesForKeys: [.contentModificationDateKey])) ?? []
                for old in files.sorted(by: { $0.lastPathComponent < $1.lastPathComponent }).dropLast(9) {
                    try? FileManager.default.removeItem(at: old)
                }
                let url = directory.appendingPathComponent(UUID().uuidString + ".png")
                try bytes.write(to: url, options: .atomic)
                parent.onShare(FileShareItem(url: url))
            } catch { parent.rendered = false }
        }
    }
}
