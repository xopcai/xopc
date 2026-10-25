import AVFoundation
import Foundation
import SwiftUI
import UIKit

@MainActor final class PhoneVideo {
    let layer = AVSampleBufferDisplayLayer()
    var onGeometry: (Int, Int, Int) -> Void = { _, _, _ in }
    var onPlaying: () -> Void = {}
    private var socket: URLSessionWebSocketTask?
    private var sending: Task<Void, Never>?
    private var format: CMVideoFormatDescription?
    private var sps: Data?
    private var pps: Data?
    private var geometry = 0
    private var keySeen = false
    private var closed = false
    private var epoch = 0
    private var receivedAt = Date()
    private var startedAt = Date()
    private var rendered = false
    private let pointers = PhonePointerQueue()
    init() {
        layer.videoGravity = .resizeAspect
        pointers.send = { [weak self] phase, coordinateX, coordinateY, seq in
            guard let self else { return }
            send(["type": "pointer", "phase": phase, "x": coordinateX, "y": coordinateY, "seq": seq, "epoch": epoch, "geometry": geometry])
        }
        pointers.cancelInput = { [weak self] in
            guard let self else { return }; send(["type": "cancelPointers", "epoch": epoch])
        }
    }

    func pointer(_ phase: String, x coordinateX: Int, y coordinateY: Int) {
        if !closed, epoch > 0 {
            pointers.pointer(phase, x: coordinateX, y: coordinateY)
        }
    }

    private func send(_ packet: [String: Any]) {
        guard let socket, !closed, let data = try? JSONSerialization.data(withJSONObject: packet), let text = String(data: data, encoding: .utf8) else { return }
        let previous = sending
        sending = Task { [weak self] in
            await previous?.value
            guard let self, !self.closed, !Task.isCancelled else { return }
            try? await socket.send(.string(text))
        }
    }

    // swiftlint:disable:next cyclomatic_complexity
    func consume(repository: PhoneRepository, binding: PhoneBinding, state: PhoneLiveState) async throws {
        let ticket = try await repository.ticket(binding, state: state)
        var url = URLComponents(url: repository.client.configuration.baseURL, resolvingAgainstBaseURL: false)!
        url.scheme = url.scheme == "https" ? "wss" : "ws"; url.path = ticket.path; url.query = nil; url.fragment = nil
        guard let target = url.url else { throw GatewayClientError.invalidURL }
        var request = URLRequest(url: target)
        request.setValue("xopc-phone-v1, \(ticket.ticket)", forHTTPHeaderField: "Sec-WebSocket-Protocol")
        try await request.setValue(GatewayPairingService.shared.connectionProof(url: target, ticket: ticket.ticket), forHTTPHeaderField: "X-Xopc-Proof")
        // Admin-only local test configurations still obey the stream's origin check.
        request.setValue(repository.client.configuration.baseURL.absoluteString.trimmingCharacters(in: CharacterSet(charactersIn: "/")), forHTTPHeaderField: "Origin")
        guard !closed, !Task.isCancelled else { throw CancellationError() }
        epoch = state.ownControl ? state.report.controlEpoch : 0
        let active = repository.client.session.webSocketTask(with: request)
        socket = active; startedAt = Date(); receivedAt = Date(); active.maximumMessageSize = 4 * 1024 * 1024; active.resume()
        let heartbeat = Task { [weak self] in
            while !Task.isCancelled {
                try await Task.sleep(for: .seconds(3))
                guard let self, !self.closed else { return }
                if (!rendered && Date().timeIntervalSince(startedAt) > 8) || Date().timeIntervalSince(receivedAt) > 12 {
                    close(); return
                }
                if let since = pointers.pendingSince, Date().timeIntervalSince(since) > 5 {
                    close(); return
                }
                send(["type": "ping"])
            }
        }
        defer { heartbeat.cancel(); close() }
        while !Task.isCancelled, !closed {
            let message = try await active.receive()
            receivedAt = Date()
            switch message {
            case let .string(text):
                guard let data = text.data(using: .utf8), let object = try JSONSerialization.jsonObject(with: data) as? [String: Any] else { continue }
                if object["type"] as? String == "fault" {
                    throw GatewayClientError.server("Phone stream unavailable")
                }
                if object["type"] as? String == "ack", let seq = object["seq"] as? Int {
                    pointers.ack(seq)
                }
                if object["type"] as? String == "geometry", let width = object["width"] as? Int,
                   let height = object["height"] as? Int, let version = object["version"] as? Int
                {
                    guard (1 ... 8192).contains(width), (1 ... 8192).contains(height) else { throw GatewayClientError.invalidResponse }
                    pointers.cancel(); geometry = version; format = nil; sps = nil; pps = nil; keySeen = false
                    layer.flushAndRemoveImage(); onGeometry(width, height, version)
                }
            case let .data(data): try decode(data)
            @unknown default: throw GatewayClientError.invalidResponse
            }
        }
    }

    func close() {
        guard !closed else { return }
        pointers.cancel(); closed = true; sending?.cancel(); sending = nil; socket?.cancel(with: .goingAway, reason: nil); socket = nil
        layer.flushAndRemoveImage(); format = nil; sps = nil; pps = nil
    }

    // swiftlint:disable cyclomatic_complexity function_body_length
    private func decode(_ packet: Data) throws {
        guard packet.count > 32, packet.count <= 4 * 1024 * 1024, readUInt(packet, 4, 4) == UInt64(geometry) else { return }
        let flags = packet[0]
        let units = Self.nalUnits(Data(packet.dropFirst(32)))
        for unit in units where !unit.isEmpty {
            if unit[0] & 31 == 7 {
                sps = unit
            }
            if unit[0] & 31 == 8 {
                pps = unit
            }
        }
        if format == nil, let sps, let pps {
            let status = sps.withUnsafeBytes { spsBytes in pps.withUnsafeBytes { ppsBytes in
                let pointers = [spsBytes.baseAddress!.assumingMemoryBound(to: UInt8.self), ppsBytes.baseAddress!.assumingMemoryBound(to: UInt8.self)]
                return pointers.withUnsafeBufferPointer { pointerBuffer in
                    [sps.count, pps.count].withUnsafeBufferPointer { sizes in
                        CMVideoFormatDescriptionCreateFromH264ParameterSets(allocator: kCFAllocatorDefault, parameterSetCount: 2,
                                                                            parameterSetPointers: pointerBuffer.baseAddress!, parameterSetSizes: sizes.baseAddress!, nalUnitHeaderLength: 4, formatDescriptionOut: &format)
                    }
                }
            } }
            guard status == noErr else { throw GatewayClientError.invalidResponse }
        }
        guard flags & 1 == 0, let format, keySeen || flags & 2 != 0 else { return }
        if flags & 2 != 0 {
            keySeen = true
        }
        var bytes = Data()
        for unit in units {
            var length = UInt32(unit.count).bigEndian
            withUnsafeBytes(of: &length) { bytes.append(contentsOf: $0) }; bytes.append(unit)
        }
        guard !bytes.isEmpty else { return }
        var block: CMBlockBuffer?
        guard CMBlockBufferCreateWithMemoryBlock(allocator: kCFAllocatorDefault, memoryBlock: nil, blockLength: bytes.count,
                                                 blockAllocator: kCFAllocatorDefault, customBlockSource: nil, offsetToData: 0, dataLength: bytes.count, flags: 0, blockBufferOut: &block) == noErr,
            let block else { throw GatewayClientError.invalidResponse }
        let status = bytes.withUnsafeBytes { CMBlockBufferReplaceDataBytes(with: $0.baseAddress!, blockBuffer: block, offsetIntoDestination: 0, dataLength: bytes.count) }
        guard status == noErr else { throw GatewayClientError.invalidResponse }
        var sample: CMSampleBuffer?
        var size = bytes.count
        var timing = CMSampleTimingInfo(duration: .invalid, presentationTimeStamp: CMTime(value: Int64(readUInt(packet, 12, 8)), timescale: 1_000_000), decodeTimeStamp: .invalid)
        guard CMSampleBufferCreateReady(allocator: kCFAllocatorDefault, dataBuffer: block, formatDescription: format, sampleCount: 1,
                                        sampleTimingEntryCount: 1, sampleTimingArray: &timing, sampleSizeEntryCount: 1, sampleSizeArray: &size, sampleBufferOut: &sample) == noErr,
            let sample else { throw GatewayClientError.invalidResponse }
        if let array = CMSampleBufferGetSampleAttachmentsArray(sample, createIfNecessary: true) {
            let dictionary = unsafeBitCast(CFArrayGetValueAtIndex(array, 0), to: CFMutableDictionary.self)
            CFDictionarySetValue(dictionary, Unmanaged.passUnretained(kCMSampleAttachmentKey_DisplayImmediately).toOpaque(), Unmanaged.passUnretained(kCFBooleanTrue).toOpaque())
        }
        guard layer.sampleBufferRenderer.isReadyForMoreMediaData else { throw GatewayClientError.server("Phone decoder overloaded") }
        layer.sampleBufferRenderer.enqueue(sample)
        if layer.status == .failed {
            throw GatewayClientError.server("Phone decoder failed")
        }
        if !rendered {
            rendered = true; onPlaying()
        }
    }

    // swiftlint:enable cyclomatic_complexity function_body_length

    private func readUInt(_ data: Data, _ offset: Int, _ count: Int) -> UInt64 {
        data[offset ..< (offset + count)].reduce(0) { ($0 << 8) | UInt64($1) }
    }

    static func nalUnits(_ data: Data) -> [Data] {
        let bytes = Array(data); var starts: [(Int, Int)] = []; var index = 0
        while index + 3 <= bytes.count {
            if bytes[index] == 0, bytes[index + 1] == 0 {
                if bytes[index + 2] == 1 {
                    starts.append((index, index + 3)); index += 3; continue
                }
                if index + 4 <= bytes.count, bytes[index + 2] == 0, bytes[index + 3] == 1 {
                    starts.append((index, index + 4)); index += 4; continue
                }
            }
            index += 1
        }
        return starts.enumerated().compactMap { offset, start in
            let end = offset + 1 < starts.count ? starts[offset + 1].0 : bytes.count
            return end > start.1 ? Data(bytes[start.1 ..< end]) : nil
        }
    }
}

struct PhoneVideoSurface: UIViewRepresentable {
    let video: PhoneVideo?
    func makeUIView(context _: Context) -> PhoneVideoHost {
        PhoneVideoHost()
    }

    func updateUIView(_ view: PhoneVideoHost, context _: Context) {
        view.show(video?.layer)
    }
}

final class PhoneVideoHost: UIView {
    private var display: AVSampleBufferDisplayLayer?
    func show(_ next: AVSampleBufferDisplayLayer?) {
        if display !== next {
            display?.removeFromSuperlayer(); display = next; if let next {
                layer.addSublayer(next)
            }
        }
        setNeedsLayout()
    }

    override func layoutSubviews() {
        super.layoutSubviews(); display?.frame = bounds
    }
}
