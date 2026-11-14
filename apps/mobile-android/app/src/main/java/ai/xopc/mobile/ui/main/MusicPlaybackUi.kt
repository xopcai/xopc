package ai.xopc.mobile.ui.main

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
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
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
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
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
internal fun MusicMiniPlayer(track: MusicTrack, onExpand: () -> Unit, modifier: Modifier = Modifier) {
  val state by MusicPlayback.state.collectAsStateWithLifecycle()
  val current = state?.takeIf { it.track.key == track.key } ?: return
  Surface(modifier.fillMaxWidth().testTag("music-mini-player"), shape = RoundedCornerShape(16.dp),
    color = LocalChatColors.current.card) {
    Column {
      Row(Modifier.fillMaxWidth().padding(start = 8.dp, end = 3.dp).heightIn(min = 56.dp),
        verticalAlignment = Alignment.CenterVertically) {
        val expand = stringResource(R.string.music_open_player)
        Row(Modifier.weight(1f).clip(RoundedCornerShape(13.dp)).clickable(onClick = onExpand)
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

@Composable
internal fun MusicInlineControls(track: MusicTrack, onExpand: () -> Unit, onDownload: () -> Unit) {
  val state by MusicPlayback.state.collectAsStateWithLifecycle()
  val current = state?.takeIf { it.track.key == track.key } ?: return
  var showLyrics by rememberSaveableLyrics(track.key)
  Column(Modifier.fillMaxWidth().testTag("music-inline-player"), verticalArrangement = Arrangement.spacedBy(4.dp)) {
    MusicTimeline(current)
    if (current.phase == MusicPhase.Failed) Text(stringResource(R.string.music_failed), color = MaterialTheme.colorScheme.error)
    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
      TextButton(onClick = onExpand, modifier = Modifier.testTag("music-inline-expand")) {
        Text(stringResource(R.string.music_open_player))
      }
      TextButton(onClick = onDownload) { Text(stringResource(R.string.music_download)) }
      if (!track.lyrics.isNullOrBlank()) TextButton(onClick = { showLyrics = !showLyrics }) {
        Text(stringResource(if (showLyrics) R.string.music_hide_lyrics else R.string.music_lyrics))
      }
    }
    if (showLyrics) track.lyrics?.let {
      Text(it, style = MaterialTheme.typography.bodyMedium,
        modifier = Modifier.heightIn(max = 180.dp).verticalScroll(rememberScrollState()))
    }
  }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
internal fun MusicPlayerSheet(track: MusicTrack, onClose: () -> Unit, onSource: () -> Unit, onDownload: () -> Unit) {
  val state by MusicPlayback.state.collectAsStateWithLifecycle()
  val current = state?.takeIf { it.track.key == track.key } ?: return
  var showLyrics by rememberSaveableLyrics(track.key)
  ModalBottomSheet(onDismissRequest = onClose, sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true),
    modifier = Modifier.testTag("music-full-player"), dragHandle = null) {
    Column(Modifier.fillMaxWidth().heightIn(max = 680.dp).verticalScroll(rememberScrollState())
      .padding(start = 20.dp, end = 20.dp, bottom = 20.dp), verticalArrangement = Arrangement.spacedBy(14.dp)) {
      Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.SpaceBetween) {
        IconButton(onClick = onClose, modifier = Modifier.testTag("music-minimize")) {
          Icon(painterResource(R.drawable.action_chevron_down), stringResource(R.string.music_minimize))
        }
        Text(stringResource(R.string.music_title), style = MaterialTheme.typography.titleMedium)
        IconButton(onClick = { MusicPlayback.stop(); onClose() }, modifier = Modifier.testTag("music-player-close")) {
          Icon(painterResource(R.drawable.action_close), stringResource(R.string.music_stop))
        }
      }
      MusicArt(Modifier.align(Alignment.CenterHorizontally).size(184.dp))
      Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
        Text(track.title, style = MaterialTheme.typography.headlineMedium, maxLines = 2, overflow = TextOverflow.Ellipsis)
        Text(musicStatus(current), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
      }
      MusicTimeline(current)
      Box(Modifier.fillMaxWidth(), contentAlignment = Alignment.Center) { MusicToggle(current, large = true) }
      OutlinedButton(onClick = onSource, modifier = Modifier.fillMaxWidth().testTag("music-return-source")) {
        Text(if (track.sourceTitle.isBlank()) stringResource(R.string.music_return_source)
          else "${stringResource(R.string.music_return_source)} · ${track.sourceTitle}")
      }
      TextButton(onClick = onDownload, modifier = Modifier.testTag("music-download")) {
        Text(stringResource(R.string.music_download))
      }
      if (!track.lyrics.isNullOrBlank()) {
        TextButton(onClick = { showLyrics = !showLyrics }, modifier = Modifier.testTag("music-lyrics")) {
          Text(stringResource(if (showLyrics) R.string.music_hide_lyrics else R.string.music_lyrics))
        }
        if (showLyrics) Text(track.lyrics, style = MaterialTheme.typography.bodyMedium)
      }
    }
  }
}

@Composable
private fun rememberSaveableLyrics(key: String) = androidx.compose.runtime.saveable.rememberSaveable(key) { mutableStateOf(false) }

@Composable
private fun MusicArt(modifier: Modifier) {
  Surface(modifier, shape = RoundedCornerShape(12.dp), color = MaterialTheme.colorScheme.secondaryContainer) {
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
    modifier = Modifier.size(if (large) 60.dp else 44.dp).testTag(tag)) {
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
  var dragging by remember(state.track.key) { mutableStateOf<Float?>(null) }
  val position = (dragging ?: state.positionMs.toFloat()).coerceIn(0f, duration.coerceAtLeast(1).toFloat())
  Column(Modifier.fillMaxWidth()) {
    Slider(value = position, onValueChange = { dragging = it },
      onValueChangeFinished = { dragging?.toInt()?.let(MusicPlayback::seek); dragging = null },
      valueRange = 0f..duration.coerceAtLeast(1).toFloat(),
      enabled = duration > 0 && state.phase !in setOf(MusicPhase.Failed, MusicPhase.Loading),
      modifier = Modifier.semantics { contentDescription = label }.testTag("music-seek"))
    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
      Text(playbackTime(position.toInt()), style = MaterialTheme.typography.labelSmall)
      Text(playbackTime(duration), style = MaterialTheme.typography.labelSmall)
    }
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
