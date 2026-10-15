package ai.xopc.mobile.ui.main

import ai.xopc.mobile.R
import ai.xopc.mobile.gateway.ClarificationCommand
import ai.xopc.mobile.gateway.ClarificationRepository
import androidx.compose.material3.MaterialTheme
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.test.platform.app.InstrumentationRegistry
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Rule
import org.junit.Test

class ClarificationCardTest {
  @get:Rule val compose = createComposeRule()
  private fun label(id: Int) = InstrumentationRegistry.getInstrumentation().targetContext.getString(id)
  private fun request(mode: String = "compose", kind: String = "input") = ClarificationRepository.parse(JSONObject()
    .put("id", "question-1").put("kind", kind).put("version", 3).put("question", "Where?")
    .put("interactionMode", mode).put("recommendedChoiceId", "stage")
    .put("choiceDetails", org.json.JSONArray("""[{"id":"stage","label":"Stage","description":"For testing"},{"id":"prod","label":"Prod"}]"""))
    .also { if (kind == "approval") it.put("approval", JSONObject().put("operation", "Deploy").put("target", "production")) }, "conversation-1")

  @Test fun composeCombinesSelectionWithMultilineText() {
    var submitted: ClarificationCommand? = null
    compose.setContent { MaterialTheme { ClarificationCard(request(), false, null, { submitted = it }) } }
    compose.onNodeWithText("Prod").performClick()
    compose.runOnIdle { assertNull(submitted) }
    compose.onNode(hasSetTextAction()).performTextInput("After 22:00\nVerify first")
    compose.onNodeWithText(label(R.string.voice_answer_send)).performScrollTo().performClick()
    compose.runOnIdle {
      assertEquals("prod", submitted?.choiceId)
      assertEquals("After 22:00\nVerify first", submitted?.text)
      val body = submitted!!.body(3, "same-attempt")
      assertFalse(body.has("answer")); assertEquals("prod", body.getJSONObject("response").getString("choiceId"))
    }
  }

  @Test fun quickSelectionSendsOneStructuredAnswer() {
    var submitted: ClarificationCommand? = null
    compose.setContent { MaterialTheme { ClarificationCard(request("quick"), false, null, { submitted = it }) } }
    compose.onNodeWithText("Stage", substring = true).performClick()
    compose.runOnIdle { assertEquals(ClarificationCommand(choiceId = "stage"), submitted) }
  }

  @Test fun approvalHasNoTextInputOrAgentDecideAndRequiresAnExplicitDecision() {
    var submitted: ClarificationCommand? = null
    compose.setContent { MaterialTheme { ClarificationCard(request(kind = "approval"), false, null, { submitted = it }) } }
    compose.onNode(hasSetTextAction()).assertDoesNotExist()
    compose.onNodeWithText(label(R.string.voice_agent_decide)).assertDoesNotExist()
    compose.runOnIdle { assertNull(submitted) }
    compose.onNodeWithText(label(R.string.clarify_deny)).performScrollTo().performClick()
    compose.runOnIdle {
      assertEquals("deny", submitted?.decision)
      assertFalse(submitted!!.body(3, "decision").has("response"))
    }
  }

  @Test fun expiredApprovalCannotBeSubmitted() {
    compose.setContent { MaterialTheme { ClarificationCard(request(kind = "approval").copy(expiresAt = 1), false, null, {}) } }
    compose.onNodeWithText(label(R.string.clarify_approve)).assertIsNotEnabled()
  }
}
