import AVFAudio
import Foundation

@MainActor
final class RealtimeVoiceAudio {
    private var engine: AVAudioEngine?
    private var player: AVAudioPlayerNode?
    private var inputContinuation: AsyncStream<Data>.Continuation?
    private var interruptionObserver: NSObjectProtocol?
    private var routeObserver: NSObjectProtocol?
    private var engineObserver: NSObjectProtocol?
    private var playbackGeneration = 0
    private var playedMilliseconds: [String: Int] = [:]
    private var onPlayed: ((String, Int) -> Void)?
    private var onInterrupted: (() -> Void)?
    private var onRoute: ((String) -> Void)?
    private var onRouteFailure: (() -> Void)?
    private(set) var isMuted = false

    // swiftlint:disable:next function_body_length
    func start(
        onPlayed: @escaping (String, Int) -> Void,
        onInterrupted: @escaping () -> Void,
        onRoute: @escaping (String) -> Void,
        onRouteFailure: @escaping () -> Void
    ) async throws -> AsyncStream<Data> {
        stop()
        guard await AVAudioApplication.requestRecordPermission() else {
            throw RealtimeVoiceAudioError.microphonePermissionDenied
        }
        let session = AVAudioSession.sharedInstance()
        try session.setCategory(.playAndRecord, mode: .voiceChat, options: [.allowBluetoothHFP])
        try session.setActive(true)

        let engine = AVAudioEngine()
        let player = AVAudioPlayerNode()
        let outputFormat = try Self.pcmFormat(sampleRate: 24000)
        engine.attach(player)
        engine.connect(player, to: engine.mainMixerNode, format: outputFormat)
        let inputFormat = engine.inputNode.outputFormat(forBus: 0)
        guard let converter = try AVAudioConverter(from: inputFormat, to: Self.pcmFormat(sampleRate: 16000)) else {
            throw RealtimeVoiceAudioError.unsupportedInputFormat
        }
        let stream = AsyncStream<Data>(bufferingPolicy: .bufferingNewest(32)) { continuation in
            inputContinuation = continuation
            RealtimeVoiceCapture(converter: converter, continuation: continuation)
                .install(on: engine.inputNode, inputFormat: inputFormat)
        }
        do {
            try engine.start()
            player.play()
            self.engine = engine
            self.player = player
            self.onPlayed = onPlayed
            self.onInterrupted = onInterrupted
            self.onRoute = onRoute
            self.onRouteFailure = onRouteFailure
            interruptionObserver = NotificationCenter.default.addObserver(
                forName: AVAudioSession.interruptionNotification, object: session, queue: .main
            ) { [weak self] notification in
                let reason = notification.userInfo?[AVAudioSessionInterruptionTypeKey] as? UInt
                if reason == AVAudioSession.InterruptionType.began.rawValue {
                    Task { @MainActor [weak self] in self?.onInterrupted?() }
                }
            }
            routeObserver = NotificationCenter.default.addObserver(
                forName: AVAudioSession.routeChangeNotification, object: session, queue: .main
            ) { [weak self] _ in
                Task { @MainActor [weak self] in
                    guard let self else { return }
                    self.onRoute?(Self.routeName())
                }
            }
            engineObserver = NotificationCenter.default.addObserver(
                forName: .AVAudioEngineConfigurationChange, object: engine, queue: .main
            ) { [weak self] _ in
                Task { @MainActor [weak self] in
                    guard let self, let engine = self.engine, !engine.isRunning else { return }
                    self.onRouteFailure?()
                }
            }
            onRoute(Self.routeName())
            return stream
        } catch {
            engine.inputNode.removeTap(onBus: 0)
            engine.stop()
            inputContinuation?.finish()
            inputContinuation = nil
            try? session.setActive(false, options: .notifyOthersOnDeactivation)
            throw error
        }
    }

    func setMuted(_ muted: Bool) {
        isMuted = muted
    }

    func setSpeaker(_ speaker: Bool) throws {
        try AVAudioSession.sharedInstance().overrideOutputAudioPort(speaker ? .speaker : .none)
        onRoute?(Self.routeName())
    }

    func enqueue(responseID: String, pcm: Data) throws {
        guard let player else { throw RealtimeVoiceAudioError.notStarted }
        guard pcm.count == 960 else { throw RealtimeVoiceAudioError.invalidOutputFrame }
        let format = try Self.pcmFormat(sampleRate: 24000)
        guard let buffer = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: 480),
              let samples = buffer.int16ChannelData?[0]
        else { throw RealtimeVoiceAudioError.invalidOutputFrame }
        buffer.frameLength = 480
        pcm.withUnsafeBytes { raw in
            if let source = raw.baseAddress {
                memcpy(samples, source, pcm.count)
            }
        }
        let current = playbackGeneration
        player.scheduleBuffer(buffer, completionCallbackType: .dataPlayedBack) { [weak self] _ in
            Task { @MainActor [weak self] in
                guard let self, current == playbackGeneration else { return }
                let total = (playedMilliseconds[responseID] ?? 0) + 20
                playedMilliseconds[responseID] = total
                onPlayed?(responseID, total)
            }
        }
    }

    func flush() {
        playbackGeneration += 1
        player?.stop()
        player?.play()
        playedMilliseconds.removeAll()
    }

    func stop() {
        playbackGeneration += 1
        if let engine {
            engine.inputNode.removeTap(onBus: 0)
            engine.stop()
        }
        player?.stop()
        engine = nil
        player = nil
        inputContinuation?.finish()
        inputContinuation = nil
        if let interruptionObserver {
            NotificationCenter.default.removeObserver(interruptionObserver)
            self.interruptionObserver = nil
        }
        if let routeObserver {
            NotificationCenter.default.removeObserver(routeObserver); self.routeObserver = nil
        }
        if let engineObserver {
            NotificationCenter.default.removeObserver(engineObserver); self.engineObserver = nil
        }
        onPlayed = nil
        onInterrupted = nil
        onRoute = nil
        onRouteFailure = nil
        playedMilliseconds.removeAll()
        isMuted = false
        try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
    }

    private static func pcmFormat(sampleRate: Double) throws -> AVAudioFormat {
        guard let format = AVAudioFormat(
            commonFormat: .pcmFormatInt16, sampleRate: sampleRate, channels: 1, interleaved: false
        ) else { throw RealtimeVoiceAudioError.unsupportedInputFormat }
        return format
    }

    private static func routeName() -> String {
        guard let port = AVAudioSession.sharedInstance().currentRoute.outputs.first?.portType else { return "system" }
        switch port {
        case .builtInSpeaker: return "speaker"
        case .builtInReceiver: return "earpiece"
        case .bluetoothHFP, .bluetoothA2DP, .bluetoothLE: return "bluetooth"
        case .headphones, .headsetMic, .usbAudio: return "headset"
        default: return "system"
        }
    }
}

private final class RealtimeVoiceCapture: @unchecked Sendable {
    private let converter: AVAudioConverter
    private let continuation: AsyncStream<Data>.Continuation

    init(converter: AVAudioConverter, continuation: AsyncStream<Data>.Continuation) {
        self.converter = converter
        self.continuation = continuation
    }

    func install(on input: AVAudioInputNode, inputFormat: AVAudioFormat) {
        input.installTap(onBus: 0, bufferSize: 1024, format: inputFormat) { [self] buffer, _ in
            let capacity = AVAudioFrameCount(ceil(Double(buffer.frameLength) * 16000 / inputFormat.sampleRate)) + 8
            guard let target = AVAudioPCMBuffer(pcmFormat: converter.outputFormat, frameCapacity: capacity) else { return }
            var error: NSError?
            let feed = RealtimeVoiceInputFeed(buffer: buffer)
            let status = converter.convert(to: target, error: &error) { _, inputStatus in
                feed.next(status: inputStatus)
            }
            guard status == .haveData, error == nil,
                  target.frameLength > 0, let samples = target.int16ChannelData?[0]
            else { return }
            continuation.yield(Data(bytes: samples, count: Int(target.frameLength) * 2))
        }
    }
}

private final class RealtimeVoiceInputFeed: @unchecked Sendable {
    private let buffer: AVAudioPCMBuffer
    private var provided = false

    init(buffer: AVAudioPCMBuffer) {
        self.buffer = buffer
    }

    func next(status: UnsafeMutablePointer<AVAudioConverterInputStatus>) -> AVAudioBuffer? {
        guard !provided else {
            status.pointee = .noDataNow
            return nil
        }
        provided = true
        status.pointee = .haveData
        return buffer
    }
}

enum RealtimeVoiceAudioError: Error {
    case microphonePermissionDenied
    case unsupportedInputFormat
    case invalidOutputFrame
    case notStarted

    var code: String {
        switch self {
        case .microphonePermissionDenied: "MICROPHONE_PERMISSION_DENIED"
        case .unsupportedInputFormat, .invalidOutputFrame, .notStarted: "AUDIO_UNAVAILABLE"
        }
    }
}
