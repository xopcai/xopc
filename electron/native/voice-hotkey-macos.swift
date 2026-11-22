import AppKit
import ApplicationServices
import Foundation
import ImageIO
import Vision

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

private func writeJsonAndExit(_ object: Any, exitCode: Int32 = 0) -> Never {
    if let data = try? JSONSerialization.data(withJSONObject: object, options: []) {
        FileHandle.standardOutput.write(data)
        FileHandle.standardOutput.write(Data("\n".utf8))
    }
    exit(exitCode)
}

private func runWindowList(excludePid: Int32?) -> Never {
    let options: CGWindowListOption = [.optionOnScreenOnly, .excludeDesktopElements]
    guard let infoList = CGWindowListCopyWindowInfo(options, kCGNullWindowID) as? [[String: Any]] else {
        writeJsonAndExit(["windows": []])
    }

    var windows: [[String: Any]] = []
    var zOrder = 0
    for entry in infoList {
        let layer = (entry[kCGWindowLayer as String] as? NSNumber)?.intValue ?? -1
        if layer < 0 || layer >= 24 { continue }
        let alpha = (entry[kCGWindowAlpha as String] as? NSNumber)?.doubleValue ?? 1.0
        if alpha <= 0.02 { continue }
        let pid = (entry[kCGWindowOwnerPID as String] as? NSNumber)?.int32Value ?? 0
        if let excludePid, pid == excludePid { continue }
        guard let boundsDict = entry[kCGWindowBounds as String] as? NSDictionary,
              let rect = CGRect(dictionaryRepresentation: boundsDict)
        else { continue }
        if rect.width < 24 || rect.height < 24 { continue }

        let windowId = (entry[kCGWindowNumber as String] as? NSNumber)?.int64Value ?? 0
        let appName = (entry[kCGWindowOwnerName as String] as? String) ?? ""
        let title = (entry[kCGWindowName as String] as? String) ?? ""
        windows.append([
            "id": String(windowId),
            "pid": Int(pid),
            "appName": appName,
            "title": title,
            "x": Int(rect.origin.x.rounded()),
            "y": Int(rect.origin.y.rounded()),
            "width": Int(rect.size.width.rounded()),
            "height": Int(rect.size.height.rounded()),
            "zOrder": zOrder,
        ])
        zOrder += 1
    }
    writeJsonAndExit(["windows": windows])
}

private func runOcr(imagePath: String) -> Never {
    let url = URL(fileURLWithPath: imagePath)
    guard let source = CGImageSourceCreateWithURL(url as CFURL, nil),
          let cgImage = CGImageSourceCreateImageAtIndex(source, 0, nil)
    else {
        writeJsonAndExit(["ok": false, "error": "Invalid image path"], exitCode: 1)
    }

    var lines: [String] = []
    var blocks: [[String: Any]] = []
    var requestError: String?

    let makeRequest: (Bool) -> VNRecognizeTextRequest = { cpuOnly in
        let request = VNRecognizeTextRequest { req, err in
            if let err {
                requestError = err.localizedDescription
                return
            }
            guard let observations = req.results as? [VNRecognizedTextObservation] else { return }
            let sorted = observations.sorted { a, b in
                let ay = 1.0 - a.boundingBox.origin.y - a.boundingBox.size.height
                let by = 1.0 - b.boundingBox.origin.y - b.boundingBox.size.height
                if abs(ay - by) > 0.018 { return ay < by }
                return a.boundingBox.origin.x < b.boundingBox.origin.x
            }
            for obs in sorted {
                guard let top = obs.topCandidates(1).first else { continue }
                let text = top.string.trimmingCharacters(in: .whitespacesAndNewlines)
                if text.isEmpty { continue }
                lines.append(text)
                let box = obs.boundingBox
                blocks.append([
                    "text": text,
                    "x": box.origin.x,
                    "y": max(0.0, 1.0 - box.origin.y - box.size.height),
                    "width": box.size.width,
                    "height": box.size.height,
                    "confidence": Double(top.confidence),
                ])
            }
        }
        request.recognitionLevel = .accurate
        request.usesLanguageCorrection = true
        request.usesCPUOnly = cpuOnly
        request.recognitionLanguages = ["zh-Hans", "zh-Hant", "en-US"]
        if #available(macOS 13.0, *) {
            request.automaticallyDetectsLanguage = true
        }
        return request
    }

    let handler = VNImageRequestHandler(cgImage: cgImage, options: [:])
    do {
        try handler.perform([makeRequest(false)])
        if requestError != nil {
            requestError = nil
            lines.removeAll()
            blocks.removeAll()
            try handler.perform([makeRequest(true)])
        }
    } catch {
        requestError = nil
        lines.removeAll()
        blocks.removeAll()
        do {
            try handler.perform([makeRequest(true)])
        } catch {
            writeJsonAndExit(["ok": false, "error": error.localizedDescription], exitCode: 1)
        }
    }

    if let requestError {
        writeJsonAndExit(["ok": false, "error": requestError], exitCode: 1)
    }

    writeJsonAndExit([
        "ok": true,
        "text": lines.joined(separator: "\n"),
        "blocks": blocks,
    ])
}

private func runScroll(x: Double, y: Double, deltaY: Int32) -> Never {
    guard AXIsProcessTrusted() else {
        writeJsonAndExit(["ok": false, "reason": "accessibility"])
    }
    guard let event = CGEvent(
        scrollWheelEvent2Source: nil,
        units: .pixel,
        wheelCount: 1,
        wheel1: deltaY,
        wheel2: 0,
        wheel3: 0
    ) else {
        writeJsonAndExit(["ok": false, "reason": "event_creation_failed"])
    }
    event.location = CGPoint(x: x, y: y)
    event.post(tap: .cghidEventTap)
    writeJsonAndExit(["ok": true])
}

let args = CommandLine.arguments
if args.count >= 2 {
    switch args[1] {
    case "--window-list":
        let excludePid = args.count >= 3 ? Int32(args[2]) : nil
        runWindowList(excludePid: excludePid)
    case "--ocr":
        guard args.count >= 3 else {
            writeJsonAndExit(["ok": false, "error": "Missing image path"], exitCode: 2)
        }
        runOcr(imagePath: args[2])
    case "--scroll":
        guard args.count >= 5,
              let x = Double(args[2]),
              let y = Double(args[3]),
              let deltaY = Int32(args[4])
        else {
            writeJsonAndExit(["ok": false, "reason": "invalid_args"], exitCode: 2)
        }
        runScroll(x: x, y: y, deltaY: deltaY)
    default:
        break
    }
}

private let monitor = FnHoldMonitor()
monitor.start()
RunLoop.main.run()
