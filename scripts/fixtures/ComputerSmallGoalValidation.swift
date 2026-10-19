import AppKit

// Disposable workflow: no files, accounts, network traffic or preference changes.
final class SmallGoalApp: NSObject, NSApplicationDelegate {
    var window: NSWindow!
    let status = NSTextField(labelWithString: "Step 1 of 3: Start the workflow")
    let next = NSButton()
    var stage = 0
    @objc func advance(_ sender: Any?) {
        stage += 1
        if stage == 1 { next.title = "Continue"; status.stringValue = "Step 2 of 3: Continue the workflow" }
        if stage == 2 { next.title = "Finish"; status.stringValue = "Step 3 of 3: Finish the workflow" }
        if stage >= 3 { next.isEnabled = false; status.stringValue = "PASS: Small goal complete" }
    }
    @objc func reset(_ sender: Any?) {
        stage = 0; next.title = "Start"; next.isEnabled = true
        status.stringValue = "Step 1 of 3: Start the workflow"
    }
    func applicationDidFinishLaunching(_ notification: Notification) {
        NSApp.setActivationPolicy(.regular)
        window = NSWindow(contentRect: NSRect(x: 160, y: 180, width: 640, height: 360), styleMask: [.titled, .closable], backing: .buffered, defer: false)
        window.title = "XOPC Small Goal Validation"
        window.isReleasedWhenClosed = false
        let title = NSTextField(labelWithString: "Disposable three-step workflow")
        title.font = .systemFont(ofSize: 23)
        next.title = "Start"; next.target = self; next.action = #selector(advance(_:)); next.bezelStyle = .rounded
        next.setAccessibilityIdentifier("small-goal-next")
        let reset = NSButton(title: "Reset fixture", target: self, action: #selector(reset(_:)))
        let stack = NSStackView(views: [title, status, next, reset]); stack.orientation = .vertical; stack.spacing = 24
        stack.translatesAutoresizingMaskIntoConstraints = false
        window.contentView!.addSubview(stack)
        NSLayoutConstraint.activate([stack.centerXAnchor.constraint(equalTo: window.contentView!.centerXAnchor), stack.centerYAnchor.constraint(equalTo: window.contentView!.centerYAnchor)])
        window.makeKeyAndOrderFront(nil); NSApp.activate(ignoringOtherApps: true)
    }
    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool { true }
}
let delegate = SmallGoalApp()
NSApplication.shared.delegate = delegate
NSApplication.shared.run()
