import ExpoModulesCore
import AVFoundation
import MediaPlayer

private final class NearSpeechDetector {
  private let lock = NSLock()
  private var noiseFloor = 120.0
  private var loudFrames = 0
  private var quietFrames = 0
  private var active = false

  func process(_ samples: UnsafePointer<Int16>, count: Int) -> Bool? {
    lock.withLock {
      guard count > 0 else { return nil }
      var total: Int64 = 0
      for index in 0..<count { total += Int64(abs(Int(samples[index]))) }
      let level = Double(total) / Double(count)
      let threshold = max(600.0, noiseFloor * 3.0)
      if !active {
        if level >= threshold {
          loudFrames += 1
          if loudFrames >= 2 { active = true; quietFrames = 0; return true }
        } else { loudFrames = 0; noiseFloor = noiseFloor * 0.95 + level * 0.05 }
        return nil
      }
      quietFrames = level < threshold * 0.7 ? quietFrames + 1 : 0
      if quietFrames >= 6 { active = false; loudFrames = 0; quietFrames = 0; return false }
      return nil
    }
  }

  func reset() { lock.withLock { loudFrames = 0; quietFrames = 0; active = false } }
}

public final class XopcVoiceModule: Module {
  private var engine: AVAudioEngine?
  private var player: AVAudioPlayerNode?
  private var observers: [NSObjectProtocol] = []
  private let captureLock = NSLock()
  private var captureEnabled = false
  private var captureId = 0
  private var remoteStop: Any?
  private var tapInstalled = false
  private var backgroundEnabled = false
  private var epoch = 0
  private var playbackEpoch = 0
  private var responseId = ""
  private var submitted = 0
  private var played = 0
  private var configurationRestarts: [TimeInterval] = []
  private let nearSpeech = NearSpeechDetector()
  private let output = AVAudioFormat(standardFormatWithSampleRate: 24000, channels: 1)!

  public func definition() -> ModuleDefinition {
    Name("XopcVoice")
    Events("pcm", "played", "interrupted", "speechCandidate", "route")
    AsyncFunction("start") { (background: Bool, _title: String, _stopLabel: String) in
      try self.start(background: background, title: _title)
    }.runOnQueue(.main)
    Function("setCaptureEnabled") { (enabled: Bool, id: Int) in
      self.nearSpeech.reset()
      self.captureLock.withLock { self.captureEnabled = enabled; self.captureId = id }
    }
    AsyncFunction("enqueue") { (id: String, audio: String) in try self.enqueue(id: id, audio: audio) }.runOnQueue(.main)
    AsyncFunction("duck") { self.player?.volume = 0.2 }.runOnQueue(.main)
    AsyncFunction("resumeOutput") { self.player?.volume = 1.0 }.runOnQueue(.main)
    AsyncFunction("flush") { self.flush() }.runOnQueue(.main)
    AsyncFunction("stop") { self.stop() }.runOnQueue(.main)
    AsyncFunction("setSpeaker") { (enabled: Bool) in
      try AVAudioSession.sharedInstance().overrideOutputAudioPort(enabled ? .speaker : .none)
    }.runOnQueue(.main)
    OnAppEntersBackground {
      if !self.backgroundEnabled && self.engine != nil { self.interrupt("background") }
    }
    OnDestroy { self.stop() }
  }

  private func start(background: Bool, title: String) throws -> [String: Any] {
    stop()
    let session = AVAudioSession.sharedInstance()
    try session.setCategory(.playAndRecord, mode: .voiceChat, options: [.defaultToSpeaker, .allowBluetooth])
    try session.setActive(true)
    let engine = AVAudioEngine()
    self.engine = engine
    backgroundEnabled = background
    do {
      try engine.inputNode.setVoiceProcessingEnabled(true)
      try installCaptureTap(on: engine)
      let player = AVAudioPlayerNode()
      engine.attach(player)
      engine.connect(player, to: engine.mainMixerNode, format: output)
      self.player = player
      try engine.start()
      player.play()
      if background {
        MPNowPlayingInfoCenter.default().nowPlayingInfo = [MPMediaItemPropertyTitle: title, MPNowPlayingInfoPropertyIsLiveStream: true]
        remoteStop = MPRemoteCommandCenter.shared().stopCommand.addTarget { [weak self] _ in
          DispatchQueue.main.async { self?.interrupt("ended") }
          return .success
        }
        MPRemoteCommandCenter.shared().stopCommand.isEnabled = true
      }
      observers = [
        NotificationCenter.default.addObserver(forName: .AVAudioEngineConfigurationChange, object: engine, queue: nil) { [weak self, weak engine] _ in
          // Never tear down the engine on its internal notification queue.
          DispatchQueue.main.async { [weak self, weak engine] in
            guard let engine else { return }
            self?.restoreConfiguration(of: engine)
          }
        },
        NotificationCenter.default.addObserver(forName: AVAudioSession.interruptionNotification, object: session, queue: .main) { [weak self] notification in
          if let raw = notification.userInfo?[AVAudioSessionInterruptionTypeKey] as? UInt,
             raw == AVAudioSession.InterruptionType.began.rawValue { self?.interrupt("interruption") }
        },
        NotificationCenter.default.addObserver(forName: AVAudioSession.routeChangeNotification, object: session, queue: .main) { [weak self] notification in
          if let raw = notification.userInfo?[AVAudioSessionRouteChangeReasonKey] as? UInt,
             raw == AVAudioSession.RouteChangeReason.oldDeviceUnavailable.rawValue { self?.interrupt("route_lost") }
          else if let self { self.sendEvent("route", self.routeCapabilities()) }
        }
      ]
      return routeCapabilities()
    } catch { stop(); throw error }
  }

  private func routeCapabilities() -> [String: Any] {
    let port = AVAudioSession.sharedInstance().currentRoute.outputs.first?.portType
    let output: String
    switch port {
    case .builtInReceiver: output = "receiver"
    case .headphones, .headsetMic, .usbAudio: output = "wired"
    case .bluetoothA2DP, .bluetoothHFP, .bluetoothLE: output = "bluetooth"
    default: output = "speaker"
    }
    return ["output": output, "echoControl": "verified", "fullDuplex": true]
  }

  private func installCaptureTap(on engine: AVAudioEngine) throws {
    let input = engine.inputNode.outputFormat(forBus: 0)
    guard input.sampleRate > 0,
      let target = AVAudioFormat(commonFormat: .pcmFormatInt16, sampleRate: 16000, channels: 1, interleaved: true),
      let converter = AVAudioConverter(from: input, to: target) else {
      throw NSError(domain: "XopcVoice", code: 1, userInfo: [NSLocalizedDescriptionKey: "Microphone format unavailable"])
    }
    let currentEpoch = epoch
    engine.inputNode.installTap(onBus: 0, bufferSize: AVAudioFrameCount(input.sampleRate * 0.04), format: input) { [weak self] buffer, _ in
      guard let self else { return }
      let capture = self.captureLock.withLock { (self.captureEnabled, self.captureId) }
      guard capture.0 else { return }
      let capacity = AVAudioFrameCount(ceil(Double(buffer.frameLength) * 16000 / input.sampleRate) + 32)
      guard let converted = AVAudioPCMBuffer(pcmFormat: target, frameCapacity: capacity) else { return }
      var supplied = false
      var error: NSError?
      converter.convert(to: converted, error: &error) { _, status in
        if supplied { status.pointee = .noDataNow; return nil }
        supplied = true
        status.pointee = .haveData
        return buffer
      }
      guard error == nil, let samples = converted.int16ChannelData, converted.frameLength > 0 else { return }
      let speechCandidate = self.nearSpeech.process(samples[0], count: Int(converted.frameLength))
      let audio = Data(bytes: samples[0], count: Int(converted.frameLength) * 2).base64EncodedString()
      DispatchQueue.main.async { [weak self] in
        guard let self, self.epoch == currentEpoch else { return }
        let valid = self.captureLock.withLock { self.captureEnabled && self.captureId == capture.1 }
        guard valid else { return }
        if let speechCandidate { self.sendEvent("speechCandidate", ["active": speechCandidate, "captureId": capture.1]) }
        self.sendEvent("pcm", ["audio": audio, "captureId": capture.1])
      }
    }
    tapInstalled = true
  }

  private func restoreConfiguration(of engine: AVAudioEngine) {
    guard self.engine === engine, !engine.isRunning else { return }
    let now = ProcessInfo.processInfo.systemUptime
    configurationRestarts.removeAll { now - $0 > 1 }
    // Rebuild for negotiated hardware formats, but never acknowledge discarded speech.
    guard submitted == played, configurationRestarts.count < 3,
      !AVAudioSession.sharedInstance().currentRoute.inputs.isEmpty,
      !AVAudioSession.sharedInstance().currentRoute.outputs.isEmpty else {
      interrupt("route_lost")
      return
    }
    configurationRestarts.append(now)
    epoch += 1
    playbackEpoch += 1
    player?.stop()
    if tapInstalled { engine.inputNode.removeTap(onBus: 0) }
    tapInstalled = false
    do {
      try installCaptureTap(on: engine)
      try engine.start()
      player?.play()
    } catch { interrupt("route_lost") }
  }

  private func enqueue(id: String, audio: String) throws {
    guard let player, let data = Data(base64Encoded: audio), !data.isEmpty, data.count % 2 == 0 else { return }
    if responseId != id { flush(); responseId = id }
    guard submitted - played + data.count <= 96000 else {
      throw NSError(domain: "XopcVoice", code: 2, userInfo: [NSLocalizedDescriptionKey: "Playback buffer full"])
    }
    let frames = data.count / 2
    guard let buffer = AVAudioPCMBuffer(pcmFormat: output, frameCapacity: AVAudioFrameCount(frames)),
      let destination = buffer.floatChannelData?[0] else { return }
    data.withUnsafeBytes { raw in
      for i in 0..<frames {
        destination[i] = Float(Int16(littleEndian: raw.loadUnaligned(fromByteOffset: i * 2, as: Int16.self))) / 32768
      }
    }
    buffer.frameLength = AVAudioFrameCount(frames)
    submitted += data.count
    let end = submitted
    let generation = playbackEpoch
    player.scheduleBuffer(buffer, completionCallbackType: .dataPlayedBack) { [weak self] _ in
      DispatchQueue.main.async {
        guard let self, self.playbackEpoch == generation, self.responseId == id,
          self.engine?.isRunning == true else { return }
        self.played = max(self.played, end)
        self.sendEvent("played", ["responseId": id, "playedBytes": self.played])
      }
    }
    if !player.isPlaying { player.play() }
  }

  private func flush() {
    playbackEpoch += 1
    player?.stop()
    responseId = ""
    submitted = 0
    played = 0
  }

  private func interrupt(_ reason: String) {
    guard engine != nil else { return }
    stop()
    sendEvent("interrupted", ["reason": reason])
  }

  private func stop() {
    epoch += 1
    captureLock.withLock { captureEnabled = false; captureId += 1 }
    flush()
    observers.forEach { NotificationCenter.default.removeObserver($0) }
    observers = []
    if let remoteStop {
      MPRemoteCommandCenter.shared().stopCommand.removeTarget(remoteStop)
      MPNowPlayingInfoCenter.default().nowPlayingInfo = nil
    }
    remoteStop = nil
    if tapInstalled { engine?.inputNode.removeTap(onBus: 0) }
    tapInstalled = false
    engine?.stop()
    engine = nil
    player = nil
    backgroundEnabled = false
    configurationRestarts = []
    nearSpeech.reset()
    try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
  }
}
