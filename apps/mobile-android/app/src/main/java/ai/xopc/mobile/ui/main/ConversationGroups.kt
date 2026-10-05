package ai.xopc.mobile.ui.main

import ai.xopc.mobile.gateway.ConversationSummary
import java.time.Duration
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneId
import java.time.format.DateTimeParseException
import java.util.Locale

data class ConversationGroup(val id: String, val items: List<ConversationSummary>)
data class ConversationAge(val unit: String, val count: Long = 0, val date: LocalDate? = null)

/** Match the HarmonyOS session date buckets using the device's local calendar. */
object ConversationGroups {
  fun group(items: List<ConversationSummary>, now: Instant = Instant.now(), zone: ZoneId = ZoneId.systemDefault()): List<ConversationGroup> {
    val today = now.atZone(zone).toLocalDate()
    val week = today.minusDays((today.dayOfWeek.value - 1).toLong())
    val previousWeek = week.minusWeeks(1)
    val month = today.withDayOfMonth(1)
    val groups = linkedMapOf<String, MutableList<ConversationSummary>>()
    items.forEach { item ->
      val date = timestamp(item.updatedAt)?.atZone(zone)?.toLocalDate()
      val id = when {
        date == null -> "earlier"
        !date.isBefore(today) -> "today"
        date == today.minusDays(1) -> "yesterday"
        !date.isBefore(week) -> "this_week"
        !date.isBefore(previousWeek) -> "last_week"
        !date.isBefore(month) -> "this_month"
        else -> "%04d-%02d".format(Locale.ROOT, date.year, date.monthValue)
      }
      groups.getOrPut(id) { mutableListOf() }.add(item)
    }
    return groups.map { (id, entries) -> ConversationGroup(id, entries) }
  }

  fun age(updatedAt: String, now: Instant = Instant.now(), zone: ZoneId = ZoneId.systemDefault()): ConversationAge {
    val time = timestamp(updatedAt) ?: return ConversationAge("invalid")
    val minutes = Duration.between(time, now).toMinutes()
    if (minutes < 1) return ConversationAge("now")
    if (minutes < 60) return ConversationAge("minute", minutes)
    val hours = minutes / 60
    if (hours < 24) return ConversationAge("hour", hours)
    val days = hours / 24
    if (days < 7) return ConversationAge("day", days)
    val weeks = days / 7
    return if (weeks < 5) ConversationAge("week", weeks)
      else ConversationAge("date", date = time.atZone(zone).toLocalDate())
  }

  private fun timestamp(value: String): Instant? = try {
    Instant.parse(value)
  } catch (_: DateTimeParseException) {
    null
  }
}
