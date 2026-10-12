package ai.xopc.mobile

import androidx.activity.ComponentActivity
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.lifecycle.Lifecycle
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test

class ForegroundRecoveryTest {
  @get:Rule val compose = createAndroidComposeRule<ComponentActivity>()

  @Test fun returningFromBackgroundTriggersRecoveryEachTime() {
    var foregrounds = 0
    var backgrounds = 0
    compose.setContent {
      GatewayForegroundRecovery(onForeground = { foregrounds++ }, onBackground = { backgrounds++ })
    }
    compose.runOnIdle { assertEquals(1, foregrounds) }
    repeat(2) { index ->
      compose.activityRule.scenario.moveToState(Lifecycle.State.CREATED)
      compose.runOnIdle { assertEquals(index + 1, backgrounds) }
      compose.activityRule.scenario.moveToState(Lifecycle.State.RESUMED)
      compose.runOnIdle { assertEquals(index + 2, foregrounds) }
    }
  }
}
