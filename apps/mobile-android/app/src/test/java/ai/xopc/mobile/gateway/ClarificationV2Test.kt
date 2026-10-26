package ai.xopc.mobile.gateway

import java.io.File
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test

class ClarificationV2Test {
  private fun fixture(): JSONObject {
    var directory = File(requireNotNull(System.getProperty("user.dir")))
    while (!File(directory, "packages/gateway-contract/fixtures/clarification-v2.json").exists()) {
      directory = directory.parentFile ?: error("Shared clarification fixture not found")
    }
    return JSONObject(File(directory, "packages/gateway-contract/fixtures/clarification-v2.json").readText())
      .put("id", "batch-1").put("kind", "input").put("version", 4).put("question", "Three questions")
  }
  @Test fun decodesSharedFixtureAndDoesNotSelectRecommendedAnswer() {
    val request = ClarificationRepository.parse(fixture(), "conversation")
    assertEquals(2, request.schemaVersion)
    assertEquals(listOf("channel", "frequency", "direction"), request.questions.map { it.id })
    assertEquals("blog", request.questions.first().recommendedChoiceId)
    assertTrue(request.choiceDetails.isEmpty())
  }
  @Test fun encodesOneBatchWithoutLegacyResponseOrDecision() {
    val command = ClarificationCommand(schemaVersion = 2, answers = listOf(
      ClarificationAnswer("channel", "blog"), ClarificationAnswer("frequency", "weekly"), ClarificationAnswer("direction", text = "  Engineering notes\n中文  ")))
    val value = command.body(4, "attempt")
    assertEquals(2, value.getInt("schemaVersion")); assertEquals(3, value.getJSONArray("answers").length())
    assertEquals("Engineering notes\n中文", value.getJSONArray("answers").getJSONObject(2).getString("text"))
    assertFalse(value.has("response")); assertFalse(value.has("decision"))
    assertEquals(value.toString(), command.body(4, "attempt").toString())
  }
  @Test fun wholeBatchActionsOmitAnswers() {
    for (action in listOf("agent_decide", "cancel")) {
      val value = ClarificationCommand(action = action, schemaVersion = 2).body(4, "attempt")
      assertEquals(2, value.getInt("schemaVersion")); assertFalse(value.has("answers")); assertFalse(value.has("response"))
    }
  }
  @Test fun rejectsIncompleteDuplicateAndOversizedAnswers() {
    for (answers in listOf(emptyList(), listOf(ClarificationAnswer("a")),
      listOf(ClarificationAnswer("a", "x"), ClarificationAnswer("a", "x")), listOf(ClarificationAnswer("a", text = "x".repeat(2001))))) {
      assertThrows(IllegalArgumentException::class.java) { ClarificationCommand(schemaVersion = 2, answers = answers).body(4, "attempt") }
    }
  }
  @Test fun secureStorageKeysSeparateAccountWaitAndVersion() {
    val key = clarificationRecordKey("gateway.device", "draft.id.1")
    assertTrue(key.matches(Regex("[A-Za-z0-9._-]{1,120}")))
    assertNotEquals(key, clarificationRecordKey("gateway.other", "draft.id.1"))
    assertNotEquals(key, clarificationRecordKey("gateway.device", "draft.id.2"))
  }
  @Test fun rejectsBatchWhoseIndividualAnswersFitButSummaryExceedsContextBudget() {
    val request = ClarificationRepository.parse(fixture(), "conversation")
    val long = request.copy(questions = request.questions.map { it.copy(question = "x".repeat(1000)) })
    assertFalse(long.accepts(long.questions.map { ClarificationAnswer(it.id, text = "y".repeat(2000)) }))
    assertTrue(request.accepts(request.questions.map { ClarificationAnswer(it.id, text = "Custom answer") }))
  }

}
