package ai.xopc.voice

import org.junit.Assert.*
import org.junit.Test
import java.io.File
import java.nio.file.Files
import java.util.UUID

class RecordingSpoolTest {
  private fun fixture(block: (File) -> Unit) {
    val root = Files.createTempDirectory("xopc-recording-test").toFile()
    try { block(root) } finally { root.deleteRecursively() }
  }

  @Test fun rotatesAndRestoresWithoutDuplicatingEpochs() = fixture { root ->
    val id = UUID.randomUUID().toString()
    RecordingSpool(root, id).use { spool ->
      try { RecordingSpool(root, id); fail("Two writers") } catch (_: java.nio.channels.OverlappingFileLockException) { }
      repeat(500) { spool.append(ByteArray(1280) { 7 }, 0) }
      assertEquals(320000L, spool.persistedSamples)
      spool.append(ByteArray(1280), 0)
      spool.append(ByteArray(1280), 1)
      assertEquals(2, spool.chunks.size)
    }
    RecordingSpool(root, id).use {
      assertEquals(3, it.chunks.size)
      assertEquals(321280L, it.persistedSamples)
      assertEquals(1, it.chunks.last().epoch)
    }
  }

  @Test fun recoversTornTailAndCommittedReceipt() = fixture { root ->
    val id = UUID.randomUUID().toString()
    val directory = File(root, id).apply { mkdirs() }
    val pending = File(directory, "00000000.pending.json")
    val descriptor = """{"sequence":0,"epoch":2,"sampleStart":0}"""
    pending.writeText(descriptor)
    File(directory, "00000000.partial").writeBytes(RecordingSpool.header(0) + ByteArray(1280) { 7 } + byteArrayOf(9))
    RecordingSpool(root, id).use {
      assertEquals(640L, it.persistedSamples)
      assertEquals("678d0614695c91f381dac2069bdf449b4f0fb785e4fc40de94b9675406849ad8", it.chunks[0].sha256)
    }
    pending.writeText(descriptor)
    RecordingSpool(root, id).use { assertEquals(1, it.chunks.size) }
    val wav = File(directory, "00000000.wav")
    val damaged = wav.readBytes().apply { this[50] = 8 }
    wav.writeBytes(damaged)
    try { RecordingSpool(root, id); fail("Corrupt audio accepted") } catch (_: IllegalStateException) { }
  }

  @Test fun failedCommitRetainsAudioAndRejectsMoreWrites() = fixture { root ->
    val id = UUID.randomUUID().toString()
    val spool = RecordingSpool(root, id)
    spool.append(ByteArray(1280), 0)
    val blocker = File(File(root, id), "00000000.json").apply { mkdirs() }
    try { spool.seal(); fail("Commit succeeded") } catch (_: java.io.IOException) { }
    try { spool.append(ByteArray(1280), 0); fail("Failed writer accepted audio") } catch (_: IllegalStateException) { }
    spool.close()
    assertTrue(blocker.delete())
    RecordingSpool(root, id).use { assertEquals(640L, it.persistedSamples) }
  }

  @Test fun restoresTwoHoursOfClosedAudio() = fixture { root ->
    val id = UUID.randomUUID().toString()
    val pcm = ByteArray(RecordingSpool.CHUNK_SAMPLES * 2) { 3 }
    RecordingSpool(root, id).use { spool -> repeat(360) { spool.append(pcm, 0) } }
    RecordingSpool(root, id).use {
      assertEquals(360, it.chunks.size)
      assertEquals(115200000L, it.persistedSamples)
    }
  }

  @Test fun rejectsInvalidInputWithoutLosingEarlierAudio() = fixture { root ->
    val id = UUID.randomUUID().toString()
    RecordingSpool(root, id).use {
      try { it.append(byteArrayOf(1), 0); fail("Odd PCM accepted") } catch (_: IllegalArgumentException) { }
      it.append(ByteArray(1280), 2)
      try { it.append(ByteArray(1280), 1); fail("Epoch regression accepted") } catch (_: IllegalArgumentException) { }
    }
    RecordingSpool(root, id).use { assertEquals(640L, it.persistedSamples) }
  }
}
