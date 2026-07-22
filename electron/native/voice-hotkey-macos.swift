import AppKit
import ApplicationServices
import Foundation

private final class FnHoldMonitor {
    private static let fnKeyCode: UInt16 = 63
    private static let holdDelay: TimeInterval = 0.3

    private let debugEnabled = ProcessInfo.processInfo.environment["XOPC_VOICE_HOTKEY_DEBUG"] == "1"
    private var fnIsDown = false
    private var chorded = false
    private var holdTriggered = false
    private var holdTimer: Timer?
    private var globalMonitor: Any?
    private var localMonitor: Any?

    func start() {
        let accessibilityTrusted = AXIsProcessTrusted()
        let mask: NSEvent.EventTypeMask = [.flagsChanged, .keyDown]
        globalMonitor = NSEvent.addGlobalMonitorForEvents(matching: mask) { [weak self] event in
            self?.handle(event)
        }
        localMonitor = NSEvent.addLocalMonitorForEvents(matching: mask) { [weak self] event in
            self?.handle(event)
            return event
        }
        if !accessibilityTrusted {
            FileHandle.standardError.write(
                Data("Accessibility permission is required for the Fn voice hotkey\n".utf8)
            )
        }
        debug(
            "started accessibilityTrusted=\(accessibilityTrusted) "
                + "globalMonitor=\(globalMonitor != nil) localMonitor=\(localMonitor != nil)"
        )
    }

    private func handle(_ event: NSEvent) {
        debug(
            "event type=\(event.type.rawValue) keyCode=\(event.keyCode) "
                + "function=\(event.modifierFlags.contains(.function))"
        )
        if event.type == .flagsChanged && event.keyCode == Self.fnKeyCode {
            let isDown = event.modifierFlags.contains(.function)
            if isDown && !fnIsDown {
                fnIsDown = true
                chorded = false
                holdTriggered = false
                holdTimer?.invalidate()
                holdTimer = Timer.scheduledTimer(withTimeInterval: Self.holdDelay, repeats: false) { [weak self] _ in
                    guard let self, self.fnIsDown, !self.chorded else { return }
                    self.holdTriggered = true
                    self.emit("press")
                }
                return
            }
            if !isDown && fnIsDown {
                holdTimer?.invalidate()
                holdTimer = nil
                if holdTriggered { emit("release") }
                fnIsDown = false
                chorded = false
                holdTriggered = false
            }
            return
        }

        if fnIsDown {
            chorded = true
            holdTimer?.invalidate()
            holdTimer = nil
        }
    }

    private func emit(_ action: String) {
        FileHandle.standardOutput.write(
            Data("{\"type\":\"modifier-hold\",\"action\":\"\(action)\",\"key\":\"fn\"}\n".utf8)
        )
    }

    private func debug(_ message: String) {
        guard debugEnabled else { return }
        FileHandle.standardError.write(Data("debug: \(message)\n".utf8))
    }
}

private let monitor = FnHoldMonitor()
monitor.start()
RunLoop.main.run()
