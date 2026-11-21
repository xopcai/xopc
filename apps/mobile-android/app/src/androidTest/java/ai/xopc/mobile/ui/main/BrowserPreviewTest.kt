package ai.xopc.mobile.ui.main

import ai.xopc.mobile.R
import ai.xopc.mobile.theme.XopcTheme
import android.webkit.WebView
import androidx.activity.ComponentActivity
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.viewinterop.AndroidView
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test

class BrowserPreviewTest {
  @get:Rule val compose = createAndroidComposeRule<ComponentActivity>()

  @Test fun resizingRetainsTheRendererAndClosingReleasesIt() {
    var visible by mutableStateOf(true)
    var expanded by mutableStateOf(true)
    var created = 0
    var released = 0
    compose.setContent {
      XopcTheme {
        if (visible) {
          BrowserPreviewWindow("Test Chrome tab", "", "playing", "normal", expanded, Alignment.TopEnd,
            onToggle = { expanded = !expanded }, onMove = {}, onClose = { visible = false }) {
            AndroidView(factory = {
              created++
              WebView(it)
            }, onRelease = {
              released++
              it.destroy()
            })
          }
        }
      }
    }
    compose.onNodeWithText(compose.activity.getString(R.string.browser_preview_shrink)).performClick()
    compose.onNodeWithText("Test Chrome tab").assertIsDisplayed()
    compose.onNodeWithText(compose.activity.getString(R.string.browser_preview_expand)).performClick()
    compose.runOnIdle {
      assertEquals(1, created)
      assertEquals(0, released)
    }
    compose.onNodeWithText(compose.activity.getString(R.string.browser_preview_close)).performClick()
    compose.onNodeWithText("Test Chrome tab").assertDoesNotExist()
    compose.runOnIdle { assertEquals(1, released) }
  }
}
