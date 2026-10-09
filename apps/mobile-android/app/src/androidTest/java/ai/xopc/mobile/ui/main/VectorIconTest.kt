package ai.xopc.mobile.ui.main

import ai.xopc.mobile.R
import ai.xopc.mobile.theme.XopcTheme
import android.content.ContentValues
import android.graphics.Bitmap
import android.provider.MediaStore
import androidx.activity.ComponentActivity
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.graphics.asAndroidBitmap
import androidx.compose.ui.graphics.toPixelMap
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import kotlin.math.abs

class VectorIconTest {
  @get:Rule val rule = createAndroidComposeRule<ComponentActivity>()
  private val icons = listOf(
    "search" to R.drawable.action_search, "photo" to R.drawable.action_photo,
    "camera" to R.drawable.action_camera, "folder" to R.drawable.action_folder,
    "filter" to R.drawable.action_filter, "microphone" to R.drawable.action_microphone,
    "speaker" to R.drawable.action_speaker, "waveform" to R.drawable.action_waveform,
    "add" to R.drawable.action_add, "new_chat" to R.drawable.action_new_chat,
    "more" to R.drawable.action_more_horizontal, "clock" to R.drawable.action_clock,
    "right" to R.drawable.action_chevron_right, "left" to R.drawable.action_chevron_left,
    "down" to R.drawable.action_chevron_down, "jump" to R.drawable.action_arrow_down,
    "chats" to R.drawable.tab_conversations, "progress" to R.drawable.tab_progress,
    "notes" to R.drawable.tab_notes, "me" to R.drawable.tab_me,
    "settings" to R.drawable.settings_gear, "bookmark" to R.drawable.message_bookmark)

  @Test fun lightIconsKeepCompleteContoursAndTransparentCenters() = checkIcons(false)
  @Test fun darkIconsKeepCompleteContoursAndTransparentCenters() = checkIcons(true)

  private fun checkIcons(dark: Boolean) {
    val background = if (dark) Color(0xFF162635) else Color.White
    val foreground = if (dark) Color.White else Color(0xFF162635)
    rule.setContent {
      XopcTheme(darkTheme = dark) {
        Column(Modifier.background(background).padding(12.dp).testTag("icon-atlas"),
          verticalArrangement = Arrangement.spacedBy(8.dp)) {
          icons.chunked(4).forEach { row ->
            Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
              row.forEach { (name, resource) ->
                Column(Modifier.width(64.dp)) {
                  Box(Modifier.size(48.dp).background(background).testTag("icon-$name")) {
                    ActionIcon(resource, color = foreground, size = 48.dp)
                  }
                  Text(name, fontSize = 10.sp, color = foreground)
                }
              }
            }
          }
        }
      }
    }
    fun bitmap(name: String) = rule.onNodeWithTag("icon-$name").captureToImage()
    fun inkAt(image: ImageBitmap, x: Float, y: Float): Boolean {
      val pixel = image.toPixelMap()[(image.width * x / 24).toInt(), (image.height * y / 24).toInt()]
      return abs(pixel.red - background.red) + abs(pixel.green - background.green) + abs(pixel.blue - background.blue) > 0.8f
    }
    icons.forEach { (name, _) ->
      val pixels = bitmap(name).toPixelMap()
      val ink = (0 until pixels.height).sumOf { y -> (0 until pixels.width).count { x ->
        val pixel = pixels[x, y]
        abs(pixel.red - background.red) + abs(pixel.green - background.green) + abs(pixel.blue - background.blue) > 0.8f
      } }
      assertTrue("$name must render visible strokes", ink > pixels.width)
    }
    val search = bitmap("search")
    assertTrue("Search center must be hollow", !inkAt(search, 10.5f, 10.5f))
    listOf(4f to 10.5f, 17f to 10.5f, 10.5f to 4f, 10.5f to 17f, 19f to 19f).forEach { (x, y) ->
      assertTrue("Search contour missing at $x,$y", inkAt(search, x, y))
    }
    assertTrue("Photo dot must be visible", inkAt(bitmap("photo"), 16.5f, 8.5f))
    assertTrue("Profile head must be hollow", !inkAt(bitmap("me"), 12f, 7.5f))
    assertTrue("Settings center must be hollow", !inkAt(bitmap("settings"), 12f, 12f))
    val image = rule.onNodeWithTag("icon-atlas").captureToImage().asAndroidBitmap()
    val resolver = rule.activity.contentResolver
    val uri = requireNotNull(resolver.insert(MediaStore.Images.Media.EXTERNAL_CONTENT_URI, ContentValues().apply {
      put(MediaStore.MediaColumns.DISPLAY_NAME, "xopc-icon-audit-${if (dark) "dark" else "light"}.png")
      put(MediaStore.MediaColumns.MIME_TYPE, "image/png")
      put(MediaStore.MediaColumns.RELATIVE_PATH, "Pictures/XopcIconAudit")
      put(MediaStore.MediaColumns.IS_PENDING, 1)
    }))
    resolver.openOutputStream(uri)!!.use { image.compress(Bitmap.CompressFormat.PNG, 100, it) }
    resolver.update(uri, ContentValues().apply { put(MediaStore.MediaColumns.IS_PENDING, 0) }, null, null)
  }
}
