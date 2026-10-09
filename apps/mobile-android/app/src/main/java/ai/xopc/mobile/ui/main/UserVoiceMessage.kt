package ai.xopc.mobile.ui.main

import ai.xopc.mobile.R
import ai.xopc.mobile.gateway.ConversationMedia
import android.media.MediaPlayer
import android.widget.Toast
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.combinedClickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.produceState
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import java.io.File
import kotlin.math.ceil
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.NonCancellable
import kotlinx.coroutines.awaitCancellation
import kotlinx.coroutines.withContext

private data class VoicePlayback(val player: MediaPlayer, val file: File)

/** Compact in-bubble playback matching the HarmonyOS user voice message. */
@OptIn(androidx.compose.foundation.ExperimentalFoundationApi::class)
@Composable
internal fun UserVoiceMessage(media: ConversationMedia,
  load: (suspend (ConversationMedia) -> ByteArray)?, onLongPress: () -> Unit, modifier: Modifier = Modifier) {
  val context = LocalContext.current
  var requestCount by remember(media) { mutableStateOf(0) }
  var playing by remember(media) { mutableStateOf(false) }
  var completed by remember(media) { mutableStateOf(false) }
  var playbackFailed by remember(media) { mutableStateOf(false) }
  val unavailable = stringResource(R.string.message_preview_unavailable)
  val resource by produceState<Result<VoicePlayback>?>(null, media, requestCount) {
    if (requestCount == 0) return@produceState
    value = null
    val payload = try {
      requireNotNull(load) { "MEDIA_UNAVAILABLE" }.invoke(media)
    } catch (error: CancellationException) {
      throw error
    } catch (error: Exception) {
      value = Result.failure(error)
      Toast.makeText(context, unavailable, Toast.LENGTH_SHORT).show()
      return@produceState
    }
    // Keep ownership through cancellation so an off-thread prepare cannot leak resources.
    val prepared = withContext(NonCancellable + Dispatchers.IO) {
      var file: File? = null
      var player: MediaPlayer? = null
      runCatching {
        val directory = File(context.cacheDir, "message-media").apply { mkdirs() }
        val voiceFile = File.createTempFile("voice-", ".audio", directory)
        file = voiceFile
        voiceFile.writeBytes(payload)
        val voicePlayer = MediaPlayer()
        player = voicePlayer
        voicePlayer.setDataSource(voiceFile.absolutePath)
        voicePlayer.prepare()
        VoicePlayback(voicePlayer, voiceFile)
      }.onFailure {
        runCatching { player?.release() }
        file?.delete()
      }
    }
    try {
      val started = prepared.mapCatching { playback ->
        playback.player.apply {
          setOnCompletionListener { playing = false; completed = true }
          setOnErrorListener { _, _, _ ->
            playing = false
            playbackFailed = true
            Toast.makeText(context, unavailable, Toast.LENGTH_SHORT).show()
            true
          }
          start()
          playing = true
        }
        playback
      }
      value = started
      if (started.isFailure) Toast.makeText(context, unavailable, Toast.LENGTH_SHORT).show()
      awaitCancellation()
    } finally {
      prepared.getOrNull()?.let {
        runCatching { it.player.release() }
        it.file.delete()
      }
    }
  }
  val ready = resource?.getOrNull()
  val busy = requestCount > 0 && resource == null
  val failed = playbackFailed || resource?.isFailure == true
  val foreground = if (failed) MaterialTheme.colorScheme.error else MaterialTheme.colorScheme.onSurface
  val secondary = MaterialTheme.colorScheme.onSurfaceVariant
  val duration = ready?.let { runCatching { it.player.duration / 1000.0 }.getOrNull() }
    ?: media.durationSeconds ?: 0.0
  Row(modifier = modifier.height(48.dp).testTag("message-audio-${media.id}")
    .combinedClickable(onLongClick = onLongPress,
      onClickLabel = stringResource(if (playing) R.string.message_audio_pause else R.string.message_audio_play), onClick = {
      if (busy || load == null) return@combinedClickable
      if (failed) {
        requestCount++
        playbackFailed = false
      } else if (ready == null) requestCount++
      else runCatching {
        if (playing) ready.player.pause()
        else {
          if (completed) { ready.player.seekTo(0); completed = false }
          ready.player.start()
        }
        playing = !playing
      }.onFailure { playbackFailed = true; playing = false }
    }).padding(horizontal = 10.dp),
    horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
    if (busy) BrandLoadingIndicator(modifier = Modifier.size(20.dp))
    else if (playing) Canvas(Modifier.size(24.dp).testTag("message-audio-playing-${media.id}")) {
      drawCircle(foreground)
      val side = 8.dp.toPx()
      drawRect(secondary, topLeft = Offset((size.width - side) / 2, (size.height - side) / 2),
        size = Size(side, side))
    } else Icon(painterResource(R.drawable.action_speaker), contentDescription = null,
      tint = foreground, modifier = Modifier.size(24.dp))
    Canvas(Modifier.weight(1f).height(30.dp)) {
      val heights = listOf(8, 18, 28, 16, 24, 10, 18)
      heights.forEachIndexed { index, height ->
        val x = size.width / 2 + (index - 3) * 4.dp.toPx()
        val half = height.dp.toPx() / 2
        drawLine(secondary, Offset(x, size.height / 2 - half), Offset(x, size.height / 2 + half),
          strokeWidth = 2.dp.toPx(), cap = StrokeCap.Round)
      }
    }
    if (duration > 0) Text("${ceil(duration).toInt().coerceAtLeast(1)}″", fontSize = 13.sp,
      color = secondary, modifier = Modifier.testTag("message-audio-duration-${media.id}"))
  }
}
