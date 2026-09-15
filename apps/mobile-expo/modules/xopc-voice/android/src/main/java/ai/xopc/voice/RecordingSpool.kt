package ai.xopc.voice

import org.json.JSONObject
import java.io.File
import java.io.RandomAccessFile
import java.nio.ByteBuffer
import java.nio.ByteOrder
import java.nio.channels.FileChannel
import java.nio.file.Files
import java.nio.file.StandardCopyOption
import java.nio.file.StandardOpenOption
import java.security.MessageDigest
import java.util.UUID

data class RecordingChunk(
  val sequence: Int, val epoch: Int, val sampleStart: Long,
  val sampleCount: Int, val sha256: String, val bytes: Int,
)

/** Single writer, called on the native disk queue, never on the audio callback. */
class RecordingSpool(root: File, captureId: String) : AutoCloseable {
  companion object {
    const val SAMPLE_RATE = 16000
    const val CHUNK_SAMPLES = SAMPLE_RATE * 20
    fun header(samples: Int): ByteArray = ByteBuffer.allocate(44).order(ByteOrder.LITTLE_ENDIAN).apply {
      put("RIFF".toByteArray()); putInt(36 + samples * 2); put("WAVEfmt ".toByteArray())
      putInt(16); putShort(1); putShort(1); putInt(SAMPLE_RATE); putInt(SAMPLE_RATE * 2)
      putShort(2); putShort(16); put("data".toByteArray()); putInt(samples * 2)
    }.array()
    private fun hash(bytes: ByteArray) = MessageDigest.getInstance("SHA-256").digest(bytes).joinToString("") { "%02x".format(it) }
  }

  private val directory: File
  private val lockFile: RandomAccessFile
  private val lock: java.nio.channels.FileLock
  private var closed = false
  private var failed = false
  private var file: RandomAccessFile? = null
  private var pending: JSONObject? = null
  private var samples = 0
  private val receipts = mutableListOf<RecordingChunk>()
  val chunks: List<RecordingChunk> get() = receipts.toList()
  val persistedSamples: Long get() = receipts.lastOrNull()?.let { it.sampleStart + it.sampleCount } ?: 0L

  init {
    require(captureId.matches(Regex("[0-9a-fA-F]{8}(-[0-9a-fA-F]{4}){3}-[0-9a-fA-F]{12}"))) { "INVALID_CAPTURE_ID" }
    directory = File(root, UUID.fromString(captureId).toString())
    check(directory.isDirectory || directory.mkdirs()) { "STORAGE_UNAVAILABLE" }
    check(!Files.isSymbolicLink(directory.toPath())) { "INVALID_DIRECTORY" }
    lockFile = RandomAccessFile(File(directory, "writer.lock"), "rw")
    try { lock = requireNotNull(lockFile.channel.tryLock()) { "RECORDING_BUSY" } }
    catch (error: Exception) { lockFile.close(); throw error }
    try { recover() }
    catch (error: Exception) { lock.release(); lockFile.close(); throw error }
  }

  private fun path(sequence: Int, suffix: String) = File(directory, "%08d".format(java.util.Locale.ROOT, sequence) + suffix)

  fun append(pcm: ByteArray, epoch: Int) {
    check(!closed && !failed) { "RECORDING_CLOSED" }
    require(pcm.size % 2 == 0 && pcm.size <= CHUNK_SAMPLES * 2 && epoch >= 0 && epoch >= (pending?.getInt("epoch") ?: receipts.lastOrNull()?.epoch ?: 0)) { "INVALID_PCM" }
    try {
      if (pending != null && pending!!.getInt("epoch") != epoch) seal()
      var offset = 0
      while (offset < pcm.size) {
        if (file == null) begin(epoch)
        val count = minOf(pcm.size - offset, (CHUNK_SAMPLES - samples) * 2)
        file!!.write(pcm, offset, count)
        samples += count / 2
        offset += count
        if (samples == CHUNK_SAMPLES) seal()
      }
    } catch (error: Exception) { failed = true; throw error }
  }

  fun seal() {
    check(!closed && !failed) { "RECORDING_CLOSED" }
    val descriptor = pending ?: return
    try {
      requireNotNull(file).apply { seek(0); write(header(samples)); fd.sync(); close() }
      file = null
      finish(descriptor)
      pending = null
      samples = 0
    } catch (error: Exception) { failed = true; throw error }
  }

  override fun close() {
    if (closed) return
    try { if (!failed) seal() }
    finally {
      try { file?.close() }
      finally { file = null; lock.release(); lockFile.close(); closed = true }
    }
  }

  private fun begin(epoch: Int) {
    check(directory.usableSpace >= 16 * 1024 * 1024) { "STORAGE_FULL" }
    val descriptor = JSONObject().put("sequence", receipts.size).put("epoch", epoch).put("sampleStart", persistedSamples)
    durableJSON(descriptor, path(receipts.size, ".pending.json"))
    val partial = path(receipts.size, ".partial")
    check(partial.createNewFile()) { "CHUNK_EXISTS" }
    val handle = RandomAccessFile(partial, "rw")
    try { handle.write(header(0)) }
    catch (error: Exception) { handle.close(); throw error }
    file = handle
    pending = descriptor
    samples = 0
  }

  private fun finish(descriptor: JSONObject) {
    val sequence = descriptor.getInt("sequence")
    val epoch = descriptor.getInt("epoch")
    val start = descriptor.getLong("sampleStart")
    check(sequence == receipts.size && start == persistedSamples && epoch >= (receipts.lastOrNull()?.epoch ?: 0)) { "CORRUPT_JOURNAL" }
    val partial = path(sequence, ".partial")
    val wav = path(sequence, ".wav")
    if (partial.exists()) {
      check(!wav.exists() && !Files.isSymbolicLink(partial.toPath()) && partial.length() in 44L..(44L + CHUNK_SAMPLES * 2)) { "CORRUPT_CHUNK" }
      val count = ((partial.length() - 44) / 2).toInt()
      if (count == 0) {
        Files.delete(partial.toPath()); Files.delete(path(sequence, ".pending.json").toPath()); syncDirectory()
        return
      }
      RandomAccessFile(partial, "rw").use { it.setLength(44L + count * 2); it.seek(0); it.write(header(count)); it.fd.sync() }
      Files.move(partial.toPath(), wav.toPath(), StandardCopyOption.ATOMIC_MOVE)
      syncDirectory()
    }
    val bytes = boundedAudio(wav)
    val count = (bytes.size - 44) / 2
    check(bytes.copyOfRange(0, 44).contentEquals(header(count))) { "CORRUPT_HEADER" }
    val receipt = RecordingChunk(sequence, epoch, start, count, hash(bytes), bytes.size)
    durableJSON(JSONObject().put("version", 1).put("sequence", sequence).put("epoch", epoch)
      .put("sampleStart", start).put("sampleCount", count).put("sha256", receipt.sha256).put("bytes", bytes.size), path(sequence, ".json"))
    receipts.add(receipt)
    Files.delete(path(sequence, ".pending.json").toPath())
    syncDirectory()
  }

  private fun recover() {
    val files = requireNotNull(directory.listFiles()) { "STORAGE_UNAVAILABLE" }.sortedBy { it.name }
    for (receiptFile in files.filter { it.name.matches(Regex("[0-9]{8}\\.json")) }) {
      val value = readJSON(receiptFile)
      val receipt = RecordingChunk(value.getInt("sequence"), value.getInt("epoch"), value.getLong("sampleStart"),
        value.getInt("sampleCount"), value.getString("sha256"), value.getInt("bytes"))
      check(value.getInt("version") == 1 && receipt.sequence == receipts.size && receiptFile.name == path(receipt.sequence, ".json").name
        && receipt.sampleStart == persistedSamples && receipt.epoch >= (receipts.lastOrNull()?.epoch ?: 0)
        && receipt.sampleCount in 1..CHUNK_SAMPLES) { "CORRUPT_JOURNAL" }
      val bytes = boundedAudio(path(receipt.sequence, ".wav"))
      check(receipt.bytes == bytes.size && bytes.size == receipt.sampleCount * 2 + 44
        && bytes.copyOfRange(0, 44).contentEquals(header(receipt.sampleCount)) && hash(bytes) == receipt.sha256) { "CORRUPT_CHUNK" }
      receipts.add(receipt)
    }
    for (pendingFile in files.filter { it.name.endsWith(".pending.json") }) {
      val descriptor = readJSON(pendingFile)
      val sequence = descriptor.getInt("sequence")
      check(sequence >= 0 && pendingFile.name == path(sequence, ".pending.json").name) { "CORRUPT_JOURNAL" }
      if (sequence < receipts.size) {
        val receipt = receipts[sequence]
        check(receipt.epoch == descriptor.getInt("epoch") && receipt.sampleStart == descriptor.getLong("sampleStart")) { "CORRUPT_JOURNAL" }
        Files.delete(pendingFile.toPath())
      } else if (!path(sequence, ".partial").exists() && !path(sequence, ".wav").exists()) {
        check(sequence == receipts.size) { "CORRUPT_JOURNAL" }
        Files.delete(pendingFile.toPath())
      } else finish(descriptor)
    }
    val names = receipts.map { path(it.sequence, ".wav").name }.toSet()
    for (entry in requireNotNull(directory.listFiles())) {
      if (entry.name.endsWith(".wav") || entry.name.endsWith(".partial")) check(entry.name in names) { "ORPHAN_CHUNK" }
    }
    syncDirectory()
  }

  private fun boundedAudio(file: File): ByteArray {
    check(!Files.isSymbolicLink(file.toPath()) && file.isFile && file.length() in 46L..(44L + CHUNK_SAMPLES * 2) && file.length() % 2 == 0L) { "CORRUPT_CHUNK" }
    return file.readBytes()
  }

  private fun readJSON(file: File): JSONObject {
    check(!Files.isSymbolicLink(file.toPath()) && file.isFile && file.length() in 1..4096) { "CORRUPT_JOURNAL" }
    return JSONObject(file.readText())
  }

  private fun durableJSON(value: JSONObject, destination: File) {
    val temp = File(destination.path + ".tmp")
    RandomAccessFile(temp, "rw").use { it.setLength(0); it.write(value.toString().toByteArray()); it.fd.sync() }
    Files.move(temp.toPath(), destination.toPath(), StandardCopyOption.ATOMIC_MOVE, StandardCopyOption.REPLACE_EXISTING)
    syncDirectory()
  }

  private fun syncDirectory() {
    FileChannel.open(directory.toPath(), StandardOpenOption.READ).use { it.force(true) }
  }
}
