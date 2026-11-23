package ai.xopc.mobile.ui.main

import ai.xopc.mobile.gateway.GeneratedMediaKind
import ai.xopc.mobile.gateway.GeneratedMediaItem
import ai.xopc.mobile.gateway.parseGeneratedMedia
import androidx.activity.ComponentActivity
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.mutableStateOf
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test

class GeneratedMediaCardTest {
  @get:Rule val compose = createAndroidComposeRule<ComponentActivity>()

  @Test fun aNewQueuedSongAppearsOnTheLeftOfTheExistingTimeline() {
    val items = mutableStateOf<List<GeneratedMediaItem>>(emptyList())
    compose.setContent {
      MaterialTheme {
        Column(Modifier.fillMaxWidth().testTag("timeline")) {
          GeneratedMediaRows(items.value, false, null, {}, {})
        }
      }
    }
    val card = compose.onNodeWithTag("generated-media-card-song")
    card.assertDoesNotExist()
    compose.runOnIdle {
      items.value = parseGeneratedMedia(JSONObject("""{"jobs":[{"id":"song","title":"新歌",
        "state":"queued","createdAt":1}]}"""), GeneratedMediaKind.Music)
    }
    val timeline = compose.onNodeWithTag("timeline").fetchSemanticsNode().boundsInRoot
    assertEquals(timeline.left, card.fetchSemanticsNode().boundsInRoot.left, 1f)
    compose.onNodeWithText("新歌").assertExists()
  }

  @Test fun completedVideoOpensFromTheCardAndDraftStillRequiresConfirmation() {
    val song = parseGeneratedMedia(JSONObject("""{"jobs":[{"id":"song","title":"风从山南来",
      "state":"completed","durationMs":329000,"createdAt":1}]}"""), GeneratedMediaKind.Music).single()
    val video = parseGeneratedMedia(JSONObject("""{"jobs":[],"transcriptId":"t","configured":true,"modelRef":"model",
      "draft":{"id":"video","summary":"山南落日","modelRef":"model","revision":2,"estimatedCostFen":150,
      "createdAt":2}}"""), GeneratedMediaKind.Video).single()
    val completedVideo = parseGeneratedMedia(JSONObject("""{"transcriptId":"t","jobs":[{"id":"completed-video",
      "transcriptId":"t","title":"暮色","prompt":"A private creative prompt","duration":5,
      "resolution":"720P","ratio":"16:9","state":"completed","createdAt":3}]}"""),
      GeneratedMediaKind.Video).single()
    val actions = mutableListOf<String>()
    compose.setContent {
      MaterialTheme {
        Column(Modifier.fillMaxWidth().testTag("timeline")) {
          GeneratedMediaRows(listOf(song, video, completedVideo), false, null, { actions += "play:${it.id}" },
            { actions += "confirm:${it.id}:${it.draftRevision}" }, onOpen = { actions += "open:${it.id}" })
        }
      }
    }
    val timeline = compose.onNodeWithTag("timeline").fetchSemanticsNode().boundsInRoot
    assertEquals(timeline.left, compose.onNodeWithTag("generated-media-card-video").fetchSemanticsNode().boundsInRoot.left, 1f)
    assertEquals(timeline.left, compose.onNodeWithTag("generated-media-card-completed-video").fetchSemanticsNode().boundsInRoot.left, 1f)
    compose.onNodeWithText("风从山南来").assertExists()
    compose.onNodeWithText("5:29", substring = true).assertExists()
    compose.onNodeWithText("山南落日").assertExists()
    compose.onNodeWithTag("generated-media-play-song").performClick()
    compose.onNodeWithTag("generated-video-open-completed-video").performClick()
    compose.onNodeWithText("创作详情").assertDoesNotExist()
    compose.onNodeWithText("Details").assertDoesNotExist()
    compose.onNodeWithText("A private creative prompt").assertDoesNotExist()
    compose.onNodeWithText("720P", substring = true).assertDoesNotExist()
    compose.onNodeWithText("16:9", substring = true).assertDoesNotExist()
    compose.onNodeWithTag("generated-video-confirm-video").performClick()
    compose.runOnIdle { assertEquals(listOf("play:song", "open:completed-video", "confirm:video:2"), actions) }
  }
}
