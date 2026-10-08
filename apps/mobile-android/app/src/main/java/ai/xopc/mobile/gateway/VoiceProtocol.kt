package ai.xopc.mobile.gateway

import java.nio.ByteBuffer
import java.nio.ByteOrder
import java.util.UUID
import org.json.JSONObject

internal const val VOICE_WS_PATH = "/api/voice/realtime/v3/ws"
internal const val VOICE_PROXY_WS_PATH = "/api/realtime/v1/ws?transport=voice-v3"
data class VoiceCallConnection(val sessionId: String, val ticket: String, val websocketPath: String,
  val connectionEpoch: Int, val origin: String, val bearer: String, val maxSessionMs: Long,
  val routeEngine: String, val bargeIn: Boolean = true)
private const val MAGIC = 0x584f5033
private const val HEADER_BYTES = 32
private const val MAX_FRAME_BYTES = 64 * 1024

internal data class VoiceDownlinkFrame(val epoch: Int, val responseId: String,
  val sequence: Int, val audio: ByteArray)

internal fun voiceClientEvent(type: String, payload: JSONObject): String = JSONObject()
  .put("protocolVersion", 3).put("messageId", UUID.randomUUID().toString())
  .put("type", type).put("sentAt", System.currentTimeMillis()).put("payload", payload).toString()

internal fun voiceUplink(epoch: Int, utteranceId: String, sequence: Int,
  capturedAtMs: Double, start: Boolean, end: Boolean, audio: ByteArray): ByteArray {
  val id = utteranceId.toByteArray(Charsets.UTF_8)
  require(epoch > 0 && sequence > 0 && id.isNotEmpty() && id.size <= 160 &&
    audio.isNotEmpty() && audio.size % 2 == 0 &&
    HEADER_BYTES + id.size + audio.size <= MAX_FRAME_BYTES) { "INVALID_VOICE_FRAME" }
  return ByteBuffer.allocate(HEADER_BYTES + id.size + audio.size).order(ByteOrder.BIG_ENDIAN).apply {
    putInt(MAGIC); put(3); put(1); put(1)
    put(((if (start) 1 else 0) or (if (end) 2 else 0)).toByte())
    putInt(epoch); putInt(sequence); putDouble(capturedAtMs)
    putShort(20); putShort(id.size.toShort()); putInt(audio.size)
    put(id); put(audio)
  }.array()
}

internal fun parseVoiceDownlink(bytes: ByteArray): VoiceDownlinkFrame {
  require(bytes.size in (HEADER_BYTES + 2)..MAX_FRAME_BYTES) { "INVALID_VOICE_FRAME" }
  val buffer = ByteBuffer.wrap(bytes).order(ByteOrder.BIG_ENDIAN)
  val magic = buffer.int
  val version = buffer.get().toInt() and 0xff
  val direction = buffer.get().toInt() and 0xff
  val codec = buffer.get().toInt() and 0xff
  val flags = buffer.get().toInt() and 0xff
  val epoch = buffer.int
  val sequence = buffer.int
  val timestamp = buffer.double
  val duration = buffer.short.toInt() and 0xffff
  val idLength = buffer.short.toInt() and 0xffff
  val payloadLength = buffer.int
  require(magic == MAGIC && version == 3 && direction == 2 && codec == 1 && flags == 0 &&
    epoch > 0 && sequence > 0 && timestamp.isFinite() && duration == 20 &&
    idLength in 1..160 && payloadLength > 0 && payloadLength % 2 == 0 &&
    HEADER_BYTES + idLength + payloadLength == bytes.size) { "INVALID_VOICE_FRAME" }
  val id = ByteArray(idLength).also(buffer::get).toString(Charsets.UTF_8)
  val audio = ByteArray(payloadLength).also(buffer::get)
  return VoiceDownlinkFrame(epoch, id, sequence, audio)
}
