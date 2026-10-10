package ai.xopc.mobile.ui.main

/** Reply-scoped monotonic timing shared by socket delivery and the audio writer. */
internal class VoiceFirstAudioTiming {
  private data class Reply(val stoppedAt: Long?, var received: Boolean = false,
    var buffered: Boolean = false)
  private var stoppedAt: Long? = null
  private val replies = linkedMapOf<String, Reply>()

  @Synchronized fun speechStarted() { stoppedAt = null }
  @Synchronized fun speechStopped(now: Long) { stoppedAt = now }
  @Synchronized fun created(id: String) {
    if (id.isEmpty() || replies.containsKey(id)) return
    if (replies.size >= 32) replies.remove(replies.keys.first())
    replies[id] = Reply(stoppedAt)
    stoppedAt = null
  }
  @Synchronized fun received(id: String, now: Long): Long? {
    val reply = replies[id] ?: return null
    if (reply.received) return null
    reply.received = true
    return reply.stoppedAt?.let { (now - it).coerceAtLeast(0) }
  }
  @Synchronized fun buffered(id: String, now: Long): Long? {
    val reply = replies[id] ?: return null
    if (!reply.received || reply.buffered) return null
    reply.buffered = true
    return reply.stoppedAt?.let { (now - it).coerceAtLeast(0) }
  }
  @Synchronized fun finish(id: String) { replies.remove(id) }
  @Synchronized fun reset() { stoppedAt = null; replies.clear() }
}
