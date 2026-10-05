import Foundation

enum RealtimeVoiceProtocolError: Error, Sendable {
    case invalidFrame
    case invalidEvent
}

struct RealtimeVoiceDownlinkFrame: Equatable, Sendable {
    let connectionEpoch: UInt32
    let responseID: String
    let sequence: UInt32
    let mediaTimestampMs: Double
    let audio: Data
}

enum RealtimeVoiceProtocol {
    static let version = 3
    static let maxFrameBytes = 64 * 1024
    private static let magic: UInt32 = 0x584F5033
    private static let headerBytes = 32

    static func encodeUplink(
        connectionEpoch: UInt32,
        utteranceID: String,
        sequence: UInt32,
        capturedAtMonotonicMs: Double,
        start: Bool,
        end: Bool = false,
        audio: Data
    ) throws -> Data {
        let identifier = Data(utteranceID.utf8)
        guard connectionEpoch > 0, sequence > 0, !identifier.isEmpty, identifier.count <= 160,
              !audio.isEmpty, audio.count.isMultiple(of: 2),
              headerBytes + identifier.count + audio.count <= maxFrameBytes,
              capturedAtMonotonicMs.isFinite
        else { throw RealtimeVoiceProtocolError.invalidFrame }

        var frame = Data(capacity: headerBytes + identifier.count + audio.count)
        frame.appendInteger(magic)
        frame.append(contentsOf: [UInt8(version), 1, 1, (start ? 1 : 0) | (end ? 2 : 0)])
        frame.appendInteger(connectionEpoch)
        frame.appendInteger(sequence)
        frame.appendInteger(capturedAtMonotonicMs.bitPattern)
        frame.appendInteger(UInt16(20))
        frame.appendInteger(UInt16(identifier.count))
        frame.appendInteger(UInt32(audio.count))
        frame.append(identifier)
        frame.append(audio)
        return frame
    }

    static func decodeDownlink(_ data: Data) throws -> RealtimeVoiceDownlinkFrame {
        let bytes = [UInt8](data)
        guard bytes.count > headerBytes, bytes.count <= maxFrameBytes,
              integer(bytes, at: 0, as: UInt32.self) == magic,
              bytes[4] == UInt8(version), bytes[5] == 2, bytes[6] == 1, bytes[7] == 0,
              let epoch = integer(bytes, at: 8, as: UInt32.self), epoch > 0,
              let sequence = integer(bytes, at: 12, as: UInt32.self), sequence > 0,
              let timestamp = integer(bytes, at: 16, as: UInt64.self),
              integer(bytes, at: 24, as: UInt16.self) == 20,
              let identifierLength = integer(bytes, at: 26, as: UInt16.self), identifierLength > 0,
              identifierLength <= 160,
              let payloadLength = integer(bytes, at: 28, as: UInt32.self), payloadLength > 0,
              payloadLength.isMultiple(of: 2),
              headerBytes + Int(identifierLength) + Int(payloadLength) == bytes.count,
              let responseID = String(bytes: bytes[headerBytes ..< headerBytes + Int(identifierLength)], encoding: .utf8)
        else { throw RealtimeVoiceProtocolError.invalidFrame }

        return RealtimeVoiceDownlinkFrame(
            connectionEpoch: epoch,
            responseID: responseID,
            sequence: sequence,
            mediaTimestampMs: Double(bitPattern: timestamp),
            audio: Data(bytes[(headerBytes + Int(identifierLength))...])
        )
    }

    static func decodeEvent(_ data: Data) throws -> RealtimeVoiceEvent {
        guard data.count <= 16 * 1024,
              let event = try? JSONDecoder().decode(RealtimeVoiceEvent.self, from: data),
              event.protocolVersion == version, !event.eventId.isEmpty, !event.sessionId.isEmpty,
              !event.type.isEmpty, event.seq > 0
        else { throw RealtimeVoiceProtocolError.invalidEvent }
        return event
    }

    private static func integer<T: FixedWidthInteger>(_ bytes: [UInt8], at offset: Int, as _: T.Type) -> T? {
        guard offset + MemoryLayout<T>.size <= bytes.count else { return nil }
        return bytes[offset ..< offset + MemoryLayout<T>.size].reduce(T.zero) { ($0 << 8) | T($1) }
    }
}

private extension Data {
    mutating func appendInteger<T: FixedWidthInteger>(_ value: T) {
        for shift in stride(from: (MemoryLayout<T>.size - 1) * 8, through: 0, by: -8) {
            append(UInt8(truncatingIfNeeded: value >> shift))
        }
    }
}
