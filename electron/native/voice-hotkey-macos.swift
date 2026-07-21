import AppKit
import ApplicationServices
import Foundation

private final class FnTapMonitor {
    private static let fnKeyCode: UInt16 = 63

    private var fnIsDown = false
    private var chorded = false
    private var globalMonitor: Any?
    private var localMonitor: Any?

    func start() {
        let mask: NSEvent.EventTypeMask = [.flagsChanged, .keyDown]
        globalMonitor = NSEvent.addGlobalMonitorForEvents(matching: mask) { [weak self] event in
            self?.handle(event)
        }
        localMonitor = NSEvent.addLocalMonitorForEvents(matching: mask) { [weak self] event in
            self?.handle(event)
            return event
        }
    }

    private func handle(_ event: NSEvent) {
        if event.type == .flagsChanged && event.keyCode == Self.fnKeyCode {
            let isDown = event.modifierFlags.contains(.function)
            if isDown && !fnIsDown {
                fnIsDown = true
                chorded = false
                return
            }
            if !isDown && fnIsDown {
                if !chorded {
                    FileHandle.standardOutput.write(Data("{\"type\":\"modifier-tap\",\"key\":\"fn\"}\n".utf8))
                }
                fnIsDown = false
                chorded = false
            }
            return
        }

        if fnIsDown {
            chorded = true
        }
    }
}

private let monitor = FnTapMonitor()
monitor.start()
RunLoop.main.run()
