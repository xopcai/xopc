import Foundation

@main
struct RecordingSpoolTests {
  static func main() throws {
    let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
    defer { try? FileManager.default.removeItem(at: root) }
    let id = UUID().uuidString
    let spool = try RecordingSpool(root: root, captureId: id)
    do {
      _ = try RecordingSpool(root: root, captureId: id)
      fatalError("Two writers acquired the same capture")
    } catch RecordingSpoolError.busy { }

    let frame = Data(repeating: 7, count: 1280)
    for _ in 0..<500 { try spool.append(frame, epoch: 0) }
    precondition(spool.chunks.count == 1 && spool.persistedSamples == 320000)
    try spool.append(frame, epoch: 0)
    try spool.append(frame, epoch: 1)
    precondition(spool.chunks.count == 2 && spool.chunks[1].sampleCount == 640)
    try spool.close()
    let reopened = try RecordingSpool(root: root, captureId: id)
    precondition(reopened.chunks.count == 3 && reopened.chunks[2].epoch == 1)
    precondition(reopened.persistedSamples == 321280)
    try reopened.close()

    // Simulate a process dying before the final WAV header and receipt are written.
    let crashId = UUID().uuidString
    let crashDirectory = root.appendingPathComponent(crashId.lowercased())
    try FileManager.default.createDirectory(at: crashDirectory, withIntermediateDirectories: true)
    try Data(#"{"sequence":0,"epoch":2,"sampleStart":0}"#.utf8)
      .write(to: crashDirectory.appendingPathComponent("00000000.pending.json"))
    var partial = RecordingSpool.header(sampleCount: 0)
    partial.append(frame)
    partial.append(9) // A torn final PCM frame must never be decoded.
    try partial.write(to: crashDirectory.appendingPathComponent("00000000.partial"))
    let recovered = try RecordingSpool(root: root, captureId: crashId)
    precondition(recovered.chunks.count == 1 && recovered.chunks[0].sampleCount == 640)
    precondition(recovered.chunks[0].epoch == 2)
    precondition(recovered.chunks[0].sha256 == "678d0614695c91f381dac2069bdf449b4f0fb785e4fc40de94b9675406849ad8")
    try recovered.close()

    // A crash after the receipt is committed must not duplicate the chunk.
    try Data(#"{"sequence":0,"epoch":2,"sampleStart":0}"#.utf8)
      .write(to: crashDirectory.appendingPathComponent("00000000.pending.json"))
    let duplicate = try RecordingSpool(root: root, captureId: crashId)
    precondition(duplicate.chunks.count == 1)
    try duplicate.close()
    let wav = crashDirectory.appendingPathComponent("00000000.wav")
    var damaged = try Data(contentsOf: wav)
    damaged[50] ^= 1
    try damaged.write(to: wav)
    do {
      _ = try RecordingSpool(root: root, captureId: crashId)
      fatalError("Corrupt acknowledged audio was accepted")
    } catch RecordingSpoolError.corruptJournal { }

    // A failed receipt commit must poison this writer, retaining audio for reopen.
    let failureId = UUID().uuidString
    let failed = try RecordingSpool(root: root, captureId: failureId)
    try failed.append(frame, epoch: 0)
    let blocker = root.appendingPathComponent(failureId.lowercased()).appendingPathComponent("00000000.json")
    try FileManager.default.createDirectory(at: blocker, withIntermediateDirectories: false)
    do { try failed.seal(); fatalError("Receipt commit unexpectedly succeeded") } catch { }
    do { try failed.append(frame, epoch: 0); fatalError("Poisoned writer accepted audio") }
    catch RecordingSpoolError.closed { }
    try failed.close()
    try FileManager.default.removeItem(at: blocker)
    let repaired = try RecordingSpool(root: root, captureId: failureId)
    precondition(repaired.chunks.count == 1 && repaired.persistedSamples == 640)
    try repaired.close()

    let invalidId = UUID().uuidString
    let invalid = try RecordingSpool(root: root, captureId: invalidId)
    do { try invalid.append(Data([1]), epoch: 0); fatalError("Odd PCM accepted") }
    catch RecordingSpoolError.invalidPCM { }
    try invalid.append(frame, epoch: 2)
    do { try invalid.append(frame, epoch: 1); fatalError("Epoch regression accepted") }
    catch RecordingSpoolError.invalidPCM { }
    try invalid.close()

    let longId = UUID().uuidString
    let long = try RecordingSpool(root: root, captureId: longId)
    let twentySeconds = Data(repeating: 3, count: RecordingSpool.chunkSamples * 2)
    for _ in 0..<360 { try long.append(twentySeconds, epoch: 0) }
    precondition(long.chunks.count == 360 && long.persistedSamples == 115200000)
    do { try long.append(Data([0, 0]), epoch: 0); preconditionFailure("Exceeded duration limit") }
    catch RecordingSpoolError.durationLimit {}
    try long.close()
    let longRestored = try RecordingSpool(root: root, captureId: longId)
    precondition(longRestored.chunks.count == 360 && longRestored.persistedSamples == 115200000)
    try longRestored.close()
    print("PASS: exclusive writer, chunk rotation, epoch boundary, torn tail, golden hash, duplicate receipt, corruption, failed commit, input validation, two-hour recovery")
  }
}
