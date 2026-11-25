package ai.xopc.mobile.ui.main

import androidx.activity.ComponentActivity
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.IconButton
import androidx.compose.material3.Text
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.mutableStateOf
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.getUnclippedBoundsInRoot
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performScrollTo
import androidx.compose.ui.unit.Density
import androidx.compose.ui.unit.dp
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test

class MobileChromeTest {
  @get:Rule val rule = createAndroidComposeRule<ComponentActivity>()

  @Test fun pageTitleStaysBetweenTheBackAndActionsInANarrowHeader() {
    rule.setContent {
      val density = LocalDensity.current
      CompositionLocalProvider(LocalDensity provides Density(density.density, fontScale = 2f)) {
        Box(Modifier.width(300.dp)) {
          XopcPageHeader(backTag = "back", onBack = {}, titleContent = {
            PageTitleMenu(listOf(SegmentOption("tasks", "All scheduled tasks", "tasks")), "tasks", "title") {}
          }) {
            IconButton(onClick = {}, modifier = Modifier.size(48.dp).testTag("search")) {}
            IconButton(onClick = {}, modifier = Modifier.size(48.dp).testTag("add")) {}
          }
        }
      }
    }

    val title = rule.onNodeWithTag("title").getUnclippedBoundsInRoot()
    val back = rule.onNodeWithTag("back").getUnclippedBoundsInRoot()
    val search = rule.onNodeWithTag("search").getUnclippedBoundsInRoot()
    assertTrue(title.right > title.left)
    assertTrue(title.left > back.right)
    assertTrue(title.right < search.left)
  }

  @OptIn(ExperimentalMaterial3Api::class)
  @Test fun sheetPresetsLimitHeightAndCompactContentCanScroll() {
    val preset = mutableStateOf(XopcSheetPreset.Immersive)
    rule.setContent {
      XopcBottomSheet(preset.value, onDismissRequest = {}, modifier = Modifier.testTag("sheet")) {
        Spacer(Modifier.height(1200.dp))
        Text("Last action")
      }
    }

    val sheet = rule.onNodeWithTag("sheet")
    fun sheetHeight(): Float {
      val bounds = sheet.getUnclippedBoundsInRoot()
      return (bounds.bottom - bounds.top).value
    }
    val immersiveHeight = sheetHeight()
    for ((size, fraction) in listOf(
      XopcSheetPreset.Large to 0.90f,
      XopcSheetPreset.Medium to 0.72f,
      XopcSheetPreset.Compact to 0.50f,
    )) {
      rule.runOnIdle { preset.value = size }
      assertEquals(immersiveHeight * fraction / 0.94f, sheetHeight(), 2f)
    }
    rule.onNodeWithText("Last action").performScrollTo().assertIsDisplayed()
  }
}
