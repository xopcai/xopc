import Foundation
import CryptoKit
import Darwin

struct RecordingChunk: Codable {
  let version: Int
  let sequence: Int
  let epoch: Int
  let sampleStart: Int64
  let sampleCount: Int
  let sha256: String
  let bytes: Int
}

private struct PendingRecordingChunk: Codable {
  let sequence: Int
  let epoch: Int
  let sampleStart: Int64
}

enum RecordingSpoolError: Error {
  case invalidIdentifier, busy, corruptJournal, invalidPCM, storageFull, closed, durationLimit
}

/// Single-writer PCM spool. Call only from the native recording writer queue.
/// A chunk is acknowledged only after both its WAV and immutable receipt are durable.
final class RecordingSpool {
  static let sampleRate = 16000
  static let chunkSamples = sampleRate * 20
  private let directory: URL
  private let lockFD: Int32
  private var closed = false
  private var failed = false
  private var file: FileHandle?
  private var pending: PendingRecordingChunk?
  private var samples = 0
  private(set) var chunks: [RecordingChunk] = []

  init(root: URL, captureId: String) throws {
    guard UUID(uuidString: captureId) != nil else { throw RecordingSpoolError.invalidIdentifier }
    directory = root.appendingPathComponent(captureId.lowercased(), isDirectory: true)
    try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
    guard try directory.resourceValues(forKeys: [.isSymbolicLinkKey]).isSymbolicLink != true else {
      throw RecordingSpoolError.corruptJournal
    }
    var protected = directory
    var values = URLResourceValues()
    values.isExcludedFromBackup = true
    try protected.setResourceValues(values)
    #if os(iOS)
    try FileManager.default.setAttributes([.protectionKey: FileProtectionType.completeUntilFirstUserAuthentication], ofItemAtPath: directory.path)
    #endif
    lockFD = Darwin.open(directory.appendingPathComponent("writer.lock").path, O_CREAT | O_RDWR, S_IRUSR | S_IWUSR)
    guard lockFD >= 0 else { throw POSIXError(.EIO) }
    guard flock(lockFD, LOCK_EX | LOCK_NB) == 0 else {
      Darwin.close(lockFD)
      closed = true
      throw RecordingSpoolError.busy
    }
    do { try recover() }
    catch { flock(lockFD, LOCK_UN); Darwin.close(lockFD); closed = true; throw error }
  }

  deinit {
    try? file?.close()
    if !closed { flock(lockFD, LOCK_UN); Darwin.close(lockFD) }
  }

  var persistedSamples: Int64 { chunks.last.map { $0.sampleStart + Int64($0.sampleCount) } ?? 0 }

  func append(_ pcm: Data, epoch: Int) throws {
    guard !closed && !failed else { throw RecordingSpoolError.closed }
    guard pcm.count % 2 == 0, pcm.count <= Self.chunkSamples * 2, epoch >= 0,
      epoch >= (pending?.epoch ?? chunks.last?.epoch ?? 0) else { throw RecordingSpoolError.invalidPCM }
    guard persistedSamples + Int64(samples) + Int64(pcm.count / 2) <= 16000 * 7200 else { throw RecordingSpoolError.durationLimit }
    do {
      if pending?.epoch != nil && pending?.epoch != epoch { try seal() }
      var offset = 0
      while offset < pcm.count {
        if file == nil { try begin(epoch: epoch) }
        let count = min(pcm.count - offset, (Self.chunkSamples - samples) * 2)
        try file!.write(contentsOf: pcm.subdata(in: offset..<(offset + count)))
        samples += count / 2
        offset += count
        if samples == Self.chunkSamples { try seal() }
      }
    } catch { failed = true; throw error }
  }

  func seal() throws {
    guard !closed && !failed else { throw RecordingSpoolError.closed }
    guard let pending, let file else { return }
    do {
      try file.seek(toOffset: 0)
      try file.write(contentsOf: Self.header(sampleCount: samples))
      try file.synchronize()
      try file.close()
      self.file = nil
      // Keep the pending descriptor on every failure, including after rename.
      try finish(pending)
      self.pending = nil
      samples = 0
    } catch { failed = true; throw error }
  }

  func close() throws {
    if closed { return }
    defer {
      try? file?.close()
      file = nil
      flock(lockFD, LOCK_UN)
      Darwin.close(lockFD)
      closed = true
    }
    if !failed { try seal() }
  }

  private func path(_ sequence: Int, _ suffix: String) -> URL {
    directory.appendingPathComponent(String(format: "%08d", sequence) + suffix)
  }

  private func begin(epoch: Int) throws {
    let capacity = try FileManager.default.attributesOfFileSystem(forPath: directory.path)[.systemFreeSize] as? NSNumber
    guard let capacity, capacity.int64Value >= 16 * 1024 * 1024 else { throw RecordingSpoolError.storageFull }
    let descriptor = PendingRecordingChunk(sequence: chunks.count, epoch: epoch, sampleStart: persistedSamples)
    try durableJSON(descriptor, to: path(descriptor.sequence, ".pending.json"))
    let url = path(descriptor.sequence, ".partial")
    guard !FileManager.default.fileExists(atPath: url.path) else { throw RecordingSpoolError.corruptJournal }
    guard FileManager.default.createFile(atPath: url.path, contents: Self.header(sampleCount: 0)) else { throw POSIXError(.EIO) }
    #if os(iOS)
    try FileManager.default.setAttributes([.protectionKey: FileProtectionType.completeUntilFirstUserAuthentication], ofItemAtPath: url.path)
    #endif
    let handle = try FileHandle(forWritingTo: url)
    do { try handle.seekToEnd() }
    catch { try? handle.close(); throw error }
    file = handle
    pending = descriptor
    samples = 0
  }

  private func finish(_ descriptor: PendingRecordingChunk) throws {
    guard descriptor.sequence == chunks.count, descriptor.sampleStart == persistedSamples,
      descriptor.epoch >= (chunks.last?.epoch ?? 0) else { throw RecordingSpoolError.corruptJournal }
    let partial = path(descriptor.sequence, ".partial")
    let wav = path(descriptor.sequence, ".wav")
    if FileManager.default.fileExists(atPath: partial.path) {
      guard !FileManager.default.fileExists(atPath: wav.path) else { throw RecordingSpoolError.corruptJournal }
      let size = try fileSize(partial)
      guard size >= 44, size <= 44 + Self.chunkSamples * 2 else { throw RecordingSpoolError.corruptJournal }
      let recoveredSamples = (size - 44) / 2
      if recoveredSamples == 0 {
        try FileManager.default.removeItem(at: partial)
        try FileManager.default.removeItem(at: path(descriptor.sequence, ".pending.json"))
        try syncDirectory()
        return
      }
      let handle = try FileHandle(forWritingTo: partial)
      defer { try? handle.close() }
      try handle.truncate(atOffset: UInt64(44 + recoveredSamples * 2))
      try handle.seek(toOffset: 0)
      try handle.write(contentsOf: Self.header(sampleCount: recoveredSamples))
      try handle.synchronize()
      try FileManager.default.moveItem(at: partial, to: wav)
      try syncDirectory()
    }
    let data = try boundedAudio(wav)
    let sampleCount = (data.count - 44) / 2
    guard data.prefix(44) == Self.header(sampleCount: sampleCount) else { throw RecordingSpoolError.corruptJournal }
    let receipt = RecordingChunk(version: 1, sequence: descriptor.sequence, epoch: descriptor.epoch,
      sampleStart: descriptor.sampleStart, sampleCount: sampleCount,
      sha256: SHA256.hash(data: data).map { String(format: "%02x", $0) }.joined(), bytes: data.count)
    try durableJSON(receipt, to: path(descriptor.sequence, ".json"))
    chunks.append(receipt)
    try FileManager.default.removeItem(at: path(descriptor.sequence, ".pending.json"))
    try syncDirectory()
  }

  private func recover() throws {
    let names = try FileManager.default.contentsOfDirectory(atPath: directory.path)
    let receipts = names.filter { $0.range(of: "^[0-9]{8}\\.json$", options: .regularExpression) != nil }.sorted()
    for name in receipts {
      let receipt = try JSONDecoder().decode(RecordingChunk.self, from: boundedJSON(directory.appendingPathComponent(name)))
      guard receipt.version == 1, receipt.sequence == chunks.count, name == path(receipt.sequence, ".json").lastPathComponent,
        receipt.sampleStart == persistedSamples, receipt.epoch >= (chunks.last?.epoch ?? 0),
        receipt.sampleCount > 0, receipt.sampleCount <= Self.chunkSamples else { throw RecordingSpoolError.corruptJournal }
      let data = try boundedAudio(path(receipt.sequence, ".wav"))
      guard receipt.bytes == data.count, data.count == receipt.sampleCount * 2 + 44,
        data.prefix(44) == Self.header(sampleCount: receipt.sampleCount),
        SHA256.hash(data: data).map({ String(format: "%02x", $0) }).joined() == receipt.sha256 else { throw RecordingSpoolError.corruptJournal }
      chunks.append(receipt)
    }
    for name in names.filter({ $0.hasSuffix(".pending.json") }).sorted() {
      let url = directory.appendingPathComponent(name)
      let descriptor = try JSONDecoder().decode(PendingRecordingChunk.self, from: boundedJSON(url))
      guard descriptor.sequence >= 0, name == path(descriptor.sequence, ".pending.json").lastPathComponent else { throw RecordingSpoolError.corruptJournal }
      if descriptor.sequence < chunks.count {
        let receipt = chunks[descriptor.sequence]
        guard receipt.epoch == descriptor.epoch, receipt.sampleStart == descriptor.sampleStart else { throw RecordingSpoolError.corruptJournal }
        try FileManager.default.removeItem(at: url)
      } else if !FileManager.default.fileExists(atPath: path(descriptor.sequence, ".partial").path)
          && !FileManager.default.fileExists(atPath: path(descriptor.sequence, ".wav").path) {
        guard descriptor.sequence == chunks.count else { throw RecordingSpoolError.corruptJournal }
        try FileManager.default.removeItem(at: url)
      } else { try finish(descriptor) }
    }
    let remaining = try FileManager.default.contentsOfDirectory(atPath: directory.path)
    for name in remaining where name.hasSuffix(".wav") || name.hasSuffix(".partial") {
      guard chunks.contains(where: { path($0.sequence, ".wav").lastPathComponent == name }) else { throw RecordingSpoolError.corruptJournal }
    }
    try syncDirectory()
  }

  private func fileSize(_ url: URL) throws -> Int {
    let attributes = try FileManager.default.attributesOfItem(atPath: url.path)
    guard attributes[.type] as? FileAttributeType == .typeRegular,
      let size = attributes[.size] as? NSNumber else { throw RecordingSpoolError.corruptJournal }
    return size.intValue
  }

  private func boundedAudio(_ url: URL) throws -> Data {
    let size = try fileSize(url)
    guard size > 44, size <= 44 + Self.chunkSamples * 2, size % 2 == 0 else { throw RecordingSpoolError.corruptJournal }
    return try Data(contentsOf: url)
  }

  private func boundedJSON(_ url: URL) throws -> Data {
    let size = try fileSize(url)
    guard size > 0 && size <= 4096 else { throw RecordingSpoolError.corruptJournal }
    return try Data(contentsOf: url)
  }

  private func durableJSON<T: Encodable>(_ value: T, to url: URL) throws {
    let temporary = url.appendingPathExtension("tmp")
    try JSONEncoder().encode(value).write(to: temporary)
    #if os(iOS)
    try FileManager.default.setAttributes([.protectionKey: FileProtectionType.completeUntilFirstUserAuthentication], ofItemAtPath: temporary.path)
    #endif
    let handle = try FileHandle(forWritingTo: temporary)
    defer { try? handle.close() }
    try handle.synchronize()
    guard Darwin.rename(temporary.path, url.path) == 0 else { throw POSIXError(.EIO) }
    try syncDirectory()
  }

  private func syncDirectory() throws {
    let fd = Darwin.open(directory.path, O_RDONLY)
    guard fd >= 0 else { throw POSIXError(.EIO) }
    defer { Darwin.close(fd) }
    guard fsync(fd) == 0 else { throw POSIXError(.EIO) }
  }

  static func header(sampleCount: Int) -> Data {
    var data = Data()
    func ascii(_ value: String) { data.append(contentsOf: value.utf8) }
    func word(_ value: UInt16) { var little = value.littleEndian; withUnsafeBytes(of: &little) { data.append(contentsOf: $0) } }
    func dword(_ value: UInt32) { var little = value.littleEndian; withUnsafeBytes(of: &little) { data.append(contentsOf: $0) } }
    ascii("RIFF"); dword(UInt32(36 + sampleCount * 2)); ascii("WAVEfmt "); dword(16)
    word(1); word(1); dword(16000); dword(32000); word(2); word(16)
    ascii("data"); dword(UInt32(sampleCount * 2))
    return data
  }
}
