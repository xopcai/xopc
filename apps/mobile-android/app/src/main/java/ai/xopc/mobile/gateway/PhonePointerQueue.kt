package ai.xopc.mobile.gateway

/** ACK-paced input coalesces MOVE while preserving the final UP. Call from one thread. */
internal class PhonePointerQueue(private val send: (String, Int, Int, Int) -> Unit, private val cancelInput: () -> Unit) {
  private var sequence = 0
  private var outstanding = 0
  private var held = false
  private var move: Pair<Int, Int>? = null
  private var end: Pair<Int, Int>? = null
  var pendingSince = 0L
    private set
  fun pointer(phase: String, x: Int, y: Int) {
    if (phase == "cancel") { cancel(); return }
    if (phase == "down") { cancel(); held = true; dispatch(phase, x, y); return }
    if (!held) return
    if (phase == "move") move = x to y
    if (phase == "up") { held = false; if (move != null) move = x to y; end = x to y }
    drain()
  }
  fun ack(seq: Int) { if (seq == outstanding) { outstanding = 0; pendingSince = 0; drain() } }
  private fun drain() {
    if (outstanding != 0) return
    move?.let { move = null; dispatch("move", it.first, it.second); return }
    end?.let { end = null; dispatch("up", it.first, it.second) }
  }
  private fun dispatch(phase: String, x: Int, y: Int) { outstanding = ++sequence; pendingSince = System.currentTimeMillis(); send(phase, x, y, outstanding) }
  fun cancel() {
    val active = held || outstanding != 0 || end != null
    held = false; outstanding = 0; pendingSince = 0; move = null; end = null
    if (active) cancelInput()
  }
}
