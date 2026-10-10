import Foundation

struct VoicePayload<Value: Decodable & Sendable>: Decodable, Sendable {
    let payload: Value
}

struct RealtimeVoiceStatus: Decodable, Sendable {
    let enabled: Bool
    let defaultMode: String
    let capabilities: Capabilities

    struct Capabilities: Decodable, Sendable {
        let natural: Availability
        let assistant: Availability
        let languages: [String]
        let bargeIn: Bool
    }

    struct Availability: Decodable, Sendable {
        let available: Bool
        let reasonCode: String?
    }
}

enum RealtimeVoiceMode: String, CaseIterable, Sendable {
    case natural
    case assistant

    var title: LocalizedStringResource {
        switch self {
        case .natural: "实时语音"
        case .assistant: "语音助手"
        }
    }
}

struct RealtimeVoiceSessionRequest: Encodable, Sendable {
    let purpose = "conversation"
    let conversationId: String
    let mode: RealtimeVoiceMode
    let supportedProtocolVersions = [3]
    let mediaPreferences = ["websocket-pcm"]
}

extension RealtimeVoiceMode: Encodable {
    func encode(to encoder: Encoder) throws {
        var container = encoder.singleValueContainer()
        try container.encode(rawValue)
    }
}

struct RealtimeVoiceSession: Decodable, Sendable {
    let sessionId: String
    let ticket: String
    let websocketPath: String
    let protocolVersion: Int
    let connectionEpoch: UInt32
    let inputFormat: AudioFormat
    let media: MediaFormat
    let limits: Limits
    let route: Route

    struct AudioFormat: Decodable, Sendable {
        let encoding: String
        let sampleRate: Int
        let channels: Int
    }

    struct MediaFormat: Decodable, Sendable {
        let transport: String
        let codec: String
        let frameDurationMs: Int
    }

    struct Limits: Decodable, Sendable {
        let maxBinaryFrameBytes: Int
        let maxSessionMs: Int
        let idleTimeoutMs: Int
    }

    struct Route: Decodable, Sendable {
        let engine: String
    }

    var supportsNativePCM: Bool {
        protocolVersion == 3 && websocketPath == "/api/voice/realtime/v3/ws"
            && inputFormat.sampleRate == 16000 && inputFormat.channels == 1
            && inputFormat.encoding == "pcm_s16le" && media.transport == "websocket-pcm"
            && media.frameDurationMs == 20
    }
}

struct RealtimeVoiceEvent: Decodable, Sendable {
    let protocolVersion: Int
    let eventId: String
    let seq: Int
    let type: String
    let sessionId: String
    let payload: Payload

    struct Payload: Decodable, Sendable {
        let connectionEpoch: UInt32?
        let heartbeatIntervalMs: Int?
        let route: RealtimeVoiceSession.Route?
        let responseId: String?
        let taskId: String?
        let toolName: String?
        let status: String?
        let text: String?
        let utteranceId: String?
        let delta: String?
        let audio: Bool?
        let reason: String?
        let code: String?
        let recoverable: Bool?
        let requestId: String?
        let question: String?
        let choices: [String]?
        let suggestedAnswer: String?
        let version: Int?
        let format: RealtimeVoiceSession.AudioFormat?
    }
}

struct RealtimeVoiceControlPayload: Encodable, Sendable {
    var sessionId: String?
    var ticket: String?
    var muted: Bool?
    var responseId: String?
    var playedDurationMs: Int?
    var taskId: String?
    var reason: String?
    var metric: String?
    var durationMs: Double?
}

struct RealtimeVoiceControlMessage: Encodable, Sendable {
    let protocolVersion = 3
    let messageId = UUID().uuidString.lowercased()
    let type: String
    let sentAt = Int(Date().timeIntervalSince1970 * 1000)
    let payload: RealtimeVoiceControlPayload
}

struct RealtimeVoiceApproval: Decodable, Sendable {
    let id: String
    let conversationId: String
    let actionId: String
    let status: String
    let expiresAt: String

    var isUnexpired: Bool {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return (formatter.date(from: expiresAt) ?? ISO8601DateFormatter().date(from: expiresAt) ?? .distantPast) > Date()
    }
}

struct RealtimeVoiceApprovals: Decodable, Sendable {
    let approvals: [RealtimeVoiceApproval]
}

/// Monotonic reply timing. All mutations belong to the call's MainActor.
struct RealtimeVoiceFirstAudioTiming: Sendable {
    private struct Reply: Sendable {
        let stoppedAt: Double?
        var received = false
        var buffered = false
    }

    private var stoppedAt: Double?
    private var replies: [String: Reply] = [:]

    mutating func speechStarted() {
        stoppedAt = nil
    }

    mutating func speechStopped(_ now: Double) {
        stoppedAt = now
    }

    mutating func created(_ id: String) {
        guard !id.isEmpty, replies[id] == nil else { return }
        // Only one response is accepted by the native call at a time.
        replies = [id: Reply(stoppedAt: stoppedAt)]
        stoppedAt = nil
    }

    mutating func received(_ id: String, now: Double) -> Double? {
        guard var reply = replies[id], !reply.received else { return nil }
        reply.received = true
        replies[id] = reply
        return reply.stoppedAt.map { max(0, now - $0) }
    }

    mutating func buffered(_ id: String, now: Double) -> Double? {
        guard var reply = replies[id], reply.received, !reply.buffered else { return nil }
        reply.buffered = true
        replies[id] = reply
        return reply.stoppedAt.map { max(0, now - $0) }
    }

    mutating func finish(_ id: String) {
        replies.removeValue(forKey: id)
    }

    mutating func reset() {
        stoppedAt = nil; replies.removeAll()
    }
}
