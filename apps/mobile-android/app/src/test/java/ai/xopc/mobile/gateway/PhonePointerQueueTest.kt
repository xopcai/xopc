package ai.xopc.mobile.gateway

import org.junit.Assert.*
import org.junit.Test
import org.json.JSONObject

class PhonePointerQueueTest {
  @Test fun coalescesMovesAndRetainsFinalUp() {
    val sent = mutableListOf<String>()
    val queue = PhonePointerQueue({ phase, x, _, seq -> sent.add("$seq:$phase:$x") }, {})
    queue.pointer("down", 10, 10)
    repeat(400) { queue.pointer("move", it, 20) }
    queue.pointer("up", 500, 30)
    assertEquals(listOf("1:down:10"), sent)
    queue.ack(1); queue.ack(2); queue.ack(3)
    assertEquals(listOf("1:down:10", "2:move:500", "3:up:500"), sent)
    assertEquals(0L, queue.pendingSince)
  }
  @Test fun cancellationIgnoresStaleAcknowledgements() {
    val sent = mutableListOf<String>(); var cancelled = 0
    val queue = PhonePointerQueue({ phase, _, _, _ -> sent.add(phase) }, { cancelled++ })
    queue.pointer("down", 0, 0); queue.pointer("up", 0, 0); queue.cancel(); queue.ack(1)
    assertEquals(listOf("down"), sent); assertEquals(1, cancelled)
    queue.pointer("down", 1, 1); queue.ack(1)
    assertEquals(listOf("down", "down"), sent)
  }
  @Test fun parsesControlOwnershipAndRecovery() {
    val state = PhoneRepository.parseState(JSONObject("""{"report":{"sessionId":"phone","controlEpoch":7,"mode":"control","status":"needs_user","reconnectRequired":true},"ownControl":false,"textInput":"manual"}"""))
    assertEquals(7, state.epoch); assertTrue(state.restore); assertTrue(state.manualText); assertFalse(state.ownControl)
  }
}
