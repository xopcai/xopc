import Cocoa

// Disposable benchmark; only the optional private oracle file is written.
final class InputBenchmark: NSObject, NSApplicationDelegate {
    let status = NSTextField(labelWithString: "Input count 0")
    var count = 0
    var window: NSWindow!
    let field = NSTextField(frame: NSRect(x: 100, y: 140, width: 440, height: 40))
    @objc func increment() {
        count += 1
        status.stringValue = "Input count \(count)"
        window.makeFirstResponder(nil)
    }
    func applicationDidFinishLaunching(_ notification: Notification) {
        window = NSWindow(contentRect: NSRect(x: 150, y: 150, width: 640, height: 400),
                          styleMask: [.titled, .closable], backing: .buffered, defer: false)
        window.title = "XOPC Native Input Benchmark"
        window.collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary]
        let button = NSButton(title: "Increment", target: self, action: #selector(increment))
        button.bezelStyle = .rounded
        button.frame = NSRect(x: 220, y: 250, width: 200, height: 50)
        field.setAccessibilityLabel("Benchmark text")
        status.frame = NSRect(x: 200, y: 70, width: 300, height: 40)
        for view in [button, field, status] { window.contentView!.addSubview(view) }
        window.makeKeyAndOrderFront(nil)
        NSApp.activate(ignoringOtherApps: true)
        window.makeFirstResponder(nil)
        if CommandLine.arguments.count == 2 {
            let url = URL(fileURLWithPath: CommandLine.arguments[1])
            var last = ""
            Timer.scheduledTimer(withTimeInterval: 0.05, repeats: true) { _ in
                let state: [String: Any] = ["pid": ProcessInfo.processInfo.processIdentifier,
                    "text": self.field.stringValue, "count": self.count, "windowId": self.window.windowNumber]
                if let data = try? JSONSerialization.data(withJSONObject: state, options: [.sortedKeys]),
                   let key = String(data: data, encoding: .utf8), key != last {
                    do { try data.write(to: url, options: [.atomic]); last = key } catch {}
                }
            }
        }
    }
    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool { true }
}
let delegate = InputBenchmark()
NSApplication.shared.setActivationPolicy(.regular)
NSApplication.shared.delegate = delegate
NSApplication.shared.run()
