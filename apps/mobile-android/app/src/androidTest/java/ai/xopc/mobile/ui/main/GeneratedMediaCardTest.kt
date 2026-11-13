package ai.xopc.mobile.ui.main

import ai.xopc.mobile.gateway.GeneratedMediaKind
import ai.xopc.mobile.gateway.parseGeneratedMedia
import androidx.activity.ComponentActivity
import androidx.compose.foundation.layout.Column
import androidx.compose.material3.MaterialTheme
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

  @Test fun completedSongAndVideoDraftExposeTheirOwnActions() {
    val song = parseGeneratedMedia(JSONObject("""{"jobs":[{"id":"song","title":"风从山南来",
      "state":"completed","durationMs":329000,"createdAt":1}]}"""), GeneratedMediaKind.Music).single()
    val video = parseGeneratedMedia(JSONObject("""{"jobs":[],"transcriptId":"t","configured":true,"modelRef":"model",
      "draft":{"id":"video","summary":"山南落日","modelRef":"model","revision":2,"estimatedCostFen":150,
      "createdAt":2}}"""), GeneratedMediaKind.Video).single()
    val actions = mutableListOf<String>()
    compose.setContent {
      MaterialTheme {
        Column {
          GeneratedMediaRows(listOf(song, video), false, null, { actions += "play:${it.id}" },
            { actions += "confirm:${it.id}:${it.draftRevision}" })
        }
      }
    }
    compose.onNodeWithText("风从山南来").assertExists()
    compose.onNodeWithText("山南落日").assertExists()
    compose.onNodeWithTag("generated-media-play-song").performClick()
    compose.onNodeWithTag("generated-video-confirm-video").performClick()
    compose.runOnIdle { assertEquals(listOf("play:song", "confirm:video:2"), actions) }
  }
}
