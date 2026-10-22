package ai.xopc.mobile.ui.main

import ai.xopc.mobile.gateway.GatewayProfile
import ai.xopc.mobile.gateway.PersonalAgentRecord
import ai.xopc.mobile.theme.XopcTheme
import android.graphics.Bitmap
import androidx.activity.ComponentActivity
import androidx.compose.runtime.mutableStateOf
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.ScrollState
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.unit.dp
import androidx.compose.ui.graphics.asAndroidBitmap
import androidx.compose.ui.test.assertIsEnabled
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.assertIsNotEnabled
import androidx.compose.ui.test.assertIsSelected
import androidx.compose.ui.test.captureToImage
import androidx.compose.ui.test.getUnclippedBoundsInRoot
import androidx.compose.ui.test.isRoot
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performTouchInput
import androidx.compose.ui.test.swipe
import androidx.compose.ui.test.swipeUp
import androidx.test.platform.app.InstrumentationRegistry
import java.io.File
import org.junit.Rule
import org.junit.Test
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue

class LifeWorkModesTest {
  @get:Rule val rule = createAndroidComposeRule<ComponentActivity>()

  @Test fun lifeHidesDockLocksAgentAndRestoresWorkChrome() {
    val agent = PersonalAgentRecord("personal", "personal-chat", "ready", "Ada", "loopi", null)
    val state = mutableStateOf(ConnectionUiState(
      profile = GatewayProfile("gateway", "Test", "key", "device", emptyList(), ""),
      selectedConversationId = "work-chat",
      personal = PersonalUiState(gatewayId = "gateway", agent = agent),
    ))
    rule.setContent {
      XopcTheme {
        MainContent(HomeTab.Assistant, {}, state.value, onSwitchLifeMode = { life ->
          state.value = state.value.copy(lifeMode = life,
            selectedConversationId = if (life) "personal-chat" else "work-chat")
        })
      }
    }
    rule.onNodeWithTag("main-tab-dock").assertIsDisplayed()
    rule.onNodeWithTag("home-mode-life").performClick()
    rule.waitForIdle()
    rule.onNodeWithTag("home-mode-life").assertIsSelected()
    rule.onNodeWithTag("main-tab-dock").assertDoesNotExist()
    rule.onNodeWithTag("chat-agent-switch").assertIsNotEnabled()
    rule.onNodeWithTag("chat-header-search").assertIsDisplayed()
    rule.onNodeWithTag("assistant-options").assertIsDisplayed()
    capture("life-mode")
    rule.onNodeWithTag("home-mode-work").performClick()
    rule.waitForIdle()
    rule.onNodeWithTag("home-mode-work").assertIsSelected()
    rule.onNodeWithTag("main-tab-dock").assertIsDisplayed()
    rule.onNodeWithTag("tab-Assistant").assertIsSelected()
    capture("work-mode")
  }

  @Test fun workRemainsAvailableWhilePersonalAgentIsOpening() {
    val state = mutableStateOf(true)
    rule.setContent {
      XopcTheme { SceneSwitch(false, state.value) { if (!it) state.value = false } }
    }
    rule.onNodeWithTag("home-mode-life").assertIsNotEnabled()
    rule.onNodeWithTag("home-mode-work").performClick()
    rule.onNodeWithTag("home-mode-life").assertIsEnabled()
  }

  @Test fun selectionSlidesAndCanReverseBeforeSettling() {
    val life = mutableStateOf(false)
    rule.setContent { XopcTheme { SceneSwitch(life.value, false) { life.value = it } } }
    rule.mainClock.autoAdvance = false
    val indicator = rule.onNodeWithTag("scene-selection")
    val workPosition = indicator.getUnclippedBoundsInRoot().left
    rule.onNodeWithTag("home-mode-life").performClick()
    rule.mainClock.advanceTimeBy(96)
    val middlePosition = indicator.getUnclippedBoundsInRoot().left
    assertTrue(middlePosition < workPosition)
    assertTrue(middlePosition > workPosition - androidx.compose.ui.unit.Dp(64f))
    rule.onNodeWithTag("home-mode-work").performClick()
    rule.mainClock.advanceTimeBy(320)
    assertEquals(workPosition, indicator.getUnclippedBoundsInRoot().left)
    rule.onNodeWithTag("home-mode-work").assertIsSelected()
  }

  @Test fun chatSwipesSwitchScenesButShortVerticalAndEdgeDragsDoNot() {
    val life = mutableStateOf(false)
    val opening = mutableStateOf(false)
    var switches = 0
    rule.setContent {
      XopcTheme {
        Box(Modifier.size(320.dp, 480.dp).chatSceneSwipe(life.value, !opening.value) {
          life.value = it; switches++
        }.testTag("swipe-area"))
      }
    }
    val area = rule.onNodeWithTag("swipe-area")
    area.performTouchInput { swipeUp() }
    area.performTouchInput { swipe(Offset(width * 0.4f, height * 0.5f), Offset(width * 0.5f, height * 0.5f)) }
    area.performTouchInput { swipe(Offset(1f, height * 0.5f), Offset(width * 0.7f, height * 0.5f)) }
    rule.runOnIdle { assertEquals(0, switches) }
    area.performTouchInput { swipe(Offset(width * 0.25f, height * 0.5f), Offset(width * 0.75f, height * 0.5f)) }
    rule.runOnIdle { assertTrue(life.value); assertEquals(1, switches) }
    area.performTouchInput { swipe(Offset(width * 0.75f, height * 0.5f), Offset(width * 0.25f, height * 0.5f)) }
    rule.runOnIdle { assertTrue(!life.value); assertEquals(2, switches); opening.value = true }
    area.performTouchInput { swipe(Offset(width * 0.25f, height * 0.5f), Offset(width * 0.75f, height * 0.5f)) }
    rule.runOnIdle { assertEquals(2, switches) }
  }

  @Test fun nestedHorizontalContentKeepsItsScrollGesture() {
    var switches = 0
    lateinit var scroll: ScrollState
    rule.setContent {
      XopcTheme {
        scroll = rememberScrollState()
        Box(Modifier.size(320.dp, 240.dp).chatSceneSwipe(true, true) { switches++ }) {
          Box(Modifier.size(320.dp, 240.dp).horizontalScroll(scroll).testTag("horizontal-content")) {
            Box(Modifier.width(960.dp))
          }
        }
      }
    }
    rule.onNodeWithTag("horizontal-content").performTouchInput {
      swipe(Offset(width * 0.75f, height * 0.5f), Offset(width * 0.25f, height * 0.5f))
    }
    rule.runOnIdle { assertEquals(0, switches); assertTrue(scroll.value > 0) }
  }

  private fun capture(name: String) {
    val directory = InstrumentationRegistry.getInstrumentation().targetContext.getExternalFilesDir("scene-tests")!!
    File(directory, "$name.png").outputStream().use {
      rule.onNode(isRoot()).captureToImage().asAndroidBitmap().compress(Bitmap.CompressFormat.PNG, 100, it)
    }
  }
}
