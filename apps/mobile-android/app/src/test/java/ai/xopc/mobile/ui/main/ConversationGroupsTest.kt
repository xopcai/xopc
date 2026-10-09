package ai.xopc.mobile.ui.main

import ai.xopc.mobile.gateway.ConversationSummary
import java.time.Instant
import java.time.ZoneId
import org.junit.Assert.assertEquals
import org.junit.Test

class ConversationGroupsTest {
  private val now = Instant.parse("2026-10-22T12:00:00Z")
  private val zone = ZoneId.of("UTC")
  private fun item(id: String, date: String) = ConversationSummary(id, id, date, 0, "main")

  @Test fun groupsByLocalCalendarInHarmonyOrder() {
    val items = listOf(
      item("today", "2026-10-22T11:00:00Z"), item("yesterday", "2026-10-21T11:00:00Z"),
      item("week", "2026-10-20T11:00:00Z"), item("last-week", "2026-10-14T11:00:00Z"),
      item("month", "2026-10-02T11:00:00Z"), item("older", "2026-09-10T11:00:00Z"),
      item("invalid", "not-a-date"),
    )
    assertEquals(listOf("today", "yesterday", "this_week", "last_week", "this_month", "2026-09", "earlier"),
      ConversationGroups.group(items, now, zone).map { it.id })
  }

  @Test fun localMidnightDeterminesTodayRatherThanUtcDate() {
    val shanghai = ZoneId.of("Asia/Shanghai")
    val localNow = Instant.parse("2026-10-21T16:30:00Z")
    val earlier = item("earlier", "2026-10-21T15:00:00Z")
    assertEquals("yesterday", ConversationGroups.group(listOf(earlier), localNow, shanghai).single().id)
  }

  @Test fun relativeAgeMatchesHarmonyUnitsAndHandlesInvalidDates() {
    assertEquals(ConversationAge("now"), ConversationGroups.age("2026-10-22T12:00:00Z", now, zone))
    assertEquals(ConversationAge("minute", 15), ConversationGroups.age("2026-10-22T11:45:00Z", now, zone))
    assertEquals(ConversationAge("hour", 2), ConversationGroups.age("2026-10-22T10:00:00Z", now, zone))
    assertEquals(ConversationAge("invalid"), ConversationGroups.age("invalid", now, zone))
  }

  @Test fun historyHidesLocalDraftsAndEmptyRemoteConversations() {
    val started = item("started", "2026-10-22T11:00:00Z").copy(messageCount = 2)
    val empty = item("empty", "2026-10-22T11:00:00Z")
    val draft = empty.copy(id = "draft", isLocalDraft = true)
    assertEquals(listOf(started), ConversationGroups.visibleHistory(listOf(draft, empty, started)))
  }

}
