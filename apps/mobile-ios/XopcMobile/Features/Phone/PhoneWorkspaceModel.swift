import Foundation
import Observation

@MainActor @Observable final class PhoneWorkspaceModel {
    private struct TouchStart {
        let horizontal: Int
        let vertical: Int
        let date: Date
    }

    private(set) var summary: PhoneSummary?
    private(set) var live: PhoneLiveState?
    private(set) var busy = false
    private(set) var failed = false
    private(set) var fallback = false
    private(set) var playing = false
    private(set) var frame: PhoneFrame?
    private(set) var video: PhoneVideo?
    private(set) var width = 1
    private(set) var height = 2
    private(set) var geometry = 0
    private var repository: PhoneRepository?
    private var conversationID = ""
    private var generation = 0
    private var operations = 0
    private var active = false
    private var visible = false
    private var streamKey = ""
    private var streamTask: Task<Void, Never>?
    private var heartbeatAt = Date.distantPast
    private var touchStart: TouchStart?
    var canControl: Bool {
        summary?.access == "control" && live?.report.mode == "control" && (live?.report.controlOwner != "human" || live?.ownControl == true)
    }

    func observe(configuration: GatewayConfiguration, conversationID: String, visible: Bool) async {
        leave()
        if self.conversationID != conversationID || self.repository?.client.configuration != configuration {
            summary = nil
        }
        let repository = PhoneRepository(client: GatewayClient(configuration: configuration))
        self.repository = repository; self.conversationID = conversationID
        active = true; self.visible = visible; generation += 1
        let revision = generation
        do {
            guard try await repository.supported() else { summary = nil; active = false; return }
            while !Task.isCancelled, revision == generation {
                await refresh()
                try await Task.sleep(for: .milliseconds(self.visible ? 1200 : 4000))
            }
        } catch is CancellationError {} catch {
            if revision == generation {
                failed = true
            }
        }
        if revision == generation {
            leave()
        }
    }

    // swiftlint:disable:next cyclomatic_complexity
    private func refresh() async {
        guard let repository, active, !busy else { return }
        let operationRevision = operations
        let revision = generation
        do {
            let next = try await repository.summary(conversationID)
            guard revision == generation, operationRevision == operations, active, !Task.isCancelled else { return }
            if next.binding != summary?.binding {
                releaseOld(); stopVideo(); live = nil; frame = nil; fallback = false
            }
            if summary != next {
                summary = next
            }
            guard next.available, next.access != "none", let binding = next.binding else {
                releaseOld(); stopVideo(); live = nil; frame = nil; failed = false; return
            }
            guard visible || live != nil else { return }
            let state = try await repository.state(conversationID)
            guard revision == generation, operationRevision == operations, active, !Task.isCancelled else { return }
            if live != state {
                live = state
            }
            if state?.ownControl == true, !busy, Date().timeIntervalSince(heartbeatAt) > 4 {
                heartbeatAt = Date(); await command("heartbeat")
            }
            if state?.report.status == "closed" { stopVideo(); return }
            ensureVideo()
            if visible, fallback, touchStart == nil {
                let nextFrame = try await repository.frame(binding)
                if revision == generation, operationRevision == operations, touchStart == nil, visible, !Task.isCancelled {
                    frame = nextFrame
                }
            }
        } catch is CancellationError {} catch {
            if revision == generation, operationRevision == operations {
                releaseOld(); stopVideo(); live = nil; frame = nil; failed = true
            }
        }
    }

    func command(_ operation: String, action: PhoneAction? = nil) async {
        guard let repository, let binding = summary?.binding, let state = live, active, (visible || operation == "heartbeat"), !busy else { return }
        let revision = generation
        if operation != "heartbeat" {
            operations += 1; busy = true; failed = false; video?.pointer("cancel", x: 0, y: 0)
        }
        defer {
            if revision == generation, operation != "heartbeat" {
                busy = false
            }
        }
        do {
            let result = try await repository.command(binding, state: state, op: operation, action: action,
                                                      geometry: playing ? geometry : nil, frameSeq: fallback ? frame?.seq : nil)
            guard revision == generation, active else {
                if result.ownControl {
                    Task { _ = try? await repository.command(binding, state: result, op: "release") }
                }
                return
            }
            if live != result {
                live = result
            }
            if result.report.sessionId != binding.phoneSessionId {
                stopVideo(); summary = try await repository.summary(conversationID)
            }
            ensureVideo()
        } catch is CancellationError {} catch {
            if revision == generation {
                failed = true
            }
        }
    }

    private func ensureVideo() {
        guard let repository, let binding = summary?.binding, let state = live, active,
              state.report.status != "closed", state.report.reconnectRequired != true, !fallback else { return }
        let key = "\(binding.phoneSessionId):\(state.ownControl ? state.report.controlEpoch : 0)"
        guard streamKey != key else { return }
        stopVideo(); streamKey = key
        let next = PhoneVideo(); video = next
        next.onGeometry = { [weak self] width, height, geometry in
            guard let self, streamKey == key else { return }; self.width = width; self.height = height; self.geometry = geometry
        }
        next.onPlaying = { [weak self] in
            guard let self, streamKey == key else { return }; playing = true; failed = false
        }
        streamTask = Task { [weak self] in
            do { try await next.consume(repository: repository, binding: binding, state: state) }
            catch is CancellationError {} catch {
                guard let self, streamKey == key, !Task.isCancelled else { return }
                stopVideo(); fallback = true
            }
        }
    }

    private func stopVideo() {
        streamKey = ""; streamTask?.cancel(); streamTask = nil; video?.close(); video = nil; playing = false; geometry = 0
    }

    private func releaseOld() {
        if let repository, let binding = summary?.binding, let state = live, state.ownControl {
            Task { _ = try? await repository.command(binding, state: state, op: "release") }
        }
    }

    func setVisible(_ visible: Bool) {
        self.visible = visible
        if !visible {
            video?.pointer("cancel", x: 0, y: 0); touchStart = nil
        }
    }

    func leave() {
        generation += 1; active = false; visible = false
        releaseOld(); stopVideo(); live = nil; frame = nil; fallback = false; busy = false; touchStart = nil
    }

    func retry() async {
        stopVideo(); fallback = false; failed = false; frame = nil; await refresh()
    }

    func pointer(_ phase: String, x coordinateX: Int, y coordinateY: Int) {
        guard active, visible, live?.ownControl == true, !busy else { return }
        if playing {
            video?.pointer(phase, x: coordinateX, y: coordinateY); return
        }
        if phase == "cancel" {
            touchStart = nil; return
        }
        if phase == "down" {
            touchStart = TouchStart(horizontal: coordinateX, vertical: coordinateY, date: Date())
        }
        guard phase == "up", let start = touchStart else { return }
        touchStart = nil
        guard let frame, Date().timeIntervalSince1970 * 1000 - frame.capturedAt < 5000 else { return }
        let duration = min(3000, max(100, Int(Date().timeIntervalSince(start.date) * 1000)))
        let action = abs(coordinateX - start.horizontal) + abs(coordinateY - start.vertical) > 25
            ? PhoneAction(type: "swipe", start: [start.horizontal, start.vertical], end: [coordinateX, coordinateY], durationMs: duration)
            : PhoneAction(type: duration >= 500 ? "longPress" : "tap", point: [coordinateX, coordinateY], durationMs: duration)
        Task { await command("input", action: action) }
    }
}
