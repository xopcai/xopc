package ai.xopc.mobile.ui.main

import android.view.View
import android.view.ViewGroup
import android.webkit.WebView
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.mutableStateOf
import androidx.compose.ui.test.assertCountEquals
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onAllNodesWithTag
import androidx.test.platform.app.InstrumentationRegistry
import androidx.test.runner.lifecycle.ActivityLifecycleMonitorRegistry
import androidx.test.runner.lifecycle.Stage
import java.util.concurrent.atomic.AtomicBoolean
import org.junit.Rule
import org.junit.Test

class ChartMarkdownViewTest {
  @get:Rule val compose = createComposeRule()

  @Test fun actualWebViewRendersOnlyAfterFenceClosesAndSupportsBothTypes() {
    val spec = """{"version":1,"type":"line","title":"Offline chart","summary":"Nulls and negatives","dataKind":"example","xAxis":{"label":"Month","values":["Jan","Feb","Mar"]},"yAxis":{"label":"Amount","unit":"USD"},"series":[{"name":"A","values":[1,null,-2]},{"name":"B","values":[-3,0,2]}]}"""
    val source = mutableStateOf("```chart\n$spec")
    compose.setContent { MaterialTheme { MarkdownContent(source.value, streaming = true) } }
    compose.waitUntil(15_000) { compose.onAllNodesWithTag("markdown-chart").fetchSemanticsNodes().isNotEmpty() }
    compose.onAllNodesWithTag("chart-webview").assertCountEquals(0)
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
          activity?.window?.decorView?.let(::findWeb)?.evaluateJavascript(script) { ready.set(it == "true") }
        }
        ready.get()
      }
    }
    compose.runOnIdle { source.value += "\n```" }
    waitFor("document.body.dataset.chartType === 'line' && document.querySelectorAll('canvas').length === 1 && document.querySelectorAll('tr').length === 4 && document.querySelector('#table').textContent.includes('—')")
    compose.runOnIdle { source.value = "```chart\n${spec.replace("\"line\"", "\"bar\"")}\n```" }
    waitFor("document.body.dataset.chartType === 'bar' && document.querySelectorAll('canvas').length === 1 && document.querySelector('#table').textContent.includes('-3')")
    compose.runOnIdle { source.value = "```chart\n{}\n```" }
    waitFor("document.querySelectorAll('canvas').length === 0 && document.querySelector('#status').textContent.includes('UNSUPPORTED_VERSION')")
  }
}
