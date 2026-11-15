package ai.xopc.mobile.ui.main

import ai.xopc.mobile.gateway.GatewayProfile
import ai.xopc.mobile.playback.MusicPhase
import ai.xopc.mobile.playback.MusicPlayback
import ai.xopc.mobile.playback.MusicTrack
import ai.xopc.mobile.theme.XopcTheme
import android.os.SystemClock
import androidx.activity.ComponentActivity
import androidx.compose.runtime.mutableStateOf
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.performClick
import androidx.lifecycle.Lifecycle
import androidx.test.platform.app.InstrumentationRegistry
import java.io.OutputStream
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test

class MusicPlaybackJourneyTest {
  @get:Rule val compose = createAndroidComposeRule<ComponentActivity>()

  @Test fun continuesAcrossConversationsAndRespondsToTheSystemInBackground() {
    val track = MusicTrack("fixture", "source", "test-audio", "Music fixture", "Source chat")
    val profile = GatewayProfile(track.gatewayId, "Fixture", "", "", emptyList(), "")
    val selected = mutableStateOf("source")
    compose.setContent {
      XopcTheme {
        MainContent(selectedTab = HomeTab.Assistant, onSelectTab = {},
          connection = ConnectionUiState(profile = profile, selectedConversationId = selected.value))
      }
    }
    compose.runOnIdle {
      MusicPlayback.play(compose.activity, track) { file -> file.outputStream().use(::writeFixtureAudio) }
    }
    try {
      compose.waitUntil(10_000) { MusicPlayback.state.value?.phase == MusicPhase.Playing }
      compose.runOnIdle { selected.value = "other" }
      compose.onNodeWithTag("music-mini-player").assertExists()
      compose.onNodeWithTag("music-expand").performClick()
      compose.onNodeWithTag("music-full-player").assertExists()
      compose.onNodeWithTag("music-player-close").performClick()
      compose.activityRule.scenario.moveToState(Lifecycle.State.CREATED)
      val power = InstrumentationRegistry.getInstrumentation().targetContext.getSystemService(android.os.PowerManager::class.java)
      shellCommand("input keyevent KEYCODE_SLEEP")
      val before = MusicPlayback.state.value?.positionMs ?: error("Missing state")
      waitForPlayback { !power.isInteractive && it?.phase == MusicPhase.Playing && it.positionMs > before }
      shellCommand("cmd media_session dispatch pause")
      waitForPlayback { it?.phase == MusicPhase.Paused }
      shellCommand("cmd media_session dispatch play")
      waitForPlayback { it?.phase == MusicPhase.Playing }
      wakeScreen()
      compose.activityRule.scenario.moveToState(Lifecycle.State.RESUMED)
      compose.onNodeWithTag("music-stop").performClick()
      compose.waitUntil(5_000) { MusicPlayback.state.value == null }
    } finally {
      wakeScreen()
      InstrumentationRegistry.getInstrumentation().runOnMainSync { MusicPlayback.stop() }
    }
  }

  private fun waitForPlayback(predicate: (ai.xopc.mobile.playback.MusicState?) -> Boolean) {
    val end = SystemClock.elapsedRealtime() + 8_000
    while (!predicate(MusicPlayback.state.value) && SystemClock.elapsedRealtime() < end) SystemClock.sleep(100)
    assertTrue("Unexpected playback state: ${MusicPlayback.state.value?.phase}", predicate(MusicPlayback.state.value))
  }

  private fun wakeScreen() {
    shellCommand("input keyevent KEYCODE_WAKEUP")
    shellCommand("wm dismiss-keyguard")
  }

  private fun shellCommand(command: String) {
    val commandFile = InstrumentationRegistry.getInstrumentation().uiAutomation
      .executeShellCommand(command)
    android.os.ParcelFileDescriptor.AutoCloseInputStream(commandFile).use { it.readBytes() }
  }

  private fun writeFixtureAudio(out: OutputStream) {
    val sampleRate = 16_000
    val size = sampleRate * 2 * 30
    fun number(value: Int, bytes: Int) { repeat(bytes) { out.write(value ushr (it * 8) and 0xff) } }
    out.write("RIFF".toByteArray()); number(size + 36, 4); out.write("WAVEfmt ".toByteArray())
    number(16, 4); number(1, 2); number(1, 2)
    number(sampleRate, 4); number(sampleRate * 2, 4); number(2, 2); number(16, 2)
    out.write("data".toByteArray()); number(size, 4); out.write(ByteArray(size))
  }
}
