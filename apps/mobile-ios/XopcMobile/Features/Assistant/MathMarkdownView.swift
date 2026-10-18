import SwiftUI
import WebKit

struct MathMarkdownView: View {
    let markdown: String
    var streaming = false
    var display = false
    var fontSize = 16.0
    var enabled = true
    @Environment(\.chatTextSelectionEnabled) private var textSelectable
    @Environment(\.colorScheme) private var colorScheme
    @Environment(\.openURL) private var openURL
    @ScaledMetric private var fontScale = 1.0
    @State private var height = 48.0

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            if enabled {
                MathWebContent(markdown: markdown, streaming: streaming, dark: colorScheme == .dark,
                               fontSize: fontSize * fontScale, textSelectable: textSelectable, height: $height, onOpenLink: { url in openURL(url) })
                    .frame(height: height)
                    .accessibilityIdentifier("markdown-math")
            } else {
                Text(markdown).chatTextSelection(textSelectable)
            }
            if display {
                Button("复制公式源码") { UIPasteboard.general.string = markdown }
                    .font(.caption)
            }
        }
    }
}

private struct MathWebContent: UIViewRepresentable {
    let markdown: String
    let streaming: Bool
    let dark: Bool
    let fontSize: Double
    let textSelectable: Bool
    @Binding var height: Double
    let onOpenLink: (URL) -> Void

    func makeCoordinator() -> Coordinator {
        Coordinator(self)
    }

    func makeUIView(context: Context) -> WKWebView {
        let configuration = WKWebViewConfiguration()
        configuration.websiteDataStore = .nonPersistent()
        configuration.userContentController.add(context.coordinator, name: "math")
        if let folder = Bundle.main.resourceURL?.appendingPathComponent("Math"),
           let script = try? String(contentsOf: folder.appendingPathComponent("host.js"), encoding: .utf8)
        {
            configuration.userContentController.addUserScript(WKUserScript(source: script, injectionTime: .atDocumentEnd, forMainFrameOnly: true))
        }
        let view = WKWebView(frame: .zero, configuration: configuration)
        view.isOpaque = false
        view.backgroundColor = .clear
        view.scrollView.isScrollEnabled = false
        view.navigationDelegate = context.coordinator
        if let folder = Bundle.main.resourceURL?.appendingPathComponent("Math"),
           FileManager.default.fileExists(atPath: folder.appendingPathComponent("index.html").path)
        {
            view.loadFileURL(folder.appendingPathComponent("index.html"), allowingReadAccessTo: folder)
        }
        return view
    }

    func updateUIView(_ view: WKWebView, context: Context) {
        context.coordinator.parent = self
        context.coordinator.update(view)
    }

    static func dismantleUIView(_ view: WKWebView, coordinator _: Coordinator) {
        view.configuration.userContentController.removeScriptMessageHandler(forName: "math")
        view.stopLoading()
    }

    final class Coordinator: NSObject, WKScriptMessageHandler, WKNavigationDelegate {
        var parent: MathWebContent
        var loaded = false
        var revision = 0
        var lastPayload = ""
        init(_ parent: MathWebContent) {
            self.parent = parent
        }

        func update(_ view: WKWebView) {
            guard loaded else { return }
            let payload: [String: Any] = ["markdown": parent.markdown, "streaming": parent.streaming,
                                          "dark": parent.dark, "fontSize": parent.fontSize, "textSelectable": parent.textSelectable]
            guard let data = try? JSONSerialization.data(withJSONObject: payload, options: [.sortedKeys]),
                  let key = String(data: data, encoding: .utf8), key != lastPayload else { return }
            lastPayload = key
            revision += 1
            var next = payload
            next["revision"] = revision
            // Arguments are transferred by WebKit, never interpolated as JavaScript source.
            let script = "document.documentElement.style.webkitUserSelect = payload.textSelectable ? 'text' : 'none'; window.xopcMath.update(payload)"
            view.callAsyncJavaScript(script, arguments: ["payload": next], in: nil, in: .page, completionHandler: { _ in })
        }

        func webView(_ webView: WKWebView, didFinish _: WKNavigation!) {
            loaded = true; update(webView)
        }

        func webView(_: WKWebView, decidePolicyFor action: WKNavigationAction,
                     decisionHandler: @escaping (WKNavigationActionPolicy) -> Void)
        {
            decisionHandler(action.request.url?.isFileURL == true ? .allow : .cancel)
        }

        func userContentController(_: WKUserContentController, didReceive message: WKScriptMessage) {
            guard let string = message.body as? String, let data = string.data(using: .utf8),
                  let payload = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
                  let received = payload["revision"] as? Int, received == revision else { return }
            if let target = payload["href"] as? String, let url = URL(string: target),
               ["https", "http", "xopc"].contains(url.scheme ?? "")
            {
                parent.onOpenLink(url); return
            }
            guard let height = payload["height"] as? Double, height.isFinite else { return }
            parent.height = min(8192, max(24, height))
        }
    }
}
