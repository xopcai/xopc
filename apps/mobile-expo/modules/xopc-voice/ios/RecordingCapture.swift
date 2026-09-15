import AVFoundation
import Foundation

/// Native-only capture: audio never crosses the JS bridge before being saved.
/// Lifecycle methods run on a dedicated queue; disk writes run on a bounded serial queue.
final class RecordingCapture {
  let lifecycle = DispatchQueue(label: "ai.xopc.recording.lifecycle", qos: .userInitiated)
  private let identityLock = NSLock()
  private var identity: String?
  private let writer = DispatchQueue(label: "ai.xopc.recording.writer", qos: .userInitiated)
  private let slots = DispatchSemaphore(value: 25)
  private let ingressLock = NSLock()
  private var acceptingGeneration: Int?
  private var engine: AVAudioEngine?
  private var observers: [NSObjectProtocol] = []
  private var spool: RecordingSpool?
  private var generation = 0
  var captureId: String? { identityLock.withLock { identity } }
  var onInterrupted: ((String) -> Void)?

  func start(root: URL, captureId: String) throws {
    guard engine == nil else { throw RecordingSpoolError.busy }
    identityLock.withLock { identity = captureId }
    let spool: RecordingSpool
    do { spool = try writer.sync { try RecordingSpool(root: root, captureId: captureId) } }
    catch { identityLock.withLock { identity = nil }; throw error }
    let epoch = (spool.chunks.last?.epoch ?? -1) + 1
    let session = AVAudioSession.sharedInstance()
    let engine = AVAudioEngine()
    do {
      try session.setCategory(.record, mode: .measurement)
      try session.setActive(true)
      let input = engine.inputNode.outputFormat(forBus: 0)
      guard input.sampleRate > 0,
        let target = AVAudioFormat(commonFormat: .pcmFormatInt16, sampleRate: 16000, channels: 1, interleaved: true),
        let converter = AVAudioConverter(from: input, to: target) else {
        throw RecordingSpoolError.invalidPCM
      }
      self.spool = spool
      self.engine = engine
      generation += 1
      let generation = self.generation
      ingressLock.withLock { acceptingGeneration = generation }
      engine.inputNode.installTap(onBus: 0, bufferSize: AVAudioFrameCount(input.sampleRate * 0.04), format: input) { [weak self] buffer, _ in
        guard let self else { return }
        guard self.ingressLock.withLock({ self.acceptingGeneration == generation }) else { return }
        guard self.slots.wait(timeout: .now()) == .success else {
          self.fail("recording_writer_overrun", generation: generation)
          return
        }
        let capacity = AVAudioFrameCount(ceil(Double(buffer.frameLength) * 16000 / input.sampleRate) + 32)
        guard capacity <= RecordingSpool.sampleRate,
          let converted = AVAudioPCMBuffer(pcmFormat: target, frameCapacity: capacity) else {
          self.slots.signal()
          self.fail("recording_format_failed", generation: generation)
          return
        }
        var supplied = false
        var error: NSError?
        converter.convert(to: converted, error: &error) { _, status in
          if supplied { status.pointee = .noDataNow; return nil }
          supplied = true
          status.pointee = .haveData
          return buffer
        }
        guard error == nil else {
          self.slots.signal()
          self.fail("recording_conversion_failed", generation: generation)
          return
        }
        guard converted.frameLength > 0, let samples = converted.int16ChannelData?[0] else {
          self.slots.signal()
          return
        }
        let bytes = Data(bytes: samples, count: Int(converted.frameLength) * 2)
        self.ingressLock.withLock {
          guard self.acceptingGeneration == generation else { self.slots.signal(); return }
          self.writer.async {
            defer { self.slots.signal() }
            do { try spool.append(bytes, epoch: epoch) }
            catch { self.fail("recording_storage_failed", generation: generation) }
          }
        }
      }
      observers = [
        NotificationCenter.default.addObserver(forName: AVAudioSession.interruptionNotification, object: session, queue: .main) { [weak self] notification in
          if let type = notification.userInfo?[AVAudioSessionInterruptionTypeKey] as? UInt,
            type == AVAudioSession.InterruptionType.began.rawValue { self?.fail("interruption", generation: generation) }
        },
        NotificationCenter.default.addObserver(forName: AVAudioSession.routeChangeNotification, object: session, queue: .main) { [weak self] notification in
          if let reason = notification.userInfo?[AVAudioSessionRouteChangeReasonKey] as? UInt,
            reason == AVAudioSession.RouteChangeReason.oldDeviceUnavailable.rawValue { self?.fail("route_lost", generation: generation) }
        },
        NotificationCenter.default.addObserver(forName: .AVAudioEngineConfigurationChange, object: engine, queue: .main) { [weak self] _ in
          self?.fail("recording_configuration_changed", generation: generation)
        }
      ]
      try engine.start()
    } catch {
      if self.engine != nil { _ = try? stop() }
      else { try? writer.sync { try spool.close() }; try? session.setActive(false) }
      identityLock.withLock { identity = nil }
      throw error
    }
  }

  @discardableResult
  func stop() throws -> [RecordingChunk] {
    guard let engine, let spool else { return [] }
    generation += 1
    ingressLock.withLock { acceptingGeneration = nil }
    observers.forEach { NotificationCenter.default.removeObserver($0) }
    observers.removeAll()
    engine.inputNode.removeTap(onBus: 0)
    engine.stop()
    self.engine = nil
    self.spool = nil
    identityLock.withLock { identity = nil }
    defer { try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation) }
    return try writer.sync {
      try spool.close()
      return spool.chunks
    }
  }

  private func fail(_ reason: String, generation: Int) {
    let shouldReport = ingressLock.withLock { () -> Bool in
      guard acceptingGeneration == generation else { return false }
      acceptingGeneration = nil
      return true
    }
    guard shouldReport else { return }
    lifecycle.async { [weak self] in
      guard let self, self.generation == generation, self.engine != nil else { return }
      do { try self.stop(); self.onInterrupted?(reason) }
      catch { self.onInterrupted?("recording_storage_failed") }
    }
  }
}
