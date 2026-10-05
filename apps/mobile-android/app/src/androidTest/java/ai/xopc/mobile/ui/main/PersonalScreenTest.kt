package ai.xopc.mobile.ui.main

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class PersonalScreenTest {
  @Test fun dateFieldRequiresRealIsoDateAtLocalDayEnd() {
    assertNull(goalDateTimestamp(""))
    assertNull(goalDateTimestamp("2025-02-30"))
    assertNull(goalDateTimestamp("2025-2-3"))
    val value = goalDateTimestamp("2025-02-03")!!
    val expected = java.time.LocalDate.of(2025, 2, 3).atTime(23, 59, 59)
      .atZone(java.time.ZoneId.systemDefault()).toInstant().toEpochMilli()
    assertEquals(expected, value)
  }
}
