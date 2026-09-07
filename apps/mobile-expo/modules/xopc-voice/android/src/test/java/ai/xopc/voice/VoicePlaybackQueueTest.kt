package ai.xopc.voice

import org.junit.Assert.*
import org.junit.Test

class VoicePlaybackQueueTest {
  @Test fun partialWritesPreserveEveryByteAndFrameOrder() {
    val queue = VoicePlaybackQueue()
    queue.add(byteArrayOf(1, 2, 3, 4, 5, 6))
    queue.add(byteArrayOf(7, 8))
    val received = mutableListOf<Byte>()
    assertTrue(queue.drain { bytes, offset, _ ->
      received.addAll(bytes.slice(offset until offset + 2))
      2
    })
    assertEquals((1..8).map { it.toByte() }, received)
  }

  @Test fun aFullDeviceBufferYieldsWithoutDroppingTheRemainder() {
    val queue = VoicePlaybackQueue()
    queue.add(byteArrayOf(1, 2, 3, 4))
    var calls = 0
    assertFalse(queue.drain { _, _, _ -> if (calls++ == 0) 2 else 0 })
    assertEquals(2, calls)
    assertTrue(queue.drain { bytes, offset, count ->
      assertArrayEquals(byteArrayOf(1, 2, 3, 4), bytes)
      assertEquals(2, offset)
      assertEquals(2, count)
      count
    })
  }

  @Test fun interruptionDiscardsPendingAudioAndResetsTheOffset() {
    val queue = VoicePlaybackQueue()
    queue.add(byteArrayOf(1, 2, 3, 4))
    var calls = 0
    assertFalse(queue.drain { _, _, _ -> if (calls++ == 0) 2 else 0 })
    queue.clear()
    queue.add(byteArrayOf(5, 6))
    assertTrue(queue.drain { bytes, offset, count ->
      assertArrayEquals(byteArrayOf(5, 6), bytes)
      assertEquals(0, offset)
      count
    })
  }

  @Test fun deviceErrorsAndInvalidWritesAreNotTreatedAsBackpressure() {
    for (written in listOf(-1, 1, 4)) {
      val queue = VoicePlaybackQueue()
      queue.add(byteArrayOf(1, 2))
      assertThrows(IllegalStateException::class.java) { queue.drain { _, _, _ -> written } }
    }
  }
}
