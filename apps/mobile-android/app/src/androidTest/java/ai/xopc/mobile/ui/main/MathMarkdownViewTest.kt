package ai.xopc.mobile.ui.main

import android.view.View
import android.view.ViewGroup
import android.webkit.WebView
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.mutableStateOf
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.onAllNodesWithTag
import androidx.compose.ui.test.assertCountEquals
import androidx.test.platform.app.InstrumentationRegistry
import androidx.test.runner.lifecycle.ActivityLifecycleMonitorRegistry
import androidx.test.runner.lifecycle.Stage
import java.util.concurrent.atomic.AtomicBoolean
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test

class MathMarkdownViewTest {
  @get:Rule val compose = createComposeRule()

  @Test fun messageBudgetRetainsSourceAcrossSeparateFormulaViews() {
    val raw = List(257) { "\\[x+$it\\]" }.joinToString("\n\n")
    compose.setContent { MaterialTheme { MarkdownContent(raw) } }
    compose.waitUntil(15_000) { compose.onAllNodesWithTag("markdown-content").fetchSemanticsNodes().isNotEmpty() }
    compose.onNodeWithText("\\[x+0\\]").assertExists()
    compose.onAllNodesWithTag("markdown-math").assertCountEquals(0)
  }

  @Test fun offlineFontsAndStreamingFormulaRemainStable() {
    val raw = "\\[\\mathcal{R}_{syn}(s_T;g)\\triangleq\\mathbb{I}\\big[V_g(s_T)=\\mathrm{True}\\big]\\]"
    val source = mutableStateOf(raw)
    val streaming = mutableStateOf(false)
    compose.setContent { MaterialTheme { MathMarkdownView(source.value, streaming.value, display = true) } }
    fun findWeb(view: View): WebView? {
      if (view is WebView) return view
      if (view is ViewGroup) for (index in 0 until view.childCount) findWeb(view.getChildAt(index))?.let { return it }
      return null
    }
    fun waitFor(script: String) {
      val ready = AtomicBoolean(false)
      compose.waitUntil(15_000) {
        InstrumentationRegistry.getInstrumentation().runOnMainSync {
          val activity = ActivityLifecycleMonitorRegistry.getInstance().getActivitiesInStage(Stage.RESUMED).firstOrNull()
          val web = activity?.window?.decorView?.let(::findWeb)
          web?.evaluateJavascript(script) { ready.set(it == "true") }
        }
        ready.get()
      }
      assertTrue(ready.get())
    }
    waitFor("document.querySelectorAll('.katex').length === 1 && document.fonts.check('16px KaTeX_Main')")
    compose.runOnIdle { streaming.value = true; source.value = "\\[x^" }
    waitFor("document.querySelectorAll('[data-xopc-math=pending]').length === 1 && document.querySelectorAll('.katex').length === 0")
    compose.runOnIdle { streaming.value = false; source.value = raw }
    waitFor("document.querySelectorAll('math').length === 1")
  }
}
