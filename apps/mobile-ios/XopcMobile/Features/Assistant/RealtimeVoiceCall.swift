import Foundation
import Observation

@MainActor
@Observable
final class RealtimeVoiceCall {
    enum Phase: Equatable { case idle, connecting, connected, recovering, paused, ending }

    private(set) var phase: Phase = .idle
    private(set) var mode: RealtimeVoiceMode = .natural
    private(set) var name = ""
    private(set) var startedAt = Date()
    private(set) var muted = false
    private(set) var speaker = false
    private(set) var expanded = true
    private(set) var userText = ""
    private(set) var assistantText = ""
    private(set) var activity = ""
    private(set) var errorCode: String?
    private(set) var responseID = ""
    private(set) var responseStage = ""
    private(set) var taskID = ""
    private(set) var networkQuality = "good"
    private(set) var clarification: Clarification?
    private(set) var approval: RealtimeVoiceApproval?

    struct Clarification: Sendable {
        let requestID: String
        let question: String
        let choices: [String]
        let suggestedAnswer: String
        let version: Int
    }

    private let audio = RealtimeVoiceAudio()
    private let transport = RealtimeVoiceTransport()
    private var gateway: GatewayClient?
    private var conversationID: String?
    private var session: RealtimeVoiceSession?
    private var captureTask: Task<Void, Never>?
    private var receiveTask: Task<Void, Never>?
    private var reconnectTask: Task<Void, Never>?
    private var approvalTask: Task<Void, Never>?
    private var limitTask: Task<Void, Never>?
    private var generation = 0
    private var reconnectAttempt = 0
    private var connectedAt: Date?
    private var responseDone = false
    private var receivedMilliseconds = 0
    private var playedMilliseconds = 0
    private var congested = false

    func start(conversationID: String, mode: RealtimeVoiceMode, name: String, gateway: GatewayClient) async {
        guard phase == .idle else { expanded = true; return }
        self.conversationID = conversationID
        self.mode = mode
        self.name = name
        self.gateway = gateway
        startedAt = Date()
        expanded = true
        muted = false
        speaker = false
        reconnectAttempt = 0
        userText = ""
        assistantText = ""
        await open(recovering: false)
    }

    func minimize() {
        expanded = false
    }

    func expand() {
        expanded = true
    }

    func resume() async {
        guard phase == .paused || phase == .recovering else { return }
        reconnectTask?.cancel()
        reconnectTask = nil
        await open(recovering: true)
    }

    func setMuted(_ value: Bool) async {
        muted = value
        audio.setMuted(value)
        try? await transport.send("input.mute", payload: .init(muted: value || congested || clarification != nil || approval != nil))
    }

    func setSpeaker(_ value: Bool) {
        do {
            try audio.setSpeaker(value)
            speaker = value
        } catch {
            errorCode = "ROUTE_CHANGE_FAILED"
        }
    }

    func stopReply() async {
        guard !responseID.isEmpty else { return }
        let id = responseID
        responseID = ""
        responseStage = ""
        audio.flush()
        try? await transport.send("response.stop_playback", payload: .init(responseId: id))
    }

    func cancelTask() async {
        guard !taskID.isEmpty else { return }
        try? await transport.send("task.cancel", payload: .init(taskId: taskID))
    }

    func end() async {
        guard phase != .idle else { return }
        phase = .ending
        generation += 1
        reconnectTask?.cancel()
        reconnectTask = nil
        try? await transport.send("session.stop", payload: .init(reason: "user_finished"))
        await release()
        conversationID = nil
        gateway = nil
        phase = .idle
        errorCode = nil
        responseID = ""
        taskID = ""
        clarification = nil
        approval = nil
    }

    private func open(recovering: Bool) async {
        guard let gateway, let conversationID else { return }
        generation += 1
        let current = generation
        phase = recovering ? .recovering : .connecting
        errorCode = nil
        do {
            let status = try await gateway.fetchRealtimeVoiceStatus()
            guard generation == current else { return }
            let availability = mode == .natural ? status.capabilities.natural : status.capabilities.assistant
            guard status.enabled, availability.available else {
                throw RealtimeVoiceCallError.unavailable(availability.reasonCode ?? "VOICE_DISABLED")
            }
            try await gateway.preflightRealtimeVoice(conversationID: conversationID, mode: mode)
            guard generation == current else { return }
            let session = try await gateway.createRealtimeVoiceSession(conversationID: conversationID, mode: mode)
            guard generation == current else {
                try? await gateway.cancelRealtimeVoiceSession(session)
                return
            }
            self.session = session
            let input = try await audio.start(
                onPlayed: { [weak self] id, milliseconds in self?.played(id: id, milliseconds: milliseconds) },
                onInterrupted: { [weak self] in Task { await self?.pause(reason: "AUDIO_INTERRUPTED") } }
            )
            guard generation == current else { await release(); return }
            if speaker {
                try? audio.setSpeaker(true)
            }
            let stream = try await transport.connect(origin: gateway.configuration.baseURL, session: session)
            captureTask = Task { await capture(input, generation: current) }
            receiveTask = Task { await consume(stream, generation: current) }
        } catch {
            guard generation == current else { return }
            errorCode = (error as? RealtimeVoiceCallError)?.code
                ?? (error as? RealtimeVoiceAudioError)?.code
                ?? error.localizedDescription
            await release()
            phase = .paused
        }
    }

    private func capture(_ stream: AsyncStream<Data>, generation: Int) async {
        for await bytes in stream {
            guard !Task.isCancelled, generation == self.generation else { return }
            if congested {
                guard await transport.inputQueueAgeMs() < 80 else { continue }
                congested = false
                networkQuality = "good"
                try? await transport.send("input.mute", payload: .init(muted: muted || clarification != nil || approval != nil))
            }
            guard phase == .connected, !muted, clarification == nil, approval == nil else { continue }
            do {
                let queueAgeMs = try await transport.sendAudio(bytes)
                if queueAgeMs >= 120, !congested {
                    congested = true
                    networkQuality = "degraded"
                    try? await transport.send("input.mute", payload: .init(muted: true))
                }
            } catch RealtimeVoiceTransportError.inputBackpressure {
                congested = true
                networkQuality = "critical"
                try? await transport.send("input.mute", payload: .init(muted: true))
            } catch {
                await pause(reason: "NETWORK", reconnect: true)
                return
            }
        }
    }

    private func consume(_ stream: AsyncThrowingStream<RealtimeVoiceIncoming, Error>, generation: Int) async {
        do {
            for try await incoming in stream {
                guard generation == self.generation else { return }
                switch incoming {
                case let .event(event): await handle(event)
                case let .audio(frame): await handle(frame)
                }
            }
            if generation == self.generation, phase != .idle, phase != .ending {
                let reason = errorCode ?? "NETWORK"
                await pause(reason: reason, reconnect: phase == .connected && reason == "NETWORK")
            }
        } catch {
            if generation == self.generation, phase != .idle, phase != .ending {
                await pause(reason: "NETWORK", reconnect: true)
            }
        }
    }

    private func pause(reason: String, reconnect: Bool = false) async {
        guard phase != .idle, phase != .ending else { return }
        if let connectedAt, Date().timeIntervalSince(connectedAt) >= 30 {
            reconnectAttempt = 0
        }
        generation += 1
        errorCode = reason
        phase = reconnect ? .recovering : .paused
        await release()
        guard reconnect, reconnectAttempt < 5 else {
            phase = .paused
            return
        }
        let delay = [500, 1000, 2000, 4000, 8000][reconnectAttempt]
        reconnectAttempt += 1
        reconnectTask = Task {
            try? await Task.sleep(for: .milliseconds(delay))
            guard !Task.isCancelled, phase == .recovering else { return }
            await open(recovering: true)
        }
    }

    private func release() async {
        approvalTask?.cancel()
        approvalTask = nil
        limitTask?.cancel()
        limitTask = nil
        captureTask?.cancel()
        captureTask = nil
        receiveTask?.cancel()
        receiveTask = nil
        await transport.close()
        audio.stop()
        if let session, let gateway {
            try? await gateway.cancelRealtimeVoiceSession(session)
        }
        session = nil
        congested = false
        receivedMilliseconds = 0
        playedMilliseconds = 0
        responseDone = false
        approval = nil
    }
}

extension RealtimeVoiceCall {
    func submitClarification(action: String, answer: String? = nil) async {
        guard let clarification, let gateway else { return }
        do {
            try await gateway.respondToRealtimeVoiceClarification(
                id: clarification.requestID, version: clarification.version, action: action, answer: answer
            )
            self.clarification = nil
            try? await transport.send("input.mute", payload: .init(muted: muted || congested || approval != nil))
        } catch {
            errorCode = error.localizedDescription
        }
    }

    func respondToApproval(approved: Bool) async {
        guard let approval, let gateway else { return }
        do {
            try await gateway.respondToRealtimeVoiceApproval(approval, approved: approved)
            self.approval = nil
            try? await transport.send("input.mute", payload: .init(muted: muted || congested || clarification != nil))
        } catch {
            errorCode = error.localizedDescription
        }
    }
}

private extension RealtimeVoiceCall {
    func handle(_ event: RealtimeVoiceEvent) async {
        let payload = event.payload
        if event.type.hasPrefix("session.") {
            await handleSession(event.type, payload: payload)
        } else if event.type.hasPrefix("response.") {
            await handleResponse(event.type, payload: payload)
        } else if event.type.hasPrefix("task.") {
            handleTask(event.type, payload: payload)
        } else if event.type == "input.transcript.final" {
            userText = payload.text ?? ""
        }
    }

    func handleSession(_ type: String, payload: RealtimeVoiceEvent.Payload) async {
        switch type {
        case "session.ready":
            phase = .connected
            connectedAt = Date()
            errorCode = nil
            networkQuality = "good"
            try? await transport.send("input.mute", payload: .init(muted: muted))
            if let maximum = session?.limits.maxSessionMs, maximum > 0 {
                let current = generation
                limitTask = Task {
                    try? await Task.sleep(for: .milliseconds(maximum))
                    guard !Task.isCancelled, generation == current else { return }
                    await pause(reason: "TIME_LIMIT")
                }
            }
            if mode == .assistant {
                let current = generation
                approvalTask = Task {
                    while !Task.isCancelled, generation == current, phase == .connected {
                        await loadApproval()
                        try? await Task.sleep(for: .seconds(3))
                    }
                }
            }
        case "session.error":
            errorCode = payload.code ?? "SERVICE_UNAVAILABLE"
        case "session.closed":
            let reason = errorCode ?? payload.reason ?? "NETWORK"
            await pause(reason: reason, reconnect: phase == .connected && payload.reason == "network")
        default: break
        }
    }

    func loadApproval() async {
        guard let gateway, let conversationID else { return }
        do {
            let next = try await gateway.fetchRealtimeVoiceApprovals(conversationID: conversationID).first
            guard phase == .connected else { return }
            if next?.id != approval?.id {
                approval = next
                try? await transport.send("input.mute", payload: .init(muted: muted || congested || clarification != nil || next != nil))
            }
        } catch {
            // Approval polling is best-effort; a transient fetch failure does not end a call.
        }
    }

    // Protocol dispatch keeps each response event explicit.
    // swiftlint:disable:next cyclomatic_complexity
    func handleResponse(_ type: String, payload: RealtimeVoiceEvent.Payload) async {
        switch type {
        case "response.created":
            guard responseID.isEmpty || responseID == payload.responseId else {
                if let id = payload.responseId {
                    try? await transport.send("response.stop_playback", payload: .init(responseId: id))
                }
                return
            }
            responseID = payload.responseId ?? ""
            assistantText = ""
            activity = ""
            responseStage = "thinking"
            receivedMilliseconds = 0
            playedMilliseconds = 0
            responseDone = false
        case "response.text.delta" where payload.responseId == responseID:
            assistantText = String((assistantText + (payload.delta ?? "")).suffix(32000))
        case "response.audio.started" where payload.format?.sampleRate != 24000:
            await pause(reason: "UNSUPPORTED_FORMAT")
        case "response.clarification" where payload.responseId == responseID:
            clarification = Clarification(
                requestID: payload.requestId ?? "", question: payload.question ?? "",
                choices: payload.choices ?? [], suggestedAnswer: payload.suggestedAnswer ?? "",
                version: payload.version ?? 1
            )
            try? await transport.send("input.mute", payload: .init(muted: true))
        case "response.cancelled" where payload.responseId == responseID:
            audio.flush()
            finishResponse()
        case "response.done" where payload.responseId == responseID:
            responseDone = true
            if payload.audio == false, !assistantText.isEmpty {
                errorCode = "NO_RESPONSE_AUDIO"
            }
            if playedMilliseconds >= receivedMilliseconds {
                finishResponse()
            }
        default: break
        }
    }

    func handleTask(_ type: String, payload: RealtimeVoiceEvent.Payload) {
        switch type {
        case "task.created":
            taskID = payload.taskId ?? ""
        case "task.activity" where payload.taskId == taskID:
            activity = payload.status == "running" ? payload.toolName ?? "" : ""
        case "task.done" where payload.taskId == taskID:
            taskID = ""
            activity = ""
        default: break
        }
    }

    func handle(_ frame: RealtimeVoiceDownlinkFrame) async {
        guard !responseID.isEmpty, frame.responseID == responseID else { return }
        receivedMilliseconds += 20
        responseStage = playedMilliseconds > 0 ? "speaking" : "buffering"
        do {
            try audio.enqueue(responseID: frame.responseID, pcm: frame.audio)
        } catch {
            await pause(reason: "PLAYBACK_FAILED")
        }
    }

    func played(id: String, milliseconds: Int) {
        guard id == responseID else { return }
        playedMilliseconds = milliseconds
        responseStage = "speaking"
        Task {
            try? await transport.send(
                "response.audio.played", payload: .init(responseId: id, playedDurationMs: milliseconds)
            )
        }
        if responseDone, milliseconds >= receivedMilliseconds {
            finishResponse()
        }
    }

    func finishResponse() {
        responseID = ""
        responseStage = ""
        activity = ""
    }
}

private enum RealtimeVoiceCallError: Error {
    case unavailable(String)

    var code: String {
        switch self {
        case let .unavailable(code): code
        }
    }
}
