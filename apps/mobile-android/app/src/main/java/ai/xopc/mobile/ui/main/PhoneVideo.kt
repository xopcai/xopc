package ai.xopc.mobile.ui.main

import ai.xopc.mobile.gateway.DeviceRequestProof
import ai.xopc.mobile.gateway.PhonePointerQueue
import android.media.MediaCodec
import android.media.MediaFormat
import android.os.Handler
import android.os.HandlerThread
import android.view.Surface
import java.nio.ByteBuffer
import java.nio.ByteOrder
import java.util.concurrent.TimeUnit
import okhttp3.*
import okio.ByteString
import org.json.JSONObject

/** Decoder and its bounded packet queue are confined to the decoder looper. */
internal class PhoneVideo(private val surface: Surface, private val epoch: Int, private val onGeometry: (Int, Int, Int) -> Unit,
  private val onPlaying: () -> Unit, private val onFailure: () -> Unit) {
  private val thread = HandlerThread("PhoneVideo").apply { start() }
  private val handler = Handler(thread.looper)
  private val http = OkHttpClient.Builder().pingInterval(5, TimeUnit.SECONDS).build()
  private var socket: WebSocket? = null
  private var codec: MediaCodec? = null
  private var version = 0
  private var receivedAt = System.currentTimeMillis()
  private val startedAt = System.currentTimeMillis()
  private var rendered = false
  private var queuedBytes = 0
  private val pointerQueue = PhonePointerQueue({ phase, x, y, seq ->
    socket?.send(JSONObject().put("type", "pointer").put("phase", phase).put("x", x).put("y", y)
      .put("seq", seq).put("epoch", epoch).put("geometry", version).toString())
  }, { socket?.send(JSONObject().put("type", "cancelPointers").put("epoch", epoch).toString()) })
  fun pointer(phase: String, x: Int, y: Int) { handler.post { if (!closed && epoch > 0) pointerQueue.pointer(phase, x, y) } }
  private var keySeen = false
  @Volatile private var closed = false
  private data class Packet(val bytes: ByteArray, val pts: Long, val flags: Int)
  private val packets = ArrayDeque<Packet>()
  private val inputs = ArrayDeque<Int>()
  fun open(url: String, ticket: String) {
    val uri = java.net.URI(url)
    val proof = DeviceRequestProof.connection("${uri.scheme}://${uri.rawAuthority}", uri.rawPath, ticket)
    val request = Request.Builder().url(url.replaceFirst("https:", "wss:"))
      .header("Sec-WebSocket-Protocol", "xopc-phone-v1, $ticket").header("X-Xopc-Proof", proof).build()
    socket = http.newWebSocket(request, object : WebSocketListener() {
      override fun onMessage(webSocket: WebSocket, text: String) { handler.post {
        if (closed) return@post
        try {
          receivedAt = System.currentTimeMillis()
          val value = JSONObject(text)
          when (value.optString("type")) {
            "geometry" -> configure(value.getInt("width"), value.getInt("height"), value.getInt("version"))
            "fault" -> fail()
            "ack" -> pointerQueue.ack(value.getInt("seq"))
          }
        } catch (_: Exception) { fail() }
      } }
      override fun onMessage(webSocket: WebSocket, bytes: ByteString) { handler.post {
        if (closed) return@post
        try {
          receivedAt = System.currentTimeMillis()
          val raw = bytes.toByteArray()
          if (raw.size <= 32 || raw.size > 4 * 1024 * 1024 || codec == null) return@post
          val header = ByteBuffer.wrap(raw).order(ByteOrder.BIG_ENDIAN)
          if (header.getInt(4) != version) return@post
          val flags = raw[0].toInt()
          if (flags and 1 == 0 && !keySeen && flags and 2 == 0) return@post
          if (flags and 2 != 0) keySeen = true
          if (packets.size >= 32 || queuedBytes + raw.size - 32 > 8 * 1024 * 1024) { fail(); return@post }
          queuedBytes += raw.size - 32
          packets.addLast(Packet(raw.copyOfRange(32, raw.size), header.getLong(12),
            if (flags and 1 != 0) MediaCodec.BUFFER_FLAG_CODEC_CONFIG else if (flags and 2 != 0) MediaCodec.BUFFER_FLAG_KEY_FRAME else 0))
          drain()
        } catch (_: Exception) { fail() }
      } }
      override fun onFailure(webSocket: WebSocket, t: Throwable, response: Response?) { handler.post { fail() } }
      override fun onClosed(webSocket: WebSocket, code: Int, reason: String) { handler.post { fail() } }
    })
    handler.postDelayed(object : Runnable {
      override fun run() { if (!closed) { if ((!rendered && System.currentTimeMillis() - startedAt > 8000) || System.currentTimeMillis() - receivedAt > 12000) { fail(); return }; if (pointerQueue.pendingSince > 0 && System.currentTimeMillis() - pointerQueue.pendingSince > 5000) { fail(); return }; socket?.send("{\"type\":\"ping\"}"); handler.postDelayed(this, 3000) } }
    }, 3000)
  }
  private fun configure(width: Int, height: Int, geometry: Int) {
    pointerQueue.cancel()
    require(width in 1..8192 && height in 1..8192)
    codec?.stop(); codec?.release(); inputs.clear(); packets.clear(); queuedBytes = 0; keySeen = false; version = geometry
    val next = MediaCodec.createDecoderByType("video/avc")
    codec = next
    next.setCallback(object : MediaCodec.Callback() {
      override fun onInputBufferAvailable(codec: MediaCodec, index: Int) { if (!closed && codec === this@PhoneVideo.codec) { inputs.addLast(index); try { drain() } catch (_: Exception) { fail() } } }
      override fun onOutputBufferAvailable(codec: MediaCodec, index: Int, info: MediaCodec.BufferInfo) {
        if (!closed && codec === this@PhoneVideo.codec) { codec.releaseOutputBuffer(index, true); if (!rendered) { rendered = true; onPlaying() } }
      }
      override fun onError(codec: MediaCodec, error: MediaCodec.CodecException) { fail() }
      override fun onOutputFormatChanged(codec: MediaCodec, format: MediaFormat) {}
    }, handler)
    next.configure(MediaFormat.createVideoFormat("video/avc", width, height), surface, null, 0)
    next.start(); onGeometry(width, height, geometry)
  }
  private fun drain() {
    val active = codec ?: return
    while (inputs.isNotEmpty() && packets.isNotEmpty()) {
      val index = inputs.removeFirst(); val packet = packets.removeFirst(); queuedBytes -= packet.bytes.size
      val buffer = active.getInputBuffer(index) ?: error("PHONE_DECODER_BUFFER")
      require(packet.bytes.size <= buffer.capacity())
      buffer.clear(); buffer.put(packet.bytes); active.queueInputBuffer(index, 0, packet.bytes.size, packet.pts, packet.flags)
    }
  }
  private fun fail() { if (!closed) { onFailure(); close() } }
  fun close() {
    if (closed) return
    closed = true; socket?.cancel(); socket = null
    handler.post { codec?.let { runCatching { it.stop() }; it.release() }; codec = null; packets.clear(); inputs.clear(); thread.quitSafely() }
    http.dispatcher.executorService.shutdown(); http.connectionPool.evictAll()
  }
}
