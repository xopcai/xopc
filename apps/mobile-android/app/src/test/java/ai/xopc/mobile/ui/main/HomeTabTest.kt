package ai.xopc.mobile.ui.main

import org.junit.Assert.assertEquals
import org.junit.Test

class HomeTabTest {
  @Test
  fun orderMatchesHarmonyHome() {
    assertEquals(
      listOf("Assistant", "Conversations", "Progress", "Notes", "Me"),
      HomeTab.entries.map(HomeTab::name),
    )
  }
}
