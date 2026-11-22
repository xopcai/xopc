package ai.xopc.mobile.ui.main

import ai.xopc.mobile.R
import ai.xopc.mobile.gateway.PendingVoiceNote
import ai.xopc.mobile.gateway.VoiceNoteConsent
import ai.xopc.mobile.gateway.VoiceNoteDetail
import ai.xopc.mobile.gateway.VoiceNotesGateway
import ai.xopc.mobile.gateway.VoiceNoteLive
import android.Manifest
import android.content.pm.PackageManager
import android.media.MediaPlayer
import androidx.activity.compose.BackHandler
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.text.selection.SelectionContainer
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalView
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import androidx.core.content.ContextCompat
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import androidx.lifecycle.compose.LocalLifecycleOwner
import java.io.File
import java.text.DateFormat
import java.util.Date
import java.util.UUID
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

@Composable
internal fun VoiceNoteCapture(gatewayId: String, access: VoiceNotesGateway, insets: PaddingValues,
  onClose: () -> Unit, onOpen: (VoiceNoteDetail) -> Unit) {
  val context = LocalContext.current
  val view = LocalView.current
  val owner = LocalLifecycleOwner.current
  val scope = rememberCoroutineScope()
  val recorder = remember(gatewayId) { VoiceNoteRecorder(scope) }
  var draft by remember(gatewayId) { mutableStateOf<PendingVoiceNote?>(null) }
  var live by remember(gatewayId) { mutableStateOf<VoiceNoteLive?>(null) }
  var fallbackTranscript by remember(gatewayId) { mutableStateOf("") }
  val streamText = live?.transcript?.collectAsState()?.value.orEmpty()
  val liveAvailable = live?.available?.collectAsState()?.value == true
  var elapsed by remember { mutableIntStateOf(0) }
  var settings by remember { mutableStateOf<VoiceNoteConsent?>(null) }
  var pending by remember { mutableStateOf<List<PendingVoiceNote>>(emptyList()) }
  var busy by remember { mutableStateOf(false) }
  var issue by remember { mutableIntStateOf(0) }
  var revision by remember { mutableIntStateOf(0) }
  var confirmClose by remember { mutableStateOf(false) }
  val active = recorder.phase == "recording" || recorder.phase == "paused"
  val finishing = recorder.phase == "finishing" || recorder.phase == "discarding"
  val close: () -> Unit = {
    if (!busy && !finishing) {
      if (active || recorder.phase == "ready") confirmClose = true else onClose()
    }
  }
  BackHandler(onBack = close)
  if (active) DisposableEffect(view) {
    val previous = view.keepScreenOn
    view.keepScreenOn = true
    onDispose { view.keepScreenOn = previous }
  }
  DisposableEffect(owner, recorder) {
    val observer = LifecycleEventObserver { _, event ->
      if (event == Lifecycle.Event.ON_STOP) recorder.stopRecording()
    }
    owner.lifecycle.addObserver(observer)
    onDispose {
      owner.lifecycle.removeObserver(observer)
      recorder.stopRecording()
    }
  }
  fun start() {
    val recording = PendingVoiceNote(UUID.randomUUID().toString(), System.currentTimeMillis(), segmented = true)
    val stream = access.liveTranscription(gatewayId)
    draft = recording
    live = stream
    fallbackTranscript = ""
    elapsed = 0
    issue = 0
    recorder.start({ index, wav -> access.append(gatewayId, recording, index, wav) },
      { frame -> stream?.audio(frame) })
  }
  val permission = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) {
    if (it) start() else issue = R.string.voice_note_permission
  }
  LaunchedEffect(gatewayId, revision) {
    try {
      pending = access.pending(gatewayId)
      settings = access.settings(gatewayId)
      if (issue == R.string.voice_note_load_error) issue = 0
      val previous = pending
      previous.mapNotNull { it.noteId }.distinct().forEach { id ->
        try {
          access.detail(gatewayId, id)
        } catch (error: CancellationException) { throw error }
        catch (_: Exception) { /* Keep the pending item when the Gateway is unavailable. */ }
      }
      if (previous.any { it.noteId != null }) pending = access.pending(gatewayId)
    } catch (error: CancellationException) { throw error }
    catch (_: Exception) { issue = R.string.voice_note_load_error }
  }
  LaunchedEffect(recorder.phase) {
    while (recorder.phase == "recording") {
      elapsed = recorder.elapsedSeconds
      delay(250)
    }
  }
  fun submit(draft: PendingVoiceNote) {
    scope.launch {
      busy = true
      issue = 0
      try {
        onOpen(access.submit(gatewayId, draft))
      } catch (error: CancellationException) { throw error }
      catch (_: Exception) {
        live = null
        issue = R.string.voice_note_upload_error
        revision++
      } finally { busy = false }
    }
  }
  LaunchedEffect(live) { live?.connect() }
  LaunchedEffect(draft, active) {
    val recording = draft ?: return@LaunchedEffect
    if (!active) return@LaunchedEffect
    while (true) {
      try {
        access.publishLive(gatewayId, recording, live?.available?.value != true)?.let { fallbackTranscript = it }
        delay(1_500)
      } catch (error: CancellationException) { throw error }
      catch (_: Exception) { delay(3_000) }
    }
  }
  LaunchedEffect(recorder.phase) {
    if (recorder.phase == "ready") {
      live?.commit()
      val saved = draft ?: return@LaunchedEffect
      pending = listOf(saved) + pending.filter { it.id != saved.id }
      recorder.reset()
      submit(saved)
    } else if (recorder.phase == "error") {
      live = null
      revision++
    }
  }
  Column(Modifier.fillMaxSize().padding(insets).padding(20.dp).testTag("voice-note-capture"),
    verticalArrangement = Arrangement.spacedBy(12.dp)) {
    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
      PageBackButton("voice-note-back", close, enabled = !busy && !finishing)
      Text(stringResource(R.string.voice_note_title), style = MaterialTheme.typography.headlineSmall)
    }
    if (confirmClose) AlertDialog(onDismissRequest = { confirmClose = false },
      title = { Text(stringResource(R.string.voice_note_discard)) },
      confirmButton = { TextButton(onClick = {
        confirmClose = false
        scope.launch {
          val current = draft
          recorder.discard()
          live = null
          busy = true
          try {
            if (current != null) access.discard(gatewayId, current)
            onClose()
          } catch (error: CancellationException) { throw error }
          catch (_: Exception) {
            issue = R.string.voice_note_discard_error
            revision++
          } finally { busy = false }
        }
      }) { Text(stringResource(R.string.progress_confirm)) } },
      dismissButton = { TextButton(onClick = { confirmClose = false }) { Text(stringResource(R.string.progress_cancel)) } })
    if (issue != 0) Text(stringResource(issue), color = MaterialTheme.colorScheme.error,
      modifier = Modifier.testTag("voice-note-error"))
    if (busy || finishing) LinearProgressIndicator(Modifier.fillMaxWidth().testTag("voice-note-saving"))
    when {
      active -> {
        Text(stringResource(if (recorder.phase == "paused") R.string.voice_recording_paused_seconds
          else R.string.voice_recording_seconds, elapsed), modifier = Modifier.testTag("voice-note-timer"))
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
          OutlinedButton(onClick = {
            if (recorder.phase == "paused") recorder.resumeRecording()
            else { elapsed = recorder.elapsedSeconds; recorder.pauseRecording() }
          }, modifier = Modifier.testTag("voice-note-pause")) {
            Text(stringResource(if (recorder.phase == "paused") R.string.voice_note_resume else R.string.voice_note_pause))
          }
          Button(onClick = recorder::stopRecording, modifier = Modifier.testTag("voice-note-finish")) {
            Text(stringResource(R.string.voice_note_finish))
          }
        }
        Text(stringResource(R.string.voice_note_live_transcript), style = MaterialTheme.typography.titleMedium)
        val preview = if (liveAvailable || fallbackTranscript.isBlank()) streamText else fallbackTranscript
        if (preview.isBlank()) {
          Text(stringResource(R.string.voice_note_live_waiting), color = MaterialTheme.colorScheme.onSurfaceVariant)
        } else {
          LazyColumn(Modifier.weight(1f).testTag("voice-note-live-text"), reverseLayout = true,
            verticalArrangement = Arrangement.spacedBy(8.dp)) {
            items(preview.split('\n').asReversed()) { line -> Text(line) }
          }
        }
      }
      finishing -> Unit
      settings?.acknowledged == false -> {
        Text(stringResource(R.string.voice_note_consent))
        Button(enabled = !busy, onClick = {
          val policy = settings ?: return@Button
          scope.launch {
            busy = true
            try {
              access.acknowledge(gatewayId, policy.version)
              settings = policy.copy(acknowledged = true)
              issue = 0
            } catch (error: CancellationException) { throw error }
            catch (_: Exception) { issue = R.string.voice_note_load_error }
            finally { busy = false }
          }
        }, modifier = Modifier.testTag("voice-note-consent")) { Text(stringResource(R.string.voice_note_agree)) }
      }
      settings?.acknowledged == true -> {
        Text(stringResource(R.string.voice_note_record_limit), style = MaterialTheme.typography.bodySmall)
        if (recorder.phase == "error") Text(stringResource(R.string.voice_record_error))
        Button(enabled = !busy, onClick = {
          if (ContextCompat.checkSelfPermission(context, Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED) start()
          else permission.launch(Manifest.permission.RECORD_AUDIO)
        }, modifier = Modifier.testTag("voice-note-record")) { Text(stringResource(R.string.voice_note_record)) }
      }
      issue != 0 -> TextButton(onClick = { revision++ }) { Text(stringResource(R.string.voice_note_retry)) }
      else -> LinearProgressIndicator(Modifier.fillMaxWidth())
    }
    if (!active && pending.isNotEmpty()) LazyColumn(verticalArrangement = Arrangement.spacedBy(8.dp)) {
      item { Text(stringResource(R.string.voice_note_pending), style = MaterialTheme.typography.titleMedium) }
      items(pending, key = { it.id }) { draft ->
        OutlinedButton(enabled = !busy && settings?.acknowledged == true, onClick = { submit(draft) },
          modifier = Modifier.testTag("voice-note-upload-retry")) {
          Text(DateFormat.getDateTimeInstance().format(Date(draft.recordedAt)))
        }
      }
    }
  }
}

@Composable
internal fun VoiceNoteResult(detail: VoiceNoteDetail, loadAudio: suspend (File) -> Unit,
  onRetry: () -> Unit, busy: Boolean, retryError: Boolean, modifier: Modifier = Modifier) {
  var tab by rememberSaveable(detail.id) { mutableStateOf("summary") }
  val status = when {
    detail.status == "completed" -> R.string.voice_note_completed
    detail.status == "cancelled" -> R.string.voice_note_cancelled
    detail.canRetry -> R.string.voice_note_attention
    detail.status == "recording" -> R.string.voice_note_remote_recording
    !detail.audioSaved -> R.string.voice_note_saving
    detail.status == "organizing" -> R.string.voice_note_organizing
    else -> R.string.voice_note_transcribing
  }
  LazyColumn(modifier.testTag("voice-note-detail"), verticalArrangement = Arrangement.spacedBy(12.dp)) {
    item {
      Text(detail.title, style = MaterialTheme.typography.headlineSmall)
      Text(stringResource(status), Modifier.testTag("voice-note-status"))
      if (detail.processing) LinearProgressIndicator(Modifier.fillMaxWidth())
      if (detail.audioSaved) VoiceNotePlayback(detail.id, loadAudio)
      if (detail.canRetry || retryError) {
        Text(stringResource(if (detail.audioSaved) R.string.voice_note_retry_saved else R.string.voice_note_upload_error),
          color = MaterialTheme.colorScheme.error)
        OutlinedButton(onClick = onRetry, enabled = !busy, modifier = Modifier.testTag("voice-note-result-retry")) {
          Text(stringResource(R.string.voice_note_retry))
        }
      }
    }
    item {
      SegmentedTabs(listOf(
        SegmentOption("summary", stringResource(R.string.voice_note_overview), "voice-note-tab-summary"),
        SegmentOption("transcript", stringResource(R.string.voice_note_transcript), "voice-note-tab-transcript"),
      ), tab, { tab = it }, swipeToSelect = true)
    }
    if (tab == "transcript") {
      if (detail.segments.isEmpty()) item {
        if (detail.transcript.isNotBlank()) SelectionContainer { Text(detail.transcript) }
        else Text(stringResource(R.string.voice_note_empty_transcript), color = MaterialTheme.colorScheme.onSurfaceVariant)
      }
      items(detail.segments, key = { it.index }) { segment ->
        Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
          val seconds = segment.startedAt / 1000
          Text("%d:%02d".format(seconds / 60, seconds % 60) + segment.speaker?.let { " · $it" }.orEmpty(),
            style = MaterialTheme.typography.labelMedium)
          SelectionContainer { Text(segment.text) }
        }
      }
    } else if (detail.summary.isNotBlank() || detail.keyPoints.isNotEmpty()) item {
      Text(stringResource(R.string.voice_note_summary), style = MaterialTheme.typography.titleMedium)
      SelectionContainer {
        Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
          if (detail.summary.isNotBlank()) Text(detail.summary, Modifier.testTag("voice-note-summary"))
          detail.keyPoints.forEach { Text("• $it") }
        }
      }
    } else if (detail.transcript.isNotBlank()) item {
      Text(detail.transcript.take(400))
      TextButton(onClick = { tab = "transcript" }) { Text(stringResource(R.string.voice_note_transcript)) }
    }
  }
}

@Composable
private fun VoiceNotePlayback(id: String, loadAudio: suspend (File) -> Unit) {
  val context = LocalContext.current
  val scope = rememberCoroutineScope()
  var player by remember(id) { mutableStateOf<MediaPlayer?>(null) }
  var playing by remember(id) { mutableStateOf(false) }
  var loading by remember(id) { mutableStateOf(false) }
  var failed by remember(id) { mutableStateOf(false) }
  DisposableEffect(id) { onDispose { player?.release() } }
  OutlinedButton(enabled = !loading, onClick = {
    val current = player
    if (current != null) {
      if (playing) current.pause() else current.start()
      playing = !playing
    } else scope.launch {
      loading = true
      failed = false
      var preparing: MediaPlayer? = null
      try {
        val file = withContext(Dispatchers.IO) { File.createTempFile("voice-note-", ".audio", context.cacheDir) }
        val ready = try {
          loadAudio(file)
          withContext(Dispatchers.IO) {
            MediaPlayer().also { tool ->
              preparing = tool
              tool.setDataSource(file.absolutePath)
              tool.prepare()
            }
          }
        } finally { file.delete() }
        ai.xopc.mobile.playback.MusicPlayback.pause()
        ready.setOnCompletionListener { playing = false }
        ready.start()
        player = ready
        preparing = null
        playing = true
      } catch (error: CancellationException) { throw error }
      catch (_: Exception) { failed = true }
      finally { preparing?.release(); loading = false }
    }
  }, modifier = Modifier.testTag("voice-note-playback")) {
    Text(stringResource(if (playing) R.string.voice_note_pause else R.string.voice_note_play))
  }
  if (failed) Text(stringResource(R.string.voice_note_play_error), color = MaterialTheme.colorScheme.error)
}
