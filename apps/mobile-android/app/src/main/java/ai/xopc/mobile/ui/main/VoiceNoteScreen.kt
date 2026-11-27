package ai.xopc.mobile.ui.main

import ai.xopc.mobile.R
import ai.xopc.mobile.gateway.NoteDetail
import ai.xopc.mobile.gateway.PendingVoiceNote
import ai.xopc.mobile.theme.themedCorners
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
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.rotate
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalView
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.core.content.ContextCompat
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import androidx.lifecycle.compose.LocalLifecycleOwner
import java.io.File
import java.util.UUID
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

@Composable
internal fun VoiceNoteCapture(gatewayId: String, access: VoiceNotesGateway, insets: PaddingValues,
  recoveryOnly: Boolean = false, onClose: () -> Unit, onOpen: (VoiceNoteDetail) -> Unit) {
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
  var pendingDiscard by remember(gatewayId) { mutableStateOf<PendingVoiceNote?>(null) }
  var pendingLoaded by remember(gatewayId) { mutableStateOf(false) }
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
      pendingLoaded = true
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
  LaunchedEffect(recorder.phase, confirmClose) {
    if (recorder.phase == "ready" && !confirmClose) {
      live?.commit()
      val saved = draft ?: return@LaunchedEffect
      pending = listOf(saved) + pending.filter { it.id != saved.id }
      recorder.reset()
      submit(saved)
    } else if (recorder.phase == "error") {
      confirmClose = false
      live = null
      revision++
    }
  }
  Column(Modifier.fillMaxSize().padding(insets).testTag("voice-note-capture"),
    verticalArrangement = Arrangement.spacedBy(12.dp)) {
    XopcPageHeader(
      backTag = "voice-note-back",
      onBack = close,
      backEnabled = !busy && !finishing,
      title = stringResource(if (recoveryOnly) R.string.voice_note_pending else R.string.voice_note_title),
    )
    Column(Modifier.weight(1f).fillMaxWidth().padding(horizontal = XopcDesignTokens.PagePaddingX),
      verticalArrangement = Arrangement.spacedBy(12.dp)) {
    if (confirmClose) XopcConfirmDialog(
      onDismiss = { if (!busy && !finishing) confirmClose = false },
      onConfirm = {
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
      },
      title = stringResource(R.string.voice_note_discard),
      confirmLabel = stringResource(R.string.progress_confirm),
      destructive = true,
      confirmEnabled = !busy && !finishing,
    )
    pendingDiscard?.let { saved ->
      XopcConfirmDialog(
        onDismiss = { pendingDiscard = null },
        onConfirm = {
          pendingDiscard = null
          busy = true
          issue = 0
          scope.launch {
            try {
              access.discard(gatewayId, saved)
              pending = pending.filterNot { it.id == saved.id }
            } catch (error: CancellationException) { throw error }
            catch (_: Exception) { issue = R.string.voice_note_discard_error }
            finally { busy = false }
          }
        },
        title = stringResource(R.string.voice_note_discard),
        message = stringResource(R.string.voice_note_discard_local_message),
        confirmLabel = stringResource(R.string.voice_note_discard_action),
        destructive = true,
      )
    }
    if (issue != 0) Text(stringResource(issue), color = MaterialTheme.colorScheme.error,
      modifier = Modifier.testTag("voice-note-error"))
    if (busy || finishing) LinearProgressIndicator(Modifier.fillMaxWidth().testTag("voice-note-saving"))
    when {
      active -> {
        Surface(shape = themedCorners(20), color = MaterialTheme.colorScheme.surfaceContainerLow,
          modifier = Modifier.fillMaxWidth()) {
          Column(Modifier.fillMaxWidth().padding(horizontal = 20.dp, vertical = 22.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Surface(shape = CircleShape,
              color = if (recorder.phase == "paused") MaterialTheme.colorScheme.surfaceContainerHigh
                else MaterialTheme.colorScheme.errorContainer) {
              Row(Modifier.padding(horizontal = 12.dp, vertical = 5.dp),
                horizontalArrangement = Arrangement.spacedBy(6.dp),
                verticalAlignment = Alignment.CenterVertically) {
                Surface(shape = CircleShape,
                  color = if (recorder.phase == "paused") MaterialTheme.colorScheme.onSurfaceVariant
                    else MaterialTheme.colorScheme.error,
                  modifier = Modifier.size(7.dp)) {}
                Text(stringResource(if (recorder.phase == "paused") R.string.voice_recording_paused_seconds
                  else R.string.voice_recording_seconds, elapsed),
                  style = MaterialTheme.typography.labelMedium,
                  color = if (recorder.phase == "paused") MaterialTheme.colorScheme.onSurfaceVariant
                    else MaterialTheme.colorScheme.onErrorContainer,
                  modifier = Modifier.testTag("voice-note-timer"))
              }
            }
            Text(recordingTime(elapsed * 1000L),
              fontSize = 40.sp, fontWeight = FontWeight.Medium, fontFamily = FontFamily.Monospace,
              color = MaterialTheme.colorScheme.onSurface)
          }
        }
        Surface(shape = themedCorners(18), color = MaterialTheme.colorScheme.surfaceContainerLow,
          modifier = Modifier.fillMaxWidth().weight(1f)) {
          Column(Modifier.fillMaxSize().padding(16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
            Text(stringResource(R.string.voice_note_live_transcript),
              style = MaterialTheme.typography.labelLarge, color = MaterialTheme.colorScheme.onSurfaceVariant)
            val preview = if (liveAvailable || fallbackTranscript.isBlank()) streamText else fallbackTranscript
            if (preview.isBlank()) {
              Text(stringResource(R.string.voice_note_live_waiting),
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant)
            } else {
              LazyColumn(Modifier.weight(1f).testTag("voice-note-live-text"), reverseLayout = true,
                verticalArrangement = Arrangement.spacedBy(8.dp)) {
                items(preview.split('\n').asReversed()) { line ->
                  Text(line, style = MaterialTheme.typography.bodyLarge)
                }
              }
            }
          }
        }
        Row(Modifier.fillMaxWidth().padding(bottom = 8.dp), horizontalArrangement = Arrangement.spacedBy(12.dp)) {
          FilledTonalButton(onClick = {
            if (recorder.phase == "paused") recorder.resumeRecording()
            else { elapsed = recorder.elapsedSeconds; recorder.pauseRecording() }
          }, shape = CircleShape, modifier = Modifier.weight(1f).height(48.dp).testTag("voice-note-pause")) {
            Text(stringResource(if (recorder.phase == "paused") R.string.voice_note_resume else R.string.voice_note_pause))
          }
          Button(onClick = recorder::stopRecording, shape = CircleShape,
            colors = ButtonDefaults.buttonColors(containerColor = MaterialTheme.colorScheme.error,
              contentColor = MaterialTheme.colorScheme.onError),
            modifier = Modifier.weight(1f).height(48.dp).testTag("voice-note-finish")) {
            Text(stringResource(R.string.voice_note_finish))
          }
        }
      }
      finishing -> Unit
      settings?.acknowledged == false -> {
        Surface(shape = themedCorners(20), color = MaterialTheme.colorScheme.surfaceContainerLow,
          modifier = Modifier.fillMaxWidth()) {
          Column(Modifier.fillMaxWidth().padding(20.dp), verticalArrangement = Arrangement.spacedBy(14.dp)) {
            Text(stringResource(R.string.voice_note_consent), style = MaterialTheme.typography.bodyLarge,
              color = MaterialTheme.colorScheme.onSurface)
            Button(enabled = !busy, shape = CircleShape, onClick = {
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
            }, modifier = Modifier.fillMaxWidth().height(48.dp).testTag("voice-note-consent")) {
              Text(stringResource(R.string.voice_note_agree))
            }
          }
        }
      }
      settings?.acknowledged == true && !recoveryOnly -> {
        Surface(shape = themedCorners(20), color = MaterialTheme.colorScheme.surfaceContainerLow,
          modifier = Modifier.fillMaxWidth()) {
          Column(Modifier.fillMaxWidth().padding(horizontal = 20.dp, vertical = 28.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.spacedBy(14.dp)) {
            Surface(shape = CircleShape, color = MaterialTheme.colorScheme.primaryContainer,
              modifier = Modifier.size(64.dp)) {
              Box(contentAlignment = Alignment.Center) {
                Icon(painterResource(R.drawable.action_microphone), contentDescription = null,
                  tint = MaterialTheme.colorScheme.primary, modifier = Modifier.size(28.dp))
              }
            }
            Text(stringResource(R.string.voice_note_record_limit), style = MaterialTheme.typography.bodyMedium,
              color = MaterialTheme.colorScheme.onSurfaceVariant, textAlign = TextAlign.Center)
            if (recorder.phase == "error") {
              Text(stringResource(if (recorder.saveFailed) R.string.voice_note_save_error else R.string.voice_record_error),
                color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodySmall,
                textAlign = TextAlign.Center)
            }
            Button(enabled = !busy, shape = CircleShape, onClick = {
              if (ContextCompat.checkSelfPermission(context, Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED) start()
              else permission.launch(Manifest.permission.RECORD_AUDIO)
            }, modifier = Modifier.fillMaxWidth().height(48.dp).testTag("voice-note-record")) {
              Text(stringResource(R.string.voice_note_record))
            }
          }
        }
      }
      issue == R.string.voice_note_load_error -> TextButton(onClick = { revision++ }) {
        Text(stringResource(R.string.voice_note_retry))
      }
      recoveryOnly && pendingLoaded -> if (pending.isEmpty()) {
        Text(stringResource(R.string.voice_note_no_pending), color = MaterialTheme.colorScheme.onSurfaceVariant)
      }
      else -> LinearProgressIndicator(Modifier.fillMaxWidth())
    }
    if (!active && !finishing && pending.isNotEmpty()) LazyColumn(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(8.dp)) {
      if (!recoveryOnly) item {
        Text(stringResource(R.string.voice_note_pending), style = MaterialTheme.typography.titleMedium)
      }
      items(pending, key = { it.id }) { saved ->
        PendingRecordingCard(saved, !busy && settings?.acknowledged == true, !busy,
          onRecover = { submit(saved) }, onDiscard = { pendingDiscard = saved })
      }
    }
    }
  }
}

@Composable
private fun PendingRecordingCard(recording: PendingVoiceNote, canRecover: Boolean, canDiscard: Boolean,
  onRecover: () -> Unit, onDiscard: () -> Unit) {
  var menuOpen by remember { mutableStateOf(false) }
  Surface(Modifier.fillMaxWidth(), shape = themedCorners(14), color = MaterialTheme.colorScheme.surfaceContainer) {
    Column(Modifier.padding(12.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
      Text(recordingDate(recording.recordedAt), style = MaterialTheme.typography.titleSmall)
      Text(stringResource(R.string.voice_note_local_copy), style = MaterialTheme.typography.bodySmall,
        color = MaterialTheme.colorScheme.onSurfaceVariant)
      Row(verticalAlignment = Alignment.CenterVertically) {
        FilledTonalButton(onClick = onRecover, enabled = canRecover,
          colors = ButtonDefaults.filledTonalButtonColors(containerColor = MaterialTheme.colorScheme.primaryContainer,
            contentColor = MaterialTheme.colorScheme.primary),
          modifier = Modifier.testTag("voice-note-upload-retry")) {
          Text(stringResource(R.string.voice_note_recover))
        }
        Spacer(Modifier.weight(1f))
        Box {
          IconButton(onClick = { menuOpen = true }, enabled = canDiscard) {
            Icon(painterResource(R.drawable.action_more_horizontal), stringResource(R.string.notes_more))
          }
          DropdownMenu(expanded = menuOpen, onDismissRequest = { menuOpen = false }) {
            DropdownMenuItem(text = { Text(stringResource(R.string.voice_note_discard_action),
              color = MaterialTheme.colorScheme.error) }, onClick = {
              menuOpen = false
              onDiscard()
            })
          }
        }
      }
    }
  }
}

@Composable
internal fun VoiceNoteResult(detail: VoiceNoteDetail, loadAudio: suspend (File) -> Unit,
  onRetry: () -> Unit, busy: Boolean, retryError: Boolean, modifier: Modifier = Modifier, note: NoteDetail? = null) {
  var tab by rememberSaveable(detail.id) { mutableStateOf("summary") }
  LazyColumn(modifier.testTag("voice-note-detail"),
    contentPadding = PaddingValues(top = 8.dp, bottom = 16.dp),
    verticalArrangement = Arrangement.spacedBy(12.dp)) {
    item {
      Text(voiceRecordingTitle(note?.title?.takeIf { it.isNotBlank() } ?: detail.title),
        style = MaterialTheme.typography.headlineSmall)
      if (note != null) {
        Row(Modifier.fillMaxWidth().padding(top = 4.dp), horizontalArrangement = Arrangement.spacedBy(8.dp),
          verticalAlignment = Alignment.CenterVertically) {
          Text(recordingDate(note.updatedAt), Modifier.weight(1f), style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant)
          Surface(shape = themedCorners(6), color = MaterialTheme.colorScheme.surfaceContainer) {
            Text(noteStatusLabel(note.status), Modifier.padding(horizontal = 8.dp, vertical = 4.dp),
              style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
          }
        }
      }
    }
    if (detail.audioSaved) item(key = "playback") { VoiceNotePlayback(detail.id, detail.durationMs, loadAudio) }
    if (detail.status != "completed" || detail.processing || detail.canRetry || retryError) {
      item { VoiceNoteStatus(detail, busy, retryError, onRetry) }
    }
    item {
      SegmentedTabs(listOf(
        SegmentOption("summary", stringResource(R.string.voice_note_overview), "voice-note-tab-summary"),
        SegmentOption("transcript", stringResource(R.string.voice_note_transcript), "voice-note-tab-transcript"),
      ), tab, { tab = it }, swipeToSelect = true)
    }
    if (tab == "transcript") {
      if (detail.segments.isEmpty()) item {
        if (detail.transcript.isNotBlank()) {
          Surface(shape = themedCorners(16), color = MaterialTheme.colorScheme.surfaceContainerLow) {
            SelectionContainer {
              Text(detail.transcript, Modifier.fillMaxWidth().padding(16.dp),
                style = MaterialTheme.typography.bodyLarge)
            }
          }
        } else Text(stringResource(R.string.voice_note_empty_transcript), color = MaterialTheme.colorScheme.onSurfaceVariant)
      }
      items(detail.segments, key = { it.index }) { segment ->
        Surface(shape = themedCorners(16), color = MaterialTheme.colorScheme.surfaceContainerLow) {
          Column(Modifier.fillMaxWidth().padding(14.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
              Surface(shape = CircleShape, color = MaterialTheme.colorScheme.primaryContainer) {
                Text(recordingTime(segment.startedAt),
                  Modifier.padding(horizontal = 8.dp, vertical = 3.dp),
                  style = MaterialTheme.typography.labelSmall, fontFamily = FontFamily.Monospace,
                  color = MaterialTheme.colorScheme.primary)
              }
              segment.speaker?.let { speaker ->
                Text(speaker, style = MaterialTheme.typography.labelMedium,
                  color = MaterialTheme.colorScheme.onSurfaceVariant)
              }
            }
            SelectionContainer { Text(segment.text, style = MaterialTheme.typography.bodyLarge) }
          }
        }
      }
    } else if (detail.summary.isNotBlank() || detail.keyPoints.isNotEmpty()) item {
      Surface(shape = themedCorners(18), color = MaterialTheme.colorScheme.surfaceContainerLow) {
        SelectionContainer {
          Column(Modifier.fillMaxWidth().padding(18.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
            Text(stringResource(R.string.voice_note_summary), style = MaterialTheme.typography.titleMedium,
              fontWeight = FontWeight.SemiBold)
            if (detail.summary.isNotBlank()) Text(detail.summary, style = MaterialTheme.typography.bodyLarge,
              modifier = Modifier.testTag("voice-note-summary"))
            detail.keyPoints.forEach { point ->
              Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                Text("•", color = MaterialTheme.colorScheme.onSurfaceVariant)
                Text(point, style = MaterialTheme.typography.bodyMedium, modifier = Modifier.weight(1f))
              }
            }
          }
        }
      }
    } else if (detail.transcript.isNotBlank()) item {
      Surface(shape = themedCorners(16), color = MaterialTheme.colorScheme.surfaceContainerLow) {
        Column(Modifier.fillMaxWidth().padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
          Text(detail.transcript.take(400), style = MaterialTheme.typography.bodyLarge)
          TextButton(onClick = { tab = "transcript" }) { Text(stringResource(R.string.voice_note_transcript)) }
        }
      }
    }
  }
}

private val GENERATED_RECORDING_TITLE = Regex("""Discussion · \d{4}-\d{2}-\d{2} \d{2}:\d{2}""")

@Composable
internal fun voiceRecordingTitle(title: String): String =
  if (title.isBlank() || GENERATED_RECORDING_TITLE.matches(title)) stringResource(R.string.notes_create_voice) else title

@Composable
internal fun recordingDate(timestamp: Long): String {
  val context = LocalContext.current
  return android.text.format.DateUtils.formatDateTime(context, timestamp,
    android.text.format.DateUtils.FORMAT_SHOW_DATE or android.text.format.DateUtils.FORMAT_SHOW_YEAR or
      android.text.format.DateUtils.FORMAT_SHOW_TIME)
}

private fun recordingTime(milliseconds: Long): String {
  val seconds = milliseconds.coerceAtLeast(0) / 1000
  return "%02d:%02d".format(seconds / 60, seconds % 60)
}

@Composable
private fun VoiceNoteStatus(detail: VoiceNoteDetail, busy: Boolean, retryError: Boolean, onRetry: () -> Unit) {
  var expanded by rememberSaveable(detail.id) { mutableStateOf(false) }
  val status = when {
    detail.status == "completed" -> R.string.voice_note_completed
    detail.status == "cancelled" -> R.string.voice_note_cancelled
    detail.canRetry && !detail.audioSaved -> R.string.voice_note_upload_attention
    detail.canRetry && detail.failureStage == "organization" -> R.string.voice_note_summary_attention
    detail.canRetry -> R.string.voice_note_attention
    detail.status == "recording" -> R.string.voice_note_remote_recording
    !detail.audioSaved -> R.string.voice_note_saving
    detail.status == "organizing" -> R.string.voice_note_organizing
    else -> R.string.voice_note_transcribing
  }
  Surface(shape = themedCorners(14), color = MaterialTheme.colorScheme.surfaceContainerLow) {
    Column(Modifier.fillMaxWidth().padding(horizontal = 12.dp, vertical = 4.dp)) {
      if (detail.canRetry) {
        Surface(onClick = { expanded = !expanded }, color = MaterialTheme.colorScheme.surfaceContainerLow) {
          Row(Modifier.fillMaxWidth().heightIn(min = 44.dp),
            horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
            Text(stringResource(status), modifier = Modifier.weight(1f).testTag("voice-note-status"),
              style = MaterialTheme.typography.titleSmall)
            Icon(painterResource(R.drawable.action_chevron_down), null, Modifier.size(16.dp).rotate(if (expanded) 180f else 0f),
              tint = MaterialTheme.colorScheme.onSurfaceVariant)
          }
        }
        if (expanded) {
          Text(stringResource(if (detail.audioSaved) R.string.voice_note_retry_saved else R.string.voice_note_upload_error),
            style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
      } else {
        Text(stringResource(status), Modifier.padding(vertical = 8.dp).testTag("voice-note-status"),
          style = MaterialTheme.typography.titleSmall)
      }
      if (detail.processing || busy) LinearProgressIndicator(Modifier.fillMaxWidth().padding(bottom = 8.dp))
      if (retryError) Text(stringResource(R.string.voice_note_load_error), color = MaterialTheme.colorScheme.error,
        style = MaterialTheme.typography.bodySmall)
      if (detail.canRetry || retryError) {
        FilledTonalButton(onClick = onRetry, enabled = !busy,
          colors = ButtonDefaults.filledTonalButtonColors(containerColor = MaterialTheme.colorScheme.primaryContainer,
            contentColor = MaterialTheme.colorScheme.primary),
          modifier = Modifier.testTag("voice-note-result-retry")) {
          Text(stringResource(R.string.voice_note_retry))
        }
      }
    }
  }
}

@Composable
private fun VoiceNotePlayback(id: String, durationMs: Long, loadAudio: suspend (File) -> Unit) {
  val context = LocalContext.current
  val scope = rememberCoroutineScope()
  var player by remember(id) { mutableStateOf<MediaPlayer?>(null) }
  var playing by remember(id) { mutableStateOf(false) }
  var loading by remember(id) { mutableStateOf(false) }
  var failed by remember(id) { mutableStateOf(false) }
  DisposableEffect(id) { onDispose { player?.release() } }
  Surface(enabled = !loading, onClick = {
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
  }, modifier = Modifier.fillMaxWidth().testTag("voice-note-playback"),
    shape = themedCorners(14), color = MaterialTheme.colorScheme.surfaceContainer) {
    Row(Modifier.padding(12.dp), horizontalArrangement = Arrangement.spacedBy(10.dp),
      verticalAlignment = Alignment.CenterVertically) {
      Surface(shape = themedCorners(18), color = MaterialTheme.colorScheme.primaryContainer) {
        Box(Modifier.size(36.dp), contentAlignment = Alignment.Center) {
          if (loading) CircularProgressIndicator(Modifier.size(16.dp), strokeWidth = 2.dp)
          else Icon(painterResource(if (playing) android.R.drawable.ic_media_pause else android.R.drawable.ic_media_play),
            contentDescription = null, modifier = Modifier.size(20.dp),
            tint = MaterialTheme.colorScheme.onPrimaryContainer)
        }
      }
      Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(4.dp)) {
        Text(stringResource(if (playing) R.string.voice_note_pause else R.string.voice_note_play),
          style = MaterialTheme.typography.titleSmall)
        if (failed) Text(stringResource(R.string.voice_note_play_error), color = MaterialTheme.colorScheme.error,
          style = MaterialTheme.typography.bodySmall)
      }
      if (durationMs > 0) Text(recordingTime(durationMs), style = MaterialTheme.typography.labelMedium,
        color = MaterialTheme.colorScheme.onSurfaceVariant, fontFamily = FontFamily.Monospace)
    }
  }
}
