import Foundation
import Testing
@testable import XopcMobile

struct RealtimeVoiceProtocolTests {
    @Test func voiceRecoveryMatchesHarmonyTransientFailures() {
        for reason in ["NETWORK", "network", "route_lost", "CAPTURE_FAILED", "PLAYBACK_FAILED",
                       "CAPTURE_INTERRUPTED", "OMNI_CONNECTION_CLOSED", "OMNI_CONNECTION_FAILED"]
        {
            #expect(VoiceRecoveryPolicy.shouldReconnect(reason))
        }
        for reason in ["PROTOCOL_ERROR", "TIME_LIMIT", "MICROPHONE_PERMISSION_DENIED", "user_finished"] {
            #expect(!VoiceRecoveryPolicy.shouldReconnect(reason))
        }
    }

    @Test func voiceDraftMaterializationUsesTheSessionCreationContract() throws {
        let body = MaterializeVoiceCommand(
            commandId: "voice-1",
            creation: SessionCreationCommand(agentId: "main", projectId: nil, execution: nil,
                                             temporary: false, model: "provider/model", thinkingLevel: "off")
        )
        let data = try JSONEncoder().encode(body)
        let json = try #require(JSONSerialization.jsonObject(with: data) as? [String: Any])
        let creation = try #require(json["creation"] as? [String: Any])
        #expect(json["purpose"] as? String == "voice")
        #expect(creation["projectId"] is NSNull)
        #expect(creation["execution"] is NSNull)
        #expect(creation["model"] as? String == "provider/model")
    }

    @Test func uplinkMatchesVersionThreeBinaryHeader() throws {
        let pcm = Data(repeating: 0x7F, count: 640)
        let frame = try RealtimeVoiceProtocol.encodeUplink(
            connectionEpoch: 7,
            utteranceID: "utterance-1",
            sequence: 1,
            capturedAtMonotonicMs: 1234.5,
            start: true,
            audio: pcm
        )
        let bytes = [UInt8](frame)

        #expect(bytes.prefix(8) == [0x58, 0x4F, 0x50, 0x33, 3, 1, 1, 1])
        #expect(bytes[8 ... 11] == [0, 0, 0, 7])
        #expect(bytes[12 ... 15] == [0, 0, 0, 1])
        #expect(bytes[24 ... 25] == [0, 20])
        #expect(bytes[28 ... 31] == [0, 0, 2, 128])
        #expect(frame.count == 32 + "utterance-1".utf8.count + pcm.count)
    }

    @Test func validatesDownlinkAndRejectsInvalidPayload() throws {
        var frame = try RealtimeVoiceProtocol.encodeUplink(
            connectionEpoch: 2,
            utteranceID: "reply-1",
            sequence: 3,
            capturedAtMonotonicMs: 240,
            start: false,
            audio: Data(repeating: 0, count: 960)
        )
        frame[5] = 2
        let downlink = try RealtimeVoiceProtocol.decodeDownlink(frame)
        #expect(downlink.connectionEpoch == 2)
        #expect(downlink.sequence == 3)
        #expect(downlink.responseID == "reply-1")
        #expect(downlink.audio.count == 960)

        frame[7] = 1
        #expect(throws: RealtimeVoiceProtocolError.self) {
            try RealtimeVoiceProtocol.decodeDownlink(frame)
        }
    }

    @Test func validatesVersionThreeEventsAndSessionFormats() throws {
        let event = Data(
            #"""
            {
              "protocolVersion": 3, "eventId": "event-1", "seq": 1,
              "type": "session.ready", "sessionId": "session-1",
              "payload": { "connectionEpoch": 2, "heartbeatIntervalMs": 15000, "route": { "engine": "omni" } }
            }
            """#.utf8
        )
        #expect(try RealtimeVoiceProtocol.decodeEvent(event).type == "session.ready")
        let session = Data(
            #"""
            {
              "sessionId": "session-1", "ticket": "secret", "websocketPath": "/api/voice/realtime/v3/ws",
              "protocolVersion": 3, "connectionEpoch": 2,
              "inputFormat": { "encoding": "pcm_s16le", "sampleRate": 16000, "channels": 1 },
              "media": { "transport": "websocket-pcm", "codec": "pcm_s16le", "frameDurationMs": 20 },
              "limits": { "maxBinaryFrameBytes": 65536, "maxSessionMs": 300000, "idleTimeoutMs": 30000 },
              "route": { "engine": "omni" }
            }
            """#.utf8
        )
        #expect(try JSONDecoder().decode(RealtimeVoiceSession.self, from: session).supportsNativePCM)
        #expect(throws: RealtimeVoiceProtocolError.self) {
            try RealtimeVoiceProtocol.decodeEvent(Data(#"{"protocolVersion":2}"#.utf8))
        }
    }

    @Test func transportUsesSecureRoutesExceptDebugLoopback() throws {
        let sessionData = Data(
            #"""
            {
              "sessionId": "s", "ticket": "t", "websocketPath": "/api/voice/realtime/v3/ws",
              "protocolVersion": 3, "connectionEpoch": 1,
              "inputFormat": { "encoding": "pcm_s16le", "sampleRate": 16000, "channels": 1 },
              "media": { "transport": "websocket-pcm", "codec": "pcm_s16le", "frameDurationMs": 20 },
              "limits": { "maxBinaryFrameBytes": 65536, "maxSessionMs": 300000, "idleTimeoutMs": 30000 },
              "route": { "engine": "omni" }
            }
            """#.utf8
        )
        let session = try JSONDecoder().decode(RealtimeVoiceSession.self, from: sessionData)
        let secure = try RealtimeVoiceTransport.webSocketRoutes(
            origin: #require(URL(string: "https://gateway.example.com")), session: session
        )
        #expect(secure.first?.scheme == "wss")
        #expect(secure.last?.query == "transport=voice-v3")
        #expect(throws: RealtimeVoiceTransportError.self) {
            try RealtimeVoiceTransport.webSocketRoutes(
                origin: #require(URL(string: "http://gateway.example.com")), session: session
            )
        }
        #if DEBUG
            let loopback = try RealtimeVoiceTransport.webSocketRoutes(
                origin: #require(URL(string: "http://127.0.0.1:18790")), session: session
            )
            #expect(loopback.first?.scheme == "ws")
        #endif
    }
}
