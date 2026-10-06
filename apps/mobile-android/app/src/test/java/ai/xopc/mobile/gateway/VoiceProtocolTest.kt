package ai.xopc.mobile.gateway

import java.nio.ByteBuffer
import java.nio.ByteOrder
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertThrows
import org.junit.Test

class VoiceProtocolTest {
  @Test fun uplinkMatchesHarmonyProtocolHeader() {
    val audio = ByteArray(640) { it.toByte() }
    val bytes = voiceUplink(7, "utterance-1", 1, 1234.5, true, false, audio)
    val header = ByteBuffer.wrap(bytes).order(ByteOrder.BIG_ENDIAN)
    assertEquals(0x584f5033, header.int)
    assertEquals(3, header.get().toInt())
    assertEquals(1, header.get().toInt())
    assertEquals(1, header.get().toInt())
    assertEquals(1, header.get().toInt())
    assertEquals(7, header.int)
    assertEquals(1, header.int)
    assertEquals(1234.5, header.double, 0.001)
    assertEquals(20, header.short.toInt())
    assertEquals(11, header.short.toInt())
    assertEquals(640, header.int)
    assertArrayEquals(audio, bytes.copyOfRange(bytes.size - 640, bytes.size))
  }

  @Test fun downlinkRejectsInvalidLengthAndSequenceInputs() {
    val id = "reply-1".toByteArray()
    val audio = ByteArray(960)
    val packet = ByteBuffer.allocate(32 + id.size + audio.size).order(ByteOrder.BIG_ENDIAN)
      .putInt(0x584f5033).put(3).put(2).put(1).put(0)
      .putInt(7).putInt(2).putDouble(1234.0).putShort(20)
      .putShort(id.size.toShort()).putInt(audio.size).put(id).put(audio).array()
    val frame = parseVoiceDownlink(packet)
    assertEquals(7, frame.epoch)
    assertEquals(2, frame.sequence)
    assertEquals("reply-1", frame.responseId)
    assertArrayEquals(audio, frame.audio)
    assertThrows(IllegalArgumentException::class.java) { parseVoiceDownlink(packet.copyOf(packet.size - 1)) }
    val wrongDirection = packet.copyOf().also { it[5] = 1 }
    assertThrows(IllegalArgumentException::class.java) { parseVoiceDownlink(wrongDirection) }
    assertThrows(IllegalArgumentException::class.java) {
      voiceUplink(7, "id", 1, 1.0, true, false, ByteArray(641))
    }
  }
}
