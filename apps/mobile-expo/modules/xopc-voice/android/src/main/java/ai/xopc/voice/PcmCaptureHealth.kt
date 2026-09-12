package ai.xopc.voice

internal class PcmCaptureHealth(
  private val startupSilenceBytes: Int = 16_000 * 2 * 5,
  private val minimumSignalAmplitude: Int = 16,
) {
  private var silentBytes = 0
  private var signalObserved = false

  fun reset() {
    silentBytes = 0
    signalObserved = false
  }

  fun observe(bytes: ByteArray, count: Int): Boolean {
    if (signalObserved || count <= 0) return true
    val readable = minOf(count, bytes.size)
    var index = 0
    while (index + 1 < readable) {
      val sample = ((bytes[index].toInt() and 0xff) or (bytes[index + 1].toInt() shl 8)).toShort().toInt()
      if (kotlin.math.abs(sample) >= minimumSignalAmplitude) {
        signalObserved = true
        return true
      }
      index += 2
    }
    silentBytes += count
    return silentBytes < startupSilenceBytes
  }
}
