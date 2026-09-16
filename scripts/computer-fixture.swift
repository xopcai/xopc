import Cocoa

// Disposable native fixture: no files, network, accounts, or user data.
final class Fixture: NSObject, NSApplicationDelegate {
    var window: NSWindow!
    let status = NSTextField(labelWithString: "Waiting for Continue")
    func applicationDidFinishLaunching(_ notification: Notification) {
        window = NSWindow(contentRect: NSRect(x: 100, y: 100, width: 800, height: 600),
                          styleMask: [.titled, .closable, .miniaturizable], backing: .buffered, defer: false)
        window.title = "XOPC Computer Use — Synthetic Fixture"
        let content = window.contentView!
        let title = NSTextField(labelWithString: "Synthetic Computer Use Test")
        title.font = NSFont.systemFont(ofSize: 26)
        title.frame = NSRect(x: 180, y: 475, width: 480, height: 45)
        content.addSubview(title)
        let button = NSButton(title: "Continue", target: self, action: #selector(continueClicked))
        button.bezelStyle = .rounded
        button.frame = NSRect(x: 300, y: 275, width: 200, height: 80)
        button.setAccessibilityIdentifier("fixture-continue")
        content.addSubview(button)
        status.frame = NSRect(x: 230, y: 175, width: 400, height: 40)
        status.setAccessibilityIdentifier("fixture-status")
        content.addSubview(status)
        let text = NSTextField(frame: NSRect(x: 250, y: 90, width: 300, height: 40))
        text.placeholderString = "Type fixture text here"
        text.setAccessibilityLabel("Fixture text")
        content.addSubview(text)
        window.makeKeyAndOrderFront(nil)
        NSApp.activate(ignoringOtherApps: true)
    }
    @objc func continueClicked() { status.stringValue = "PASS: Continue clicked" }
    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool { true }
}
let delegate = Fixture()
NSApplication.shared.setActivationPolicy(.regular)
NSApplication.shared.delegate = delegate
NSApplication.shared.run()
