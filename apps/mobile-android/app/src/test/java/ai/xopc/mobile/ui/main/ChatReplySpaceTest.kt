package ai.xopc.mobile.ui.main

import org.junit.Assert.assertEquals
import org.junit.Test

class ChatReplySpaceTest {
  @Test fun reservesOnlyForFollowersAndConsumesBeforeScrolling() {
    var space = ChatReplySpace().begin(600f, false)
    assertEquals(0f, space.remaining, 0f)
    space = space.begin(600f, true)
    assertEquals(60f, space.remaining, 0f)
    space = space.consume(20f, 600f, true)
    assertEquals(40f, space.remaining, 0f)
    assertEquals(space, space.consume(240f, 240f, false))
    space = space.consume(20f, 300f, true)
    assertEquals(10f, space.remaining, 0f)
    space = space.consume(40f, 600f, true)
    assertEquals(10f, space.remaining, 0f)
    assertEquals(0f, space.consume(240f, 600f, true).remaining, 0f)
  }

  @Test fun nextSendRenewsSpaceAndTinyViewportsHaveNoNegativePadding() {
    val space = ChatReplySpace().begin(600f, true).consume(20f, 600f, true)
    assertEquals(64f, space.begin(1600f, true).remaining, 0f)
    assertEquals(20f, space.begin(200f, true).remaining, 0f)
    assertEquals(45f, space.begin(450f, true).remaining, 0f)
    assertEquals(0f, space.begin(-10f, true).remaining, 0f)
  }
}
