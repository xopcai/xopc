package ai.xopc.mobile.ui.main

import ai.xopc.mobile.theme.themedCorners
import ai.xopc.mobile.R
import ai.xopc.mobile.gateway.GeneratedMediaAccess
import ai.xopc.mobile.playback.MusicPhase
import ai.xopc.mobile.playback.MusicPlayback
import ai.xopc.mobile.playback.MusicState
import ai.xopc.mobile.playback.MusicTrack
import ai.xopc.mobile.theme.LocalChatColors
import android.content.Context
import android.widget.Toast
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.background
import androidx.compose.foundation.border
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
import androidx.compose.ui.graphics.Brush
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
internal fun MusicPlayerSheet(track: MusicTrack, onClose: () -> Unit, onSource: () -> Unit, onDownload: () -> Unit) {
  val state by MusicPlayback.state.collectAsStateWithLifecycle()
  val current = state?.takeIf { it.track.key == track.key } ?: return
  var showLyrics by rememberSaveableLyrics(track.key)
  val lyrics = track.lyrics?.takeIf { it.isNotBlank() }
  val colors = MaterialTheme.colorScheme
  ModalBottomSheet(onDismissRequest = onClose, sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true),
    modifier = Modifier.testTag("music-full-player"), shape = themedCorners(28), containerColor = colors.background) {
    Column(Modifier.fillMaxWidth().fillMaxHeight(0.88f),
      horizontalAlignment = Alignment.CenterHorizontally) {
      Row(Modifier.widthIn(max = 480.dp).fillMaxWidth().padding(horizontal = 12.dp),
        verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.SpaceBetween) {
        IconButton(onClick = onClose, modifier = Modifier.testTag("music-minimize")) {
          Icon(painterResource(R.drawable.action_chevron_down), stringResource(R.string.music_minimize))
        }
        Text(stringResource(R.string.music_title), style = MaterialTheme.typography.titleSmall, color = colors.onSurfaceVariant)
        IconButton(onClick = { MusicPlayback.stop(); onClose() }, modifier = Modifier.testTag("music-player-close")) {
          Icon(painterResource(R.drawable.action_close), stringResource(R.string.music_stop))
        }
      }
      Row(Modifier.widthIn(max = 480.dp).fillMaxWidth().padding(horizontal = 24.dp, vertical = 4.dp),
        horizontalArrangement = Arrangement.spacedBy(12.dp), verticalAlignment = Alignment.CenterVertically) {
        MusicArt(Modifier.size(52.dp))
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(3.dp)) {
          Text(track.title, style = MaterialTheme.typography.titleMedium, maxLines = 2, overflow = TextOverflow.Ellipsis)
          Text(track.sourceTitle.ifBlank { stringResource(R.string.music_audio) }, style = MaterialTheme.typography.bodySmall,
            color = colors.onSurfaceVariant, maxLines = 1, overflow = TextOverflow.Ellipsis)
        }
        IconButton(onClick = onSource, modifier = Modifier.size(44.dp).testTag("music-return-source")) {
          Icon(painterResource(R.drawable.tab_conversations), stringResource(R.string.music_return_source),
            Modifier.size(20.dp), tint = colors.onSurfaceVariant)
        }
      }
      Box(Modifier.weight(1f).widthIn(max = 480.dp).fillMaxWidth().testTag("music-player-content")) {
        if (showLyrics && lyrics != null) {
          Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(horizontal = 24.dp, vertical = 20.dp)) {
            Text(lyrics, style = MaterialTheme.typography.titleLarge, lineHeight = 36.sp,
              modifier = Modifier.testTag("music-lyrics-text"))
          }
        } else {
          Box(Modifier.fillMaxSize().padding(horizontal = 24.dp, vertical = 8.dp), contentAlignment = Alignment.Center) {
            MusicCover(Modifier.sizeIn(maxWidth = 232.dp, maxHeight = 232.dp))
          }
        }
      }
      Column(Modifier.widthIn(max = 480.dp).fillMaxWidth().padding(start = 24.dp, end = 24.dp, bottom = 12.dp),
        horizontalAlignment = Alignment.End) {
        if (current.phase == MusicPhase.Failed) {
          Text(stringResource(R.string.music_failed), Modifier.fillMaxWidth(), style = MaterialTheme.typography.bodySmall,
            color = colors.error)
        }
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
          TextButton(onClick = onDownload, modifier = Modifier.testTag("music-download")) {
            Text(stringResource(R.string.music_download))
          }
          if (lyrics != null) {
            TextButton(onClick = { showLyrics = !showLyrics }, modifier = Modifier.testTag("music-lyrics")) {
              Text(stringResource(if (showLyrics) R.string.music_hide_lyrics else R.string.music_lyrics))
            }
          }
        }
        MusicTimeline(current)
      }
    }
  }
}

@Composable
private fun rememberSaveableLyrics(key: String) = androidx.compose.runtime.saveable.rememberSaveable(key) { mutableStateOf(true) }

@Composable
private fun MusicCover(modifier: Modifier) {
  val colors = MaterialTheme.colorScheme
  val shape = themedCorners(24)
  Box(modifier.aspectRatio(1f).clip(shape)
    .background(Brush.linearGradient(listOf(colors.secondaryContainer, LocalChatColors.current.card)))
    .border(1.dp, colors.outlineVariant, shape), contentAlignment = Alignment.Center) {
    Box(Modifier.fillMaxWidth(0.74f).aspectRatio(1f).border(1.dp, colors.outlineVariant, CircleShape))
    Box(Modifier.fillMaxWidth(0.56f).aspectRatio(1f).border(1.dp, colors.outlineVariant, CircleShape))
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
internal fun MusicToggle(state: MusicState, large: Boolean = false, tag: String = "music-toggle") {
  val context = LocalContext.current
  val playing = state.phase == MusicPhase.Playing
  val loading = state.phase == MusicPhase.Loading
  val label = stringResource(when (state.phase) {
    MusicPhase.Loading -> R.string.music_loading
    MusicPhase.Playing -> R.string.music_pause
    MusicPhase.Failed -> R.string.music_retry
    else -> R.string.music_play
  })
  FilledTonalIconButton(onClick = { MusicPlayback.toggle(context) }, enabled = !loading,
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
private fun MusicTimeline(state: MusicState) {
  val duration = state.durationMs
  val label = stringResource(R.string.music_seek)
  val canSeek = duration > 0 && state.phase != MusicPhase.Failed && state.phase != MusicPhase.Loading
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
      MusicToggle(state, large = true)
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
  val scope = rememberCoroutineScope()
  var pending by remember { mutableStateOf<MusicTrack?>(null) }
  val createDocument = rememberLauncherForActivityResult(ActivityResultContracts.CreateDocument("audio/mpeg")) { uri ->
    val track = pending
    pending = null
    if (uri != null && track != null && access != null) scope.launch {
      try {
        val temporary = withContext(Dispatchers.IO) { File.createTempFile("music-export-", ".mp3", context.cacheDir) }
        try {
          access.downloadMusic(track.gatewayId, track.conversationId, track.id, temporary)
          withContext(Dispatchers.IO) {
            requireNotNull(context.contentResolver.openOutputStream(uri, "wt")).use { target ->
              temporary.inputStream().use { it.copyTo(target) }
            }
          }
        } finally { temporary.delete() }
      } catch (e: CancellationException) { throw e }
      catch (_: Exception) { Toast.makeText(context, R.string.music_download_failed, Toast.LENGTH_SHORT).show() }
    }
  }
  return { track ->
    if (access != null && pending == null) {
      pending = track
      val name = track.title.replace(Regex("[^\\p{L}\\p{N} ._-]"), "_").trim().take(70).ifBlank { "xopc" }
      createDocument.launch("$name.mp3")
    }
  }
}
