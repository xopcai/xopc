package ai.xopc.mobile.gateway

import androidx.test.ext.junit.runners.AndroidJUnit4
import org.junit.Assert.assertEquals
import org.junit.Assert.assertThrows
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class PersonalRepositoryTest {
  @Test fun parsesHarmonyMobileSummaryAndLimitsLists() {
    val summary = PersonalRepository.parseSummary("""{
      "profile":{"callName":"","role":"Designer"},"suggestedCallName":"Mia",
      "counts":{"total":4,"explicit":2,"learned":2,"review":1,"workMemory":3},
      "primaryFocus":{"title":"Ship app","desiredOutcome":"Launch"},
      "goals":[{"id":"g1","title":"Ship app","desiredOutcome":"Launch","status":"active",
        "targetAt":1735689600000,"isPrimary":true}],
      "recent":[{"id":"a1","statement":"Prefers concise answers","authority":"user_explicit"}],
      "rules":[{"id":"r1","statement":"Ask before publishing"}]
    }""")
    assertEquals("Mia", summary.name)
    assertEquals("Designer", summary.role)
    assertEquals(1, summary.counts.review)
    assertEquals("Launch", summary.goals.single().outcome)
    assertEquals(1735689600000L, summary.goals.single().targetAt)
    assertEquals("Ask before publishing", summary.rules.single().statement)
  }

  @Test fun rejectsUnexpectedlyLongProjection() {
    val rules = (1..4).joinToString(",") { """{"id":"$it","statement":"rule"}""" }
    assertThrows(IllegalArgumentException::class.java) {
      PersonalRepository.parseSummary("""{"profile":{},"counts":{"total":0,"explicit":0,
        "learned":0,"review":0,"workMemory":0},"recent":[],"rules":[$rules]}""")
    }
  }

  @Test fun parsesMobileAssertionPageWithCursorAndPublicSource() {
    val page = PersonalRepository.parseAssertions("""{"items":[{"id":"a-1",
      "statement":"Prefers concise answers","authority":"user_explicit","status":"needs_review",
      "scope":{"type":"global"},"confidence":0.92,"recordedAt":123,
      "sources":[{"id":"s-1","kind":"conversation","label":"Project chat"}]}],
      "nextCursor":"next+page"}""")
    assertEquals("next+page", page.nextCursor)
    assertEquals("needs_review", page.items.single().status)
    assertEquals("global", page.items.single().scope)
    assertEquals(0.92, page.items.single().confidence, 0.001)
    assertEquals(listOf("Project chat"), page.items.single().sources)
  }
}
