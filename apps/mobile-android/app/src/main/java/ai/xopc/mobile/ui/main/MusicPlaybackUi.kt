package ai.xopc.mobile.ui.main

import ai.xopc.mobile.theme.themedCorners
import ai.xopc.mobile.R
import ai.xopc.mobile.gateway.GeneratedMediaAccess
import ai.xopc.mobile.playback.MusicPhase
import ai.xopc.mobile.playback.MusicRequest
import ai.xopc.mobile.playback.MusicPlayback
import ai.xopc.mobile.playback.MusicState
import ai.xopc.mobile.playback.MusicTrack
import ai.xopc.mobile.theme.LocalChatColors
import android.content.Context
import android.widget.Toast
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import java.io.File
import java.io.OutputStream
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

internal fun playGeneratedMusic(context: Context, access: GeneratedMediaAccess?, track: MusicTrack) {
  if (access != null) MusicPlayback.play(context, track) { destination ->
    access.downloadMusic(track.gatewayId, track.conversationId, track.id, destination)
  }
}

@Composable
internal fun MusicMiniPlayer(track: MusicTrack, onExpand: () -> Unit, modifier: Modifier = Modifier, sticky: Boolean = false) {
  val state by MusicPlayback.state.collectAsStateWithLifecycle()
  val current = state?.takeIf { it.track.key == track.key } ?: return
  Surface(modifier.fillMaxWidth().testTag(if (sticky) "music-sticky-player" else "music-mini-player"), shape = MaterialTheme.shapes.medium,
    color = LocalChatColors.current.card) {
    Column {
      Row(Modifier.fillMaxWidth().padding(start = 8.dp, end = 3.dp).heightIn(min = 56.dp),
        verticalAlignment = Alignment.CenterVertically) {
        val expand = stringResource(R.string.music_open_player)
        Row(Modifier.weight(1f).clip(MaterialTheme.shapes.small).clickable(onClick = onExpand)
          .semantics { contentDescription = expand }.testTag("music-expand"), verticalAlignment = Alignment.CenterVertically,
          horizontalArrangement = Arrangement.spacedBy(9.dp)) {
          MusicArt(Modifier.size(36.dp))
          Column(Modifier.weight(1f)) {
            Text(track.title, style = MaterialTheme.typography.titleSmall, maxLines = 1, overflow = TextOverflow.Ellipsis)
            Text(musicStatus(current), style = MaterialTheme.typography.labelSmall,
              color = MaterialTheme.colorScheme.onSurfaceVariant, maxLines = 1, overflow = TextOverflow.Ellipsis)
          }
        }
        MusicToggle(current)
        IconButton(onClick = MusicPlayback::stop, modifier = Modifier.size(44.dp).testTag("music-stop")) {
          Icon(painterResource(R.drawable.action_close), stringResource(R.string.music_stop), Modifier.size(19.dp))
        }
      }
      Box(Modifier.fillMaxWidth().height(2.dp)) {
        val fraction = if (current.durationMs > 0) (current.positionMs.toFloat() / current.durationMs).coerceIn(0f, 1f) else 0f
        Spacer(Modifier.fillMaxWidth(fraction).fillMaxHeight().background(LocalChatColors.current.action))
      }
    }
  }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
internal fun MobilePreviewSheet(onClose: () -> Unit, modifier: Modifier = Modifier, content: @Composable ColumnScope.() -> Unit) {
  ModalBottomSheet(onDismissRequest = onClose, sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true),
    modifier = modifier, shape = themedCorners(28), containerColor = MaterialTheme.colorScheme.background) {
    Column(Modifier.fillMaxWidth().fillMaxHeight(0.88f), content = content)
  }
}

@Composable
internal fun rememberPreviewExport(mimeType: String): (String, suspend (OutputStream) -> Unit) -> Unit {
  val context = LocalContext.current
  val scope = rememberCoroutineScope()
  var pending by remember { mutableStateOf<(suspend (OutputStream) -> Unit)?>(null) }
  val picker = rememberLauncherForActivityResult(ActivityResultContracts.CreateDocument(mimeType)) { uri ->
    val write = pending
    pending = null
    if (uri != null && write != null) scope.launch {
      try {
        withContext(Dispatchers.IO) {
          requireNotNull(context.contentResolver.openOutputStream(uri, "wt")).use { write(it) }
        }
      } catch (cancelled: CancellationException) {
        throw cancelled
      } catch (_: Exception) {
        Toast.makeText(context, R.string.preview_download_failed, Toast.LENGTH_SHORT).show()
      }
    }
  }
  return { name, write ->
    if (pending == null) {
      pending = write
      picker.launch(name)
    }
  }
}

@Composable
internal fun PreviewHeader(title: String, onClose: () -> Unit, closeTag: String = "preview-close",
  actions: (@Composable ColumnScope.(() -> Unit) -> Unit)? = null) {
  var menu by remember { mutableStateOf(false) }
  Row(Modifier.fillMaxWidth().padding(horizontal = 12.dp), verticalAlignment = Alignment.CenterVertically) {
    IconButton(onClick = onClose, modifier = Modifier.testTag(closeTag)) {
      Icon(painterResource(R.drawable.action_close), stringResource(R.string.assistant_close))
    }
    Text(title, Modifier.weight(1f), style = MaterialTheme.typography.titleMedium,
      maxLines = 1, overflow = TextOverflow.Ellipsis, textAlign = androidx.compose.ui.text.style.TextAlign.Center)
    if (actions != null) {
      Box {
        IconButton(onClick = { menu = true }) {
          Icon(painterResource(R.drawable.action_more_horizontal), stringResource(R.string.conversations_more_actions))
        }
        DropdownMenu(menu, { menu = false }) { actions { menu = false } }
      }
    } else {
      Spacer(Modifier.width(48.dp))
    }
  }
}

@Composable
internal fun MusicPlayerSheet(track: MusicTrack, onClose: () -> Unit, onSource: (() -> Unit)?,
  onDownload: () -> Unit, onPlay: (() -> Unit)? = null) {
  val state by MusicPlayback.state.collectAsStateWithLifecycle()
  MobilePreviewSheet(onClose, Modifier.testTag("music-full-player")) {
    PreviewHeader(track.title, onClose, "music-player-close") { dismiss ->
      DropdownMenuItem(text = { Text(stringResource(R.string.music_download)) },
        modifier = Modifier.testTag("music-download"), onClick = { dismiss(); onDownload() })
      if (onSource != null) {
        DropdownMenuItem(text = { Text(stringResource(R.string.music_return_source)) },
          modifier = Modifier.testTag("music-return-source"), onClick = { dismiss(); onSource() })
      }
      if (state?.track?.key == track.key) {
        DropdownMenuItem(text = { Text(stringResource(R.string.music_stop), color = MaterialTheme.colorScheme.error) },
          onClick = { dismiss(); MusicPlayback.stop(); onClose() })
      }
    }
    MusicPreviewContent(track, Modifier.weight(1f), onPlay)
  }
}

private data class TimedLyric(val atMs: Int, val text: String)
private val lyricTimestamp = Regex("""^\[(\d+):(\d{2})(?:[.](\d{1,3}))?](.*)$""")

private fun timedLyrics(lyrics: String): List<TimedLyric> = lyrics.lines().map(String::trim)
  .filter(String::isNotEmpty).map { line ->
    val match = lyricTimestamp.matchEntire(line) ?: return emptyList()
    val (minutes, seconds, fraction, text) = match.destructured
    val elapsed = (minutes.toLongOrNull()?.takeIf { it <= Int.MAX_VALUE / 60_000L } ?: return emptyList()) * 60_000 +
      (seconds.toInt().takeIf { it < 60 } ?: return emptyList()) * 1000 + fraction.padEnd(3, '0').toInt()
    TimedLyric(elapsed.coerceAtMost(Int.MAX_VALUE.toLong()).toInt(), text.trim())
  }.sortedBy(TimedLyric::atMs).toList()

@Composable
internal fun MusicPreviewContent(track: MusicTrack, modifier: Modifier = Modifier, onPlay: (() -> Unit)? = null) {
  val state by MusicPlayback.state.collectAsStateWithLifecycle()
  val playingTrack = state?.takeIf { it.track.key == track.key }
  val current = playingTrack ?: MusicState(track, MusicPhase.Paused)
  var showLyrics by androidx.compose.runtime.saveable.rememberSaveable(track.key) { mutableStateOf(false) }
  val lyrics = track.lyrics?.takeIf { it.isNotBlank() }
  val colors = MaterialTheme.colorScheme
  Column(modifier.fillMaxWidth(), horizontalAlignment = Alignment.CenterHorizontally) {
    Box(Modifier.weight(1f).widthIn(max = 480.dp).fillMaxWidth().testTag("music-player-content")) {
      if (showLyrics && lyrics != null) {
        val lines = remember(lyrics) { timedLyrics(lyrics) }
        Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(24.dp).testTag("music-lyrics-text"),
          verticalArrangement = Arrangement.spacedBy(12.dp)) {
          if (lines.isEmpty()) {
            androidx.compose.foundation.text.selection.SelectionContainer {
              Text(lyrics, style = MaterialTheme.typography.titleLarge, lineHeight = 36.sp)
            }
          } else {
            val active = if (playingTrack == null) -1 else lines.indexOfLast { it.atMs <= current.positionMs }
            lines.forEachIndexed { index, line ->
              Text(line.text, Modifier.fillMaxWidth().clickable(enabled = playingTrack != null &&
                current.durationMs > 0 && current.phase != MusicPhase.Loading && current.phase != MusicPhase.Failed) {
                MusicPlayback.seek(line.atMs)
              }.padding(vertical = 8.dp), style = MaterialTheme.typography.titleLarge,
                color = if (index == active) LocalChatColors.current.action else colors.onSurface)
            }
          }
        }
      } else {
        Box(Modifier.fillMaxSize().padding(horizontal = 24.dp, vertical = 8.dp), contentAlignment = Alignment.Center) {
          MusicCover(Modifier.sizeIn(maxWidth = 232.dp, maxHeight = 232.dp))
        }
      }
    }
    Column(Modifier.widthIn(max = 480.dp).fillMaxWidth().padding(start = 24.dp, end = 24.dp, bottom = 12.dp),
      horizontalAlignment = Alignment.CenterHorizontally) {
      if (current.phase == MusicPhase.Failed) {
        Text(stringResource(R.string.music_failed), Modifier.fillMaxWidth(), style = MaterialTheme.typography.bodySmall, color = colors.error)
      }
      if (lyrics != null) {
        TextButton(onClick = { showLyrics = !showLyrics }, modifier = Modifier.testTag("music-lyrics")) {
          Text(stringResource(if (showLyrics) R.string.music_hide_lyrics else R.string.music_lyrics))
        }
      }
      MusicTimeline(current, playingTrack != null, onPlay)
    }
  }
}

@Composable
private fun MusicCover(modifier: Modifier) {
  val colors = MaterialTheme.colorScheme
  val shape = themedCorners(24)
  Box(modifier.aspectRatio(1f).clip(shape)
    .background(LocalChatColors.current.card),
    contentAlignment = Alignment.Center) {
    Box(Modifier.fillMaxWidth(0.74f).aspectRatio(1f).background(colors.surfaceContainer.copy(alpha = 0.5f), CircleShape))
    Box(Modifier.fillMaxWidth(0.56f).aspectRatio(1f).background(LocalChatColors.current.user, CircleShape))
    Box(Modifier.fillMaxWidth(0.39f).aspectRatio(1f).background(colors.background, CircleShape))
    Text("♫", style = MaterialTheme.typography.displayMedium, color = LocalChatColors.current.action,
      modifier = Modifier.clearAndSetSemantics { })
  }
}

@Composable
private fun MusicArt(modifier: Modifier) {
  Surface(modifier, shape = themedCorners(12), color = MaterialTheme.colorScheme.secondaryContainer) {
    Box(contentAlignment = Alignment.Center) {
      Text("♫", style = MaterialTheme.typography.headlineMedium, color = MaterialTheme.colorScheme.onSecondaryContainer)
    }
  }
}

@Composable
internal fun MusicToggle(state: MusicState, large: Boolean = false, tag: String = "music-toggle", action: (() -> Unit)? = null) {
  val context = LocalContext.current
  val playing = state.phase == MusicPhase.Playing
  val loading = state.phase == MusicPhase.Loading
  val label = stringResource(when (state.phase) {
    MusicPhase.Loading -> R.string.music_loading
    MusicPhase.Playing -> R.string.music_pause
    MusicPhase.Failed -> R.string.music_retry
    else -> R.string.music_play
  })
  FilledTonalIconButton(onClick = action ?: { MusicPlayback.toggle(context) }, enabled = !loading,
    modifier = Modifier.size(if (large) 64.dp else 44.dp).testTag(tag),
    colors = if (large) IconButtonDefaults.filledTonalIconButtonColors(
      containerColor = LocalChatColors.current.action, contentColor = LocalChatColors.current.onAction,
      disabledContainerColor = LocalChatColors.current.action.copy(alpha = 0.2f),
    ) else IconButtonDefaults.filledTonalIconButtonColors()) {
    if (loading) CircularProgressIndicator(Modifier.size(19.dp).semantics { contentDescription = label }, strokeWidth = 2.dp)
    else Icon(painterResource(when {
      playing -> android.R.drawable.ic_media_pause
      state.phase == MusicPhase.Failed -> android.R.drawable.ic_popup_sync
      else -> android.R.drawable.ic_media_play
    }), label, Modifier.size(if (large) 28.dp else 22.dp))
  }
}

@Composable
private fun MusicTimeline(state: MusicState, current: Boolean, onPlay: (() -> Unit)?) {
  val duration = state.durationMs
  val label = stringResource(R.string.music_seek)
  val canSeek = current && duration > 0 && state.phase != MusicPhase.Failed && state.phase != MusicPhase.Loading
  val chat = LocalChatColors.current
  val colors = MaterialTheme.colorScheme
  var dragging by remember(state.track.key) { mutableStateOf<Float?>(null) }
  val position = (dragging ?: state.positionMs.toFloat()).coerceIn(0f, duration.coerceAtLeast(1).toFloat())
  Column(Modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(4.dp)) {
    Slider(value = position, onValueChange = { dragging = it },
      onValueChangeFinished = { dragging?.toInt()?.let(MusicPlayback::seek); dragging = null },
      valueRange = 0f..duration.coerceAtLeast(1).toFloat(),
      enabled = canSeek,
      colors = SliderDefaults.colors(thumbColor = chat.action, activeTrackColor = chat.action, inactiveTrackColor = colors.outlineVariant),
      modifier = Modifier.semantics { contentDescription = label }.testTag("music-seek"))
    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
      Text(playbackTime(position.toInt()), style = MaterialTheme.typography.labelSmall, color = colors.onSurfaceVariant)
      Text(if (duration > 0) playbackTime(duration) else "–:–", style = MaterialTheme.typography.labelSmall, color = colors.onSurfaceVariant)
    }
    Row(Modifier.fillMaxWidth().padding(top = 8.dp), horizontalArrangement = Arrangement.spacedBy(32.dp, Alignment.CenterHorizontally),
      verticalAlignment = Alignment.CenterVertically) {
      MusicSkipButton(backward = true, enabled = canSeek) { MusicPlayback.seek((state.positionMs - 15_000).coerceAtLeast(0)) }
      if (current || onPlay != null) MusicToggle(state, large = true, action = onPlay.takeUnless { current })
      MusicSkipButton(backward = false, enabled = canSeek) { MusicPlayback.seek((state.positionMs + 15_000).coerceAtMost(duration)) }
    }
  }
}

@Composable
private fun MusicSkipButton(backward: Boolean, enabled: Boolean, onClick: () -> Unit) {
  val label = stringResource(if (backward) R.string.music_skip_back else R.string.music_skip_forward)
  FilledTonalIconButton(onClick = onClick, enabled = enabled,
    modifier = Modifier.size(48.dp).semantics { contentDescription = label }
      .testTag(if (backward) "music-skip-back" else "music-skip-forward")) {
    Text(if (backward) "−15" else "+15", style = MaterialTheme.typography.labelLarge, modifier = Modifier.clearAndSetSemantics { })
  }
}

@Composable
private fun musicStatus(state: MusicState) = stringResource(when (state.phase) {
  MusicPhase.Loading -> R.string.music_loading
  MusicPhase.Playing -> R.string.music_title
  MusicPhase.Paused -> R.string.music_paused
  MusicPhase.Ended -> R.string.music_ended
  MusicPhase.Failed -> R.string.music_failed
})

private fun playbackTime(milliseconds: Int): String {
  val seconds = milliseconds.coerceAtLeast(0) / 1000
  return "${seconds / 60}:${(seconds % 60).toString().padStart(2, '0')}"
}

@Composable
internal fun rememberMusicDownload(access: GeneratedMediaAccess?): (MusicTrack) -> Unit {
  val context = LocalContext.current
  val export = rememberPreviewExport("audio/*")
  return download@{ track ->
    val request = MusicPlayback.request?.takeIf { it.track.key == track.key } ?: access?.let {
      MusicRequest(track) { destination -> it.downloadMusic(track.gatewayId, track.conversationId, track.id, destination) }
    } ?: return@download
    val name = track.title.replace(Regex("[^\\p{L}\\p{N} ._-]"), "_").trim().take(70).ifBlank { "xopc" }
    export(track.fileName ?: "$name.mp3") { target ->
      val temporary = File.createTempFile("music-export-", ".audio", context.cacheDir)
      try {
        request.download(temporary)
        temporary.inputStream().use { it.copyTo(target) }
      } finally { temporary.delete() }
    }
  }
}
