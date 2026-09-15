package ai.xopc.voice

import android.content.Context
import android.media.AudioFormat
import android.media.AudioManager
import android.media.AudioRecord
import android.media.AudioRecordingConfiguration
import android.media.AudioRouting
import android.media.MediaRecorder
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import java.io.File
import java.util.concurrent.ArrayBlockingQueue
import java.util.concurrent.atomic.AtomicBoolean

/** The foreground service owns this capture; an Activity must not own its lifetime. */
class RecordingCapture(private val context: Context, private val dispatch: (() -> Unit) -> Unit, private val onInterrupted: (String) -> Unit) {
  private val handler = Handler(Looper.getMainLooper())
  private val manager = context.getSystemService(Context.AUDIO_SERVICE) as AudioManager
  private var input: AudioRecord? = null
  private var reader: Thread? = null
  private var writer: Thread? = null
  private var spool: RecordingSpool? = null
  private var queue: ArrayBlockingQueue<ByteArray>? = null
  private val accepting = AtomicBoolean(false)
  private val failurePosted = AtomicBoolean(false)
  @Volatile private var generation = 0
  private var routeListener: AudioRouting.OnRoutingChangedListener? = null
  private var recordingCallback: AudioManager.AudioRecordingCallback? = null
  private var inputDevice: Int? = null
  @Volatile var captureId: String? = null
    private set

  fun start(root: File, id: String) {
    check(input == null) { "RECORDING_BUSY" }
    captureId = id
    val journal = try { RecordingSpool(root, id) } catch (error: Exception) { captureId = null; throw error }
    val epoch = (journal.chunks.lastOrNull()?.epoch ?: -1) + 1
    val min = AudioRecord.getMinBufferSize(16000, AudioFormat.CHANNEL_IN_MONO, AudioFormat.ENCODING_PCM_16BIT)
    if (min <= 0) { captureId = null; journal.close(); error("MICROPHONE_FORMAT_UNAVAILABLE") }
    var candidate: AudioRecord? = null
    try {
      candidate = AudioRecord(MediaRecorder.AudioSource.MIC, 16000, AudioFormat.CHANNEL_IN_MONO, AudioFormat.ENCODING_PCM_16BIT, maxOf(min, 6400))
      check(candidate.state == AudioRecord.STATE_INITIALIZED) { "MICROPHONE_UNAVAILABLE" }
      input = candidate
      spool = journal
      captureId = id
      generation++
      val current = generation
      val recorder = candidate
      val blocks = ArrayBlockingQueue<ByteArray>(25)
      queue = blocks
      accepting.set(true)
      failurePosted.set(false)
      inputDevice = null
      routeListener = AudioRouting.OnRoutingChangedListener { routing ->
        val device = routing.routedDevice
        if (inputDevice != null && device?.id != inputDevice) fail("route_lost", current)
        else inputDevice = device?.id
      }
      recorder.addOnRoutingChangedListener(routeListener!!, handler)
      if (Build.VERSION.SDK_INT >= 29) {
        recordingCallback = object : AudioManager.AudioRecordingCallback() {
          override fun onRecordingConfigChanged(configs: MutableList<AudioRecordingConfiguration>) {
            if (configs.any { it.clientAudioSessionId == recorder.audioSessionId && it.isClientSilenced }) fail("microphone_silenced", current)
          }
        }
        manager.registerAudioRecordingCallback(recordingCallback!!, handler)
      }
      recorder.startRecording()
      check(recorder.recordingState == AudioRecord.RECORDSTATE_RECORDING) { "MICROPHONE_UNAVAILABLE" }
      writer = Thread({
        var storageFailed = false
        while (true) {
          val bytes = try { blocks.take() }
          catch (_: InterruptedException) { fail("recording_writer_interrupted", current); continue }
          if (bytes.isEmpty()) break
          if (!storageFailed) {
            try { journal.append(bytes, epoch) }
            catch (_: Exception) { storageFailed = true; fail("recording_storage_failed", current) }
          }
        }
      }, "xopc-recording-writer").apply { start() }
      reader = Thread({
        val buffer = ByteArray(1280)
        var lastFrameAt = SystemClock.elapsedRealtime()
        try {
          while (accepting.get()) {
            val count = recorder.read(buffer, 0, buffer.size, AudioRecord.READ_NON_BLOCKING)
            if (count < 0) { fail("recording_capture_failed", current); break }
            if (count == 0) {
              if (SystemClock.elapsedRealtime() - lastFrameAt > 2000) { fail("recording_no_frames", current); break }
              Thread.sleep(5)
              continue
            }
            lastFrameAt = SystemClock.elapsedRealtime()
            if (accepting.get() && !blocks.offer(buffer.copyOf(count))) {
              fail("recording_writer_overrun", current)
              break
            }
          }
        } catch (_: Exception) { fail("recording_capture_failed", current) }
      }, "xopc-recording-capture").apply { start() }
    } catch (error: Exception) {
      if (input != null) { try { stop() } catch (_: Exception) { } }
      else { captureId = null; candidate?.release(); journal.close() }
      throw error
    }
  }

  fun stop(): List<RecordingChunk> {
    val recorder = input ?: return emptyList()
    val journal = requireNotNull(spool)
    generation++
    accepting.set(false)
    routeListener?.let { recorder.removeOnRoutingChangedListener(it) }; routeListener = null
    recordingCallback?.let { manager.unregisterAudioRecordingCallback(it) }; recordingCallback = null
    try {
      try { reader?.join() }
      finally {
        try { recorder.stop() }
        finally {
          try { recorder.release() }
          finally {
            try { if (writer != null) { queue!!.put(ByteArray(0)); writer!!.join() } }
            finally { journal.close() }
          }
        }
      }
      return journal.chunks
    } finally {
      input = null; reader = null; writer = null; spool = null; queue = null; captureId = null
    }
  }

  private fun fail(reason: String, current: Int) {
    if (generation != current) return
    if (!failurePosted.compareAndSet(false, true)) return
    accepting.set(false)
    dispatch {
      if (generation != current || input == null) return@dispatch
      try { stop(); onInterrupted(reason) }
      catch (_: Exception) { onInterrupted("recording_storage_failed") }
    }
  }
}
