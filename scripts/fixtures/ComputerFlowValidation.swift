import AppKit
import Darwin

// A real native app with no documents, network access, credentials or preference mutation.
final class ValidationApp: NSObject, NSApplicationDelegate {
    let content = NSTextField(labelWithString: "Native navigation start page")
    var window: NSWindow!
    @objc func start(_ sender: Any?) { content.stringValue = "Native navigation start page" }
    @objc func destination(_ sender: Any?) { content.stringValue = "Verified Native Flow Destination" }
    func applicationDidFinishLaunching(_ notification: Notification) {
        NSApp.setActivationPolicy(.regular)
        window = NSWindow(contentRect: NSRect(x: 180, y: 200, width: 560, height: 240), styleMask: [.titled], backing: .buffered, defer: false)
        window.title = "XOPC Native Flow Validation"
        window.isReleasedWhenClosed = false
        window.hidesOnDeactivate = false
        window.level = .normal
        window.collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary]
        let start = NSButton(title: "Return to Start", target: self, action: #selector(start(_:)))
        let destination = NSButton(title: "Open Navigation Page", target: self, action: #selector(destination(_:)))
        let stack = NSStackView(views: [start, destination, content])
        stack.orientation = .vertical
        stack.spacing = 20
        stack.translatesAutoresizingMaskIntoConstraints = false
        window.contentView!.addSubview(stack)
        NSLayoutConstraint.activate([stack.centerXAnchor.constraint(equalTo: window.contentView!.centerXAnchor), stack.centerYAnchor.constraint(equalTo: window.contentView!.centerYAnchor)])
        window.makeKeyAndOrderFront(nil)
        NSApp.activate(ignoringOtherApps: true)
        if CommandLine.arguments.count == 3 {
            let metadata: [String: Any] = ["id": Bundle.main.bundleIdentifier ?? "none", "runtimeId": NSRunningApplication.current.bundleIdentifier ?? "none", "policy": NSRunningApplication.current.activationPolicy.rawValue]
            try! JSONSerialization.data(withJSONObject: metadata).write(to: URL(fileURLWithPath: CommandLine.arguments[1] + ".json"))
            try! String(ProcessInfo.processInfo.processIdentifier).write(toFile: CommandLine.arguments[1], atomically: true, encoding: .utf8)
            let owner = pid_t(CommandLine.arguments[2])!
            Timer.scheduledTimer(withTimeInterval: 0.5, repeats: true) { _ in
                if kill(owner, 0) != 0 { NSApp.terminate(nil) }
            }
        }
    }
}
let delegate = ValidationApp()
NSApplication.shared.delegate = delegate
NSApplication.shared.run()
