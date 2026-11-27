package ai.xopc.mobile.ui.main

import ai.xopc.mobile.theme.themedCorners
import ai.xopc.mobile.R
import ai.xopc.mobile.gateway.ProgressDelivery
import ai.xopc.mobile.gateway.NoteDetail
import ai.xopc.mobile.gateway.NoteDraft
import ai.xopc.mobile.gateway.NoteMetadataPatch
import ai.xopc.mobile.gateway.NoteAiPreview
import ai.xopc.mobile.gateway.NoteAttachment
import ai.xopc.mobile.gateway.NoteSummary
import ai.xopc.mobile.gateway.ManagedFile
import ai.xopc.mobile.gateway.ManagedFileSpace
import ai.xopc.mobile.gateway.GatewayHttpException
import ai.xopc.mobile.gateway.VoiceNotesGateway
import ai.xopc.mobile.gateway.VoiceNoteDetail
import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import android.content.Intent
import android.Manifest
import android.content.pm.PackageManager
import android.graphics.BitmapFactory
import android.media.MediaPlayer
import android.net.Uri
import androidx.activity.compose.BackHandler
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.PickVisualMediaRequest
import androidx.activity.result.contract.ActivityResultContracts
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import androidx.lifecycle.compose.LocalLifecycleOwner
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.background
import androidx.compose.foundation.Image
import androidx.compose.foundation.clickable
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.ScrollState
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyListState
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.FilledTonalButton
import androidx.compose.material3.IconButton
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.MutableState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.key
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.produceState
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.Alignment
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalFocusManager
import androidx.compose.ui.platform.LocalUriHandler
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.font.FontStyle
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.input.OffsetMapping
import androidx.compose.ui.text.input.TransformedText
import androidx.compose.ui.text.input.VisualTransformation
import androidx.compose.ui.text.TextRange
import androidx.compose.ui.text.input.TextFieldValue
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.sp
import androidx.core.content.ContextCompat
import kotlinx.coroutines.ensureActive
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import androidx.compose.runtime.rememberCoroutineScope
import java.text.DateFormat
import java.util.Date
import java.io.File

private val NOTE_INLINE_EMPHASIS = Regex("""(\*\*|__)([^\n]+?)\1|(?<!\*)\*([^*\n]+)\*""")
private val NOTE_EDITOR_HEADING = Regex("""(?m)^ {0,3}#{1,6} [^\n]+""")
private val NOTE_LINE_PREFIX = Regex("""^(?:#{1,6} |[-*+] \[[ xX]\] |[-*+] |\d+[.)] |> )""")

@OptIn(ExperimentalMaterial3Api::class)
@Composable
internal fun NotesScreen(state: NotesUiState, insets: PaddingValues,
  onSearch: (String, String) -> Unit, onLoadMore: () -> Unit, onOpen: (String) -> Unit,
  onNew: () -> Unit = {}, onDraftChange: (String, String) -> Unit = { _, _ -> },
  onSaveDraft: () -> Unit = {}, onCreatedHandled: (String) -> Unit = {},
  onOpenDraft: (String) -> Unit = {}, onEditNote: () -> Unit = {},
  onResolveConflict: (Boolean) -> Unit = {},
  onMetadataChange: (NoteMetadataPatch) -> Unit = {},
  onLoadHistory: () -> Unit = {}, onLoadSnapshot: (Long) -> Unit = {},
  onRestoreSnapshot: () -> Unit = {}, onRestorationHandled: (String) -> Unit = {},
  onDeleteNote: () -> Unit = {}, onDeletionHandled: (String) -> Unit = {},
  onShareNote: () -> Unit = {}, onDismissShare: () -> Unit = {},
  onAiPreview: suspend (String) -> NoteAiPreview = { throw IllegalStateException("AI_UNAVAILABLE") },
  onApplyAi: (NoteAiPreview) -> Unit = {},
  onContinueChat: suspend (String) -> String = { throw IllegalStateException("CHAT_UNAVAILABLE") },
  onOpenChat: (String) -> Unit = {},
  onAttachFile: suspend (Uri) -> Unit = { throw IllegalStateException("MEDIA_UNAVAILABLE") },
  onAttachVoice: suspend (ByteArray, Int) -> Unit = { _, _ ->
    throw IllegalStateException("MEDIA_UNAVAILABLE")
  },
  onLoadAttachment: suspend (String, String) -> ByteArray = { _, _ -> byteArrayOf() },
  onNoteFileSpaces: suspend () -> List<ManagedFileSpace> = { emptyList() },
  onNoteFiles: suspend (String?, String, String) -> List<ManagedFile> = { _, _, _ -> emptyList() },
  onNoteFileContent: suspend (String) -> ByteArray = { byteArrayOf() },
  onUploadSpaceFile: (suspend (String, String, String, Uri, String?) -> ManagedFile)? = null,
  voiceNotes: VoiceNotesGateway? = null,
  onExit: (() -> Unit)? = null,
  initialNoteId: String? = null,
  initialProjectDraft: Boolean = false,
  initialEditorOpen: Boolean = initialProjectDraft,
  initialVoiceCapture: Boolean = false,
  initialVoiceRecoveryOnly: Boolean = false,
  initialFileBrowser: Boolean = false,
  onOpenSidebar: (() -> Unit)? = null,
  bottomChromeInset: Dp = 0.dp,
  scrollToTopRevision: Int = 0,
  onNavigateRoute: ((MobileRoute) -> Unit)? = null,
  onPendingVoiceCountChange: (Int) -> Unit = {},
  sidebarGesture: Modifier = Modifier) {
  val context = LocalContext.current
  val focusManager = LocalFocusManager.current
  val lifecycleOwner = LocalLifecycleOwner.current
  val scope = rememberCoroutineScope()
  var attachmentSheetOpen by rememberSaveable(state.gatewayId) { mutableStateOf(false) }
  var attachmentBusy by remember(state.gatewayId) { mutableStateOf(false) }
  var attachmentError by remember(state.gatewayId) { mutableStateOf(false) }
  val noteVoice = remember(state.gatewayId) { VoiceMemoRecorder(context) }
  DisposableEffect(noteVoice) { onDispose { noteVoice.cancel() } }
  DisposableEffect(lifecycleOwner, noteVoice) {
    val observer = LifecycleEventObserver { _, event ->
      if (event == Lifecycle.Event.ON_STOP &&
        (noteVoice.phase == "recording" || noteVoice.phase == "paused"))
        noteVoice.stopRecording()
    }
    lifecycleOwner.lifecycle.addObserver(observer)
    onDispose { lifecycleOwner.lifecycle.removeObserver(observer) }
  }
  var noteVoiceBusy by remember(state.gatewayId) { mutableStateOf(false) }
  var noteVoiceElapsed by remember(state.gatewayId) { mutableStateOf(0) }
  LaunchedEffect(noteVoice.phase) {
    while (noteVoice.phase == "recording") {
      noteVoiceElapsed = noteVoice.elapsedSeconds
      delay(500)
    }
  }
  val noteVoicePermission = rememberLauncherForActivityResult(
    ActivityResultContracts.RequestPermission()) { granted ->
    if (granted) noteVoice.start() else attachmentError = true
  }
  var previewAttachment by remember(state.gatewayId) { mutableStateOf<NoteAttachment?>(null) }
  fun attach(uri: Uri?) {
    attachmentSheetOpen = false
    if (uri == null) return
    scope.launch {
      attachmentBusy = true; attachmentError = false
      runCatching { onAttachFile(uri) }.onFailure { attachmentError = true }
      attachmentBusy = false
    }
  }
  val photoPicker = rememberLauncherForActivityResult(ActivityResultContracts.PickVisualMedia(), ::attach)
  val filePicker = rememberLauncherForActivityResult(ActivityResultContracts.OpenDocument(), ::attach)
  val uriHandler = LocalUriHandler.current
  var query by rememberSaveable(state.gatewayId) { mutableStateOf(state.search) }
  val notesListState = rememberLazyListState()
  var searchOpen by rememberSaveable(state.gatewayId) { mutableStateOf(false) }
  fun toggleSearch() {
    searchOpen = !searchOpen
    if (!searchOpen) query = ""
  }
  LaunchedEffect(query, state.gatewayId) {
    if (query.trim() != state.search) {
      delay(350)
      onSearch(query.trim(), state.status)
    }
  }
  var selectedId by rememberSaveable(state.gatewayId) { mutableStateOf(initialNoteId) }
  var voiceCapture by rememberSaveable(state.gatewayId) { mutableStateOf(initialVoiceCapture) }
  var recoveryOnly by rememberSaveable(state.gatewayId) { mutableStateOf(initialVoiceRecoveryOnly) }
  var openedVoice by remember(state.gatewayId) { mutableStateOf<VoiceNoteDetail?>(null) }
  var voiceRevision by remember(state.gatewayId, selectedId) { mutableStateOf(0) }
  var voiceBusy by remember(state.gatewayId, selectedId) { mutableStateOf(false) }
  var voiceError by remember(state.gatewayId, selectedId) { mutableStateOf(false) }
  var voiceLookupDone by remember(state.gatewayId, selectedId) { mutableStateOf(false) }
  val voiceId = selectedId?.takeIf { id -> openedVoice?.noteId == id ||
    (state.detail?.id == id && state.detail.kind == "voice") ||
    state.items.any { it.id == id && it.kind == "voice" } }
  val voiceScope = state.gatewayId
  val pendingVoiceCount by key(voiceScope, voiceNotes) {
    produceState(0, voiceCapture, selectedId) {
      if (voiceCapture || selectedId != null || voiceScope == null || voiceNotes == null) return@produceState
      value = try {
        voiceNotes.pending(voiceScope).size
      } catch (error: kotlinx.coroutines.CancellationException) {
        throw error
      } catch (_: Exception) {
        0
      }
    }
  }
  LaunchedEffect(pendingVoiceCount) {
    onPendingVoiceCountChange(pendingVoiceCount)
  }
  var discussion by remember(voiceScope, voiceId) {
    mutableStateOf(openedVoice?.takeIf { it.noteId == voiceId })
  }
  LaunchedEffect(voiceScope, voiceId, voiceRevision, voiceNotes) {
    val id = voiceId ?: return@LaunchedEffect
    val gatewayId = voiceScope ?: return@LaunchedEffect
    val access = voiceNotes ?: return@LaunchedEffect
    try {
      do {
        val current = access.detail(gatewayId, id)
        if (current != null || discussion == null) discussion = current
        if (current != null && openedVoice?.noteId == id) openedVoice = current
        voiceLookupDone = true
        voiceError = false
        if (discussion?.processing != true) break
        delay(2500)
      } while (true)
    } catch (error: kotlinx.coroutines.CancellationException) { throw error }
    catch (_: Exception) { voiceError = true }
  }
  val detailScroll = key(state.gatewayId, selectedId) { rememberScrollState() }
  var editorOpen by rememberSaveable(state.gatewayId) { mutableStateOf(initialEditorOpen) }
  var fileBrowserOpen by rememberSaveable(state.gatewayId) { mutableStateOf(initialFileBrowser) }
  LaunchedEffect(scrollToTopRevision) {
    if (scrollToTopRevision > 0 && selectedId == null && !editorOpen && !fileBrowserOpen && !voiceCapture) {
      notesListState.animateScrollToItem(0)
    }
  }
  var fileSpaceId by rememberSaveable(state.gatewayId) { mutableStateOf<String?>(null) }
  var filePath by rememberSaveable(state.gatewayId) { mutableStateOf("") }
  var fileSearch by rememberSaveable(state.gatewayId) { mutableStateOf("") }
  var pendingExternalUrl by remember(state.gatewayId) { mutableStateOf<String?>(null) }
  var selectedFile by remember(state.gatewayId) { mutableStateOf<ManagedFile?>(null) }
  var fileRefreshRevision by rememberSaveable(state.gatewayId) { mutableStateOf(0) }
  var fileSpaces by remember(state.gatewayId) { mutableStateOf<List<ManagedFileSpace>>(emptyList()) }
  var recentFileItems by remember(state.gatewayId) { mutableStateOf<List<ManagedFile>?>(null) }
  var folderItems by remember(state.gatewayId, fileSpaceId, filePath) { mutableStateOf<List<ManagedFile>>(emptyList()) }
  var fileContent by remember(state.gatewayId, selectedFile?.id) { mutableStateOf<ByteArray?>(null) }
  var fileContentLoading by remember(state.gatewayId, selectedFile?.id) {
    mutableStateOf(selectedFile?.let {
      previewFileKind(it.name, it.mimeType) != PreviewFileKind.BINARY || isBitmapPreview(it.name, it.mimeType)
    } == true)
  }
  var filesLoading by remember(state.gatewayId, fileSpaceId, filePath) { mutableStateOf(true) }
  var filesError by remember(state.gatewayId, fileSpaceId, filePath) { mutableStateOf(false) }
  var uploadTarget by rememberSaveable(state.gatewayId) { mutableStateOf<Pair<String, String>?>(null) }
  var uploadBusy by remember(state.gatewayId) { mutableStateOf(false) }
  var uploadIssue by remember(state.gatewayId) { mutableStateOf(0) }
  var conflictUri by rememberSaveable(state.gatewayId) { mutableStateOf<Uri?>(null) }
  var replacementName by rememberSaveable(state.gatewayId) { mutableStateOf("") }
  fun uploadFile(uri: Uri, name: String?) {
    val (space, directory) = uploadTarget ?: return
    val gatewayId = state.gatewayId ?: return
    val upload = onUploadSpaceFile ?: return
    if (uploadBusy || !fileBrowserOpen || fileSpaceId != space || filePath != directory ||
      fileSpaces.none { it.id == space && it.writable }) return
    uploadBusy = true
    uploadIssue = 0
    scope.launch {
      try {
        upload(gatewayId, space, directory, uri, name)
        conflictUri = null
        fileSearch = ""
        fileRefreshRevision++
      } catch (error: kotlinx.coroutines.CancellationException) { throw error }
      catch (error: Exception) {
        if (error is GatewayHttpException && error.status == 409) {
          conflictUri = uri
          replacementName = name.orEmpty()
        } else {
          conflictUri = null
          uploadIssue = if (error.message == "UPLOAD_LIMIT_8_MB") R.string.file_space_upload_limit else R.string.file_space_upload_failed
        }
      } finally { uploadBusy = false }
    }
  }
  val uploadPicker = rememberLauncherForActivityResult(ActivityResultContracts.OpenDocument()) {
    if (it != null) uploadFile(it, null)
  }
  LaunchedEffect(fileBrowserOpen, fileSpaceId, filePath, fileSearch, fileRefreshRevision, state.gatewayId) {
    if (!fileBrowserOpen) return@LaunchedEffect
    val trimmedSearch = fileSearch.trim()
    if (trimmedSearch.isNotEmpty()) delay(250)
    filesLoading = true
    filesError = false
    try {
      if (fileSpaceId == null && trimmedSearch.isEmpty()) {
        try {
          val spaces = onNoteFileSpaces()
          coroutineContext.ensureActive()
          fileSpaces = spaces
        } catch (cancelled: kotlinx.coroutines.CancellationException) {
          throw cancelled
        } catch (_: Exception) {
          filesError = true
        }
      }
      val files = onNoteFiles(fileSpaceId, filePath, trimmedSearch)
      coroutineContext.ensureActive()
      if (fileSpaceId == null) recentFileItems = files else folderItems = files
    } catch (cancelled: kotlinx.coroutines.CancellationException) {
      throw cancelled
    } catch (_: Exception) {
      filesError = true
    } finally {
      coroutineContext.ensureActive()
      filesLoading = false
    }
  }
  LaunchedEffect(state.gatewayId, selectedFile?.id) {
    val file = selectedFile ?: return@LaunchedEffect
    if (!fileContentLoading) return@LaunchedEffect
    try {
      val bytes = onNoteFileContent(file.id)
      coroutineContext.ensureActive()
      fileContent = bytes
    } catch (cancelled: kotlinx.coroutines.CancellationException) {
      throw cancelled
    } catch (_: Exception) {
      fileContent = null
    } finally {
      fileContentLoading = false
    }
  }
  var moreOpen by rememberSaveable(state.gatewayId) { mutableStateOf(false) }
  var aiOpen by rememberSaveable(state.gatewayId) { mutableStateOf(false) }
  var aiInstruction by rememberSaveable(state.gatewayId) { mutableStateOf("") }
  var aiPreview by remember(state.gatewayId) { mutableStateOf<NoteAiPreview?>(null) }
  var aiBusy by remember(state.gatewayId) { mutableStateOf(false) }
  var aiError by remember(state.gatewayId) { mutableStateOf(false) }
  var chatBusy by remember(state.gatewayId) { mutableStateOf(false) }
  var tagsOpen by rememberSaveable(state.gatewayId) { mutableStateOf(false) }
  var historyOpen by rememberSaveable(state.gatewayId) { mutableStateOf(false) }
  var restoreConfirmOpen by rememberSaveable(state.gatewayId) { mutableStateOf(false) }
  var deleteConfirmOpen by rememberSaveable(state.gatewayId) { mutableStateOf(false) }
  var historyTimestamp by rememberSaveable(state.gatewayId) { mutableStateOf<Long?>(null) }
  var tagsText by rememberSaveable(state.gatewayId) { mutableStateOf("") }
  val parsedTags = tagsText.split(',').map { it.trim() }.filter { it.isNotEmpty() }.distinct()
  val tagsValid = parsedTags.size <= 100 && parsedTags.all { it.length <= 512 }
  val closeEditor = {
    val draft = state.draft
    if (draft == null || (draft.id.startsWith("local-") &&
      draft.title.isBlank() && draft.markdown.isBlank())) {
      if ((initialProjectDraft || initialEditorOpen) && onExit != null) onExit() else editorOpen = false
    }
    else onSaveDraft()
  }
  val closeNote = {
    if ((initialProjectDraft || initialEditorOpen || initialNoteId != null && selectedId == initialNoteId) && onExit != null) onExit()
    else selectedId = null
  }
  val closeFile = {
    when {
      uploadBusy -> Unit
      selectedFile != null -> selectedFile = null
      filePath.isNotEmpty() -> filePath = filePath.substringBeforeLast('/', "")
      fileSpaceId != null -> fileSpaceId = null
      initialFileBrowser && onExit != null -> onExit()
      else -> fileBrowserOpen = false
    }
  }
  BackHandler(enabled = editorOpen || selectedId != null) {
    if (editorOpen) closeEditor() else closeNote()
  }
  BackHandler(enabled = fileBrowserOpen, onBack = closeFile)
  BackHandler(enabled = searchOpen && !fileBrowserOpen && !editorOpen && selectedId == null, onBack = ::toggleSearch)
  LaunchedEffect(state.createdNoteId) {
    if (state.createdNoteId != null) {
      editorOpen = false
      selectedId = state.createdNoteId
      onCreatedHandled(state.createdNoteId)
    }
  }
  LaunchedEffect(state.restoredSnapshotId) {
    val id = state.restoredSnapshotId
    if (id != null) {
      historyOpen = false
      restoreConfirmOpen = false
      editorOpen = true
      selectedId = id
      onRestorationHandled(id)
    }
  }
  LaunchedEffect(state.deletedNoteId) {
    val id = state.deletedNoteId
    if (id != null) {
      moreOpen = false
      deleteConfirmOpen = false
      editorOpen = false
      if (selectedId == id) closeNote()
      onDeletionHandled(id)
    }
  }
  LaunchedEffect(editorOpen, state.selectedId) {
    if (editorOpen && selectedId == null && state.selectedId != null) selectedId = state.selectedId
  }
  LaunchedEffect(selectedId, state.selectedId) {
    val id = selectedId
    if (id != null && state.selectedId != id && state.deletedNoteId != id) onOpen(id)
  }
  LaunchedEffect(selectedId) {
    moreOpen = false; tagsOpen = false; historyOpen = false; restoreConfirmOpen = false
    aiOpen = false; aiPreview = null; aiError = false
    previewAttachment = null
    noteVoice.cancel(); noteVoiceElapsed = 0
    deleteConfirmOpen = false
    onDismissShare()
  }
  if (voiceCapture && voiceNotes != null && voiceScope != null) {
    VoiceNoteCapture(voiceScope, voiceNotes, insets, recoveryOnly = recoveryOnly, onClose = {
      if (initialVoiceCapture && onExit != null) onExit() else voiceCapture = false
    }) { result ->
      openedVoice = result
      selectedId = result.noteId
      voiceCapture = false
      onOpen(result.noteId)
      onSearch(query.trim(), state.status)
    }
    return
  }
  if (conflictUri != null) AlertDialog(onDismissRequest = { if (!uploadBusy) conflictUri = null },
    title = { Text(stringResource(R.string.file_space_upload_conflict)) },
    text = {
      OutlinedTextField(replacementName, { replacementName = it }, singleLine = true, enabled = !uploadBusy,
        label = { Text(stringResource(R.string.file_space_upload_new_name)) },
        modifier = Modifier.testTag("notes-file-upload-name"))
    },
    confirmButton = {
      TextButton(enabled = !uploadBusy && replacementName.isNotBlank() && replacementName.length <= 255 &&
        replacementName.trim() !in setOf(".", "..") && replacementName.none { it.isISOControl() || it in "/\\\"" },
        onClick = { conflictUri?.let { uploadFile(it, replacementName) } },
        modifier = Modifier.testTag("notes-file-upload-rename")) { Text(stringResource(R.string.file_space_upload)) }
    },
    dismissButton = { TextButton(enabled = !uploadBusy, onClick = { conflictUri = null }) { Text(stringResource(R.string.progress_cancel)) } })
  val isNotesRoot = onOpenSidebar != null && !fileBrowserOpen && !editorOpen && selectedId == null
  Column(modifier = Modifier.fillMaxSize().then(if (isNotesRoot) sidebarGesture else Modifier).padding(insets),
    verticalArrangement = Arrangement.spacedBy(8.dp)) {
    val back = when {
      fileBrowserOpen -> closeFile
      editorOpen -> closeEditor
      selectedId != null -> closeNote
      else -> onExit ?: {}
    }
    val showingNotesList = !fileBrowserOpen && !editorOpen && selectedId == null
    val noteStatusOptions = listOf(
      "" to R.string.notes_all,
      "inbox" to R.string.notes_inbox,
      "processed" to R.string.notes_processed,
      "archived" to R.string.notes_archived,
    ).map { (statusValue, labelRes) ->
      SegmentOption(statusValue, stringResource(labelRes), "notes-filter-${statusValue.ifEmpty { "all" }}")
    }
    XopcPageHeader(
      backTag = "notes-back",
      onBack = back,
      showBack = !isNotesRoot && (onExit != null || fileBrowserOpen || editorOpen || selectedId != null),
      leadingContent = if (isNotesRoot) ({ PageSidebarButton("notes-sidebar", onOpenSidebar!!) }) else null,
      title = if (fileBrowserOpen) stringResource(R.string.notes_files) else stringResource(R.string.tab_notes),
      titleContent = if (showingNotesList) ({
        PageTitleMenu(noteStatusOptions, state.status, "notes-page-menu") { next ->
          onSearch(query.trim(), next)
        }
      }) else null,
    ) {
      if (fileBrowserOpen || editorOpen || selectedId != null) {
        if (fileBrowserOpen && selectedFile == null && onUploadSpaceFile != null &&
          fileSpaces.any { it.id == fileSpaceId && it.writable }) {
          TextButton(enabled = !uploadBusy, onClick = {
            uploadTarget = (fileSpaceId ?: return@TextButton) to filePath
            uploadPicker.launch(arrayOf("*/*"))
          }, modifier = Modifier.testTag("notes-file-upload")) { Text(stringResource(R.string.file_space_upload)) }
        } else if (!fileBrowserOpen) {
          Text(
            if (!editorOpen || state.draft?.version == state.draftSyncedVersion) stringResource(R.string.notes_saved)
            else if (state.draftSaving) stringResource(R.string.notes_syncing)
            else if (state.draft?.version == state.draftSavedVersion) stringResource(R.string.notes_saved_locally)
            else stringResource(R.string.notes_saving_locally),
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            maxLines = 1,
          )
        }
      } else {
        PageSearchButton(searchOpen, R.string.notes_search, "notes-open-search", ::toggleSearch)
        IconButton(onClick = {
          focusManager.clearFocus(force = true)
          if (onNavigateRoute != null && isNotesRoot) {
            onNavigateRoute(MobileRoute.NoteFiles)
          } else {
            fileSpaceId = null
            filePath = ""
            fileSearch = ""
            selectedFile = null
            fileBrowserOpen = true
          }
        }, modifier = Modifier.testTag("notes-open-files")) {
          ActionIcon(R.drawable.action_folder, size = 24.dp, contentDescription = stringResource(R.string.notes_files))
        }
      }
    }
    Column(modifier = Modifier.weight(1f).fillMaxWidth().padding(horizontal = XopcDesignTokens.PagePaddingX),
      verticalArrangement = Arrangement.spacedBy(12.dp)) {
    if (fileBrowserOpen && uploadBusy) androidx.compose.material3.LinearProgressIndicator(Modifier.fillMaxWidth())
    if (fileBrowserOpen && uploadIssue != 0) Text(stringResource(uploadIssue), color = MaterialTheme.colorScheme.error)
    val visibleFileSpaces = if (fileSpaceId == null && fileSearch.isBlank()) fileSpaces else emptyList()
    val visibleFileItems = if (fileSpaceId != null) folderItems else
      recentFileItems.orEmpty()
    if (fileBrowserOpen) NotesFilesContent(visibleFileSpaces, visibleFileItems, selectedFile, fileContent,
      if (selectedFile != null) fileContentLoading else filesLoading,
      selectedFile == null && filesError, { fileRefreshRevision++ }, { space ->
        selectedFile = null; filePath = ""; fileSearch = ""; fileSpaceId = space.id
      }, { file ->
        if (file.kind == "directory") { fileSpaceId = file.spaceId; filePath = file.relativePath; fileSearch = "" }
        else selectedFile = file
      }, Modifier.weight(1f), search = fileSearch, onSearchChange = { fileSearch = it })
    else if (editorOpen) NoteDraftContent(state, onDraftChange, onSaveDraft,
      Modifier.weight(1f), onResolveConflict, onAddAttachment = { attachmentSheetOpen = true },
      attachmentBusy = attachmentBusy, attachmentError = attachmentError)
    else if (selectedId == null) {
      val effectiveBottomInset = if (isNotesRoot) bottomChromeInset else 0.dp
      Box(Modifier.weight(1f).fillMaxWidth()) {
        NotesListContent(state, query, { query = it },
          { onSearch(query.trim(), state.status) }, { status -> onSearch(query.trim(), status) },
          { id ->
            if (onNavigateRoute != null && isNotesRoot) {
              onOpen(id)
              onNavigateRoute(MobileRoute.NoteDetail(id))
            } else {
              selectedId = id; onOpen(id)
            }
          }, onLoadMore, Modifier.fillMaxSize(),
          { id ->
            if (onNavigateRoute != null && isNotesRoot) {
              onOpenDraft(id)
              onNavigateRoute(MobileRoute.NoteEditor(noteId = id))
            } else {
              editorOpen = true; onOpenDraft(id)
            }
          }, searchOpen = searchOpen,
          listState = notesListState, bottomContentPadding = 76.dp + effectiveBottomInset,
          pendingVoiceCount = pendingVoiceCount, onRecoverVoice = {
            focusManager.clearFocus(force = true)
            if (onNavigateRoute != null && isNotesRoot) {
              onNavigateRoute(MobileRoute.VoiceNoteCapture(recoveryOnly = true))
            } else {
              recoveryOnly = true
              voiceCapture = true
            }
          })
        Surface(modifier = Modifier.align(Alignment.BottomCenter).padding(bottom = effectiveBottomInset + 8.dp)
          .testTag("notes-capture-actions"), shape = CircleShape,
          color = MaterialTheme.colorScheme.surfaceContainerHigh, shadowElevation = 4.dp) {
          Row(Modifier.padding(5.dp), horizontalArrangement = Arrangement.spacedBy(4.dp),
            verticalAlignment = Alignment.CenterVertically) {
            if (voiceNotes != null && voiceScope != null) {
              TextButton(onClick = {
                focusManager.clearFocus(force = true)
                if (onNavigateRoute != null && isNotesRoot) {
                  onNavigateRoute(MobileRoute.VoiceNoteCapture(recoveryOnly = false))
                } else {
                  recoveryOnly = false
                  voiceCapture = true
                }
              },
                modifier = Modifier.heightIn(min = 46.dp).testTag("notes-new-voice"),
                colors = ButtonDefaults.textButtonColors(contentColor = MaterialTheme.colorScheme.onSurface)) {
                Row(horizontalArrangement = Arrangement.spacedBy(6.dp), verticalAlignment = Alignment.CenterVertically) {
                  ActionIcon(R.drawable.action_microphone, size = 18.dp)
                  Text(stringResource(R.string.notes_record))
                }
              }
            }
            Button(onClick = {
              focusManager.clearFocus(force = true)
              if (onNavigateRoute != null && isNotesRoot) {
                onNew()
                onNavigateRoute(MobileRoute.NoteEditor())
              } else {
                editorOpen = true; onNew()
              }
            },
              modifier = Modifier.heightIn(min = 46.dp).testTag("notes-new"),
              enabled = !state.draftLoading && !state.draftSaving, shape = CircleShape,
              colors = ButtonDefaults.buttonColors(containerColor = MaterialTheme.colorScheme.primaryContainer,
                contentColor = MaterialTheme.colorScheme.onPrimaryContainer)) {
              Row(horizontalArrangement = Arrangement.spacedBy(6.dp), verticalAlignment = Alignment.CenterVertically) {
                ActionIcon(R.drawable.action_new_chat, size = 18.dp)
                Text(stringResource(R.string.notes_new))
              }
            }
          }
        }
      }
    } else if (discussion != null && voiceNotes != null && voiceScope != null) {
      val note = requireNotNull(discussion)
      VoiceNoteResult(note, { file -> voiceNotes.downloadAudio(voiceScope, note, file) }, onRetry = {
        if (!voiceBusy) scope.launch {
          voiceBusy = true
          voiceError = false
          try {
            if (note.canRetry) {
              val updated = voiceNotes.retry(voiceScope, note)
              discussion = updated
              if (openedVoice?.noteId == updated.noteId) openedVoice = updated
            }
            voiceRevision++
          } catch (error: kotlinx.coroutines.CancellationException) { throw error }
          catch (_: Exception) { voiceError = true }
          finally { voiceBusy = false }
        }
      }, busy = voiceBusy, retryError = voiceError, modifier = Modifier.weight(1f),
        note = state.detail?.takeIf { it.id == note.noteId })
      state.detail?.takeIf { it.id == note.noteId }?.let { saved ->
        Row(Modifier.fillMaxWidth().padding(bottom = 8.dp),
          horizontalArrangement = Arrangement.spacedBy(8.dp, Alignment.End),
          verticalAlignment = Alignment.CenterVertically) {
          IconButton(onClick = { moreOpen = true }, modifier = Modifier.testTag("note-detail-more")) {
            Icon(painterResource(R.drawable.action_more_horizontal), stringResource(R.string.notes_more))
          }
          FilledTonalButton(onClick = { editorOpen = true; onEditNote() },
            enabled = saved.remoteVersion != null && !state.metadataBusy && !state.deleteBusy,
            colors = ButtonDefaults.filledTonalButtonColors(containerColor = MaterialTheme.colorScheme.primaryContainer,
              contentColor = MaterialTheme.colorScheme.primary),
            modifier = Modifier.testTag("note-detail-edit")) {
            Text(stringResource(R.string.notes_edit))
          }
        }
      }
    } else if (voiceId != null && voiceNotes != null && !voiceLookupDone) {
      if (voiceError) OutlinedButton(onClick = { voiceError = false; voiceRevision++ },
        modifier = Modifier.testTag("voice-note-detail-retry")) { Text(stringResource(R.string.voice_note_load_error)) }
      else BrandLoadingPanel(modifier = Modifier.weight(1f))
    } else NotesDetailContent(state, selectedId!!, { onOpen(selectedId!!) }, Modifier.weight(1f),
      { editorOpen = true; onEditNote() }, { moreOpen = true }, {
        historyTimestamp = null
        historyOpen = true
        onLoadHistory()
      }, onAi = {
        onEditNote()
        aiInstruction = ""; aiPreview = null; aiError = false; aiOpen = true
      },
      onContinueChat = {
        if (!chatBusy) scope.launch {
          chatBusy = true
          runCatching { onContinueChat(selectedId!!) }.onSuccess(onOpenChat)
            .onFailure { aiError = true }
          chatBusy = false
        }
      }, chatBusy = chatBusy, onOpenLink = { link ->
        val uri = Uri.parse(link)
        when {
          uri.scheme == "xopc-attachment" && uri.host == "notes" -> {
            val parts = uri.pathSegments
            if (parts.size == 2 && parts[0] == selectedId)
              previewAttachment = state.detail?.attachments?.firstOrNull { it.id == parts[1] }
          }
          externalMessageLink(link) -> pendingExternalUrl = link
          uri.scheme == "xopc" && uri.host == "workspace" && uri.path == "/file" -> {
            val rawPath = uri.getQueryParameter("path").orEmpty()
            val parts = rawPath.split('/')
            if (!rawPath.startsWith('/') && !rawPath.endsWith('/') &&
              parts.isNotEmpty() && parts.all { it.isNotBlank() && it != "." && it != ".." }) {
              fileSpaceId = null
              filePath = parts.dropLast(1).joinToString("/")
              fileSearch = ""
              selectedFile = null
              fileBrowserOpen = true
            }
          }
        }
      }, onPreviewAttachment = { previewAttachment = it }, scroll = detailScroll)
    }
  }
  pendingExternalUrl?.let { url ->
    val externalLinkFailure = stringResource(R.string.message_open_link_failed)
    XopcConfirmDialog(
      onDismiss = { pendingExternalUrl = null },
      onConfirm = {
        pendingExternalUrl = null
        runCatching { uriHandler.openUri(url) }.onFailure {
          xopcShowToast(context, externalLinkFailure)
        }
      },
      title = stringResource(R.string.message_open_external_title),
      message = url,
      confirmLabel = stringResource(R.string.message_open_external),
    )
  }
  val attachmentToPreview = previewAttachment
  if (attachmentToPreview != null && selectedId != null) {
    val noteId = selectedId!!
    val preview by produceState<Pair<Boolean, ByteArray?>>(false to null,
      noteId, attachmentToPreview.id) {
      value = true to runCatching { onLoadAttachment(noteId, attachmentToPreview.id) }.getOrNull()
    }
    val content = preview.second
    val audioFile = remember(noteId, attachmentToPreview.id) {
      File(context.cacheDir, "note-preview-${attachmentToPreview.id}.tmp")
    }
    var audioPlayer by remember(noteId, attachmentToPreview.id) { mutableStateOf<MediaPlayer?>(null) }
    var audioPreparing by remember(noteId, attachmentToPreview.id) { mutableStateOf(false) }
    DisposableEffect(noteId, attachmentToPreview.id) { onDispose {
      runCatching { audioPlayer?.stop() }; audioPlayer?.release(); audioFile.delete()
    } }
    AlertDialog(onDismissRequest = { previewAttachment = null },
      modifier = Modifier.testTag("note-attachment-preview"),
      title = { Text(attachmentToPreview.fileName) },
      text = { when {
        !preview.first -> BrandLoadingPanel(minHeight = 120.dp)
        content == null -> Text(stringResource(R.string.notes_file_preview_unavailable))
        attachmentToPreview.type == "image" -> {
          val decoded by produceState<Pair<Boolean, android.graphics.Bitmap?>>(false to null, content) {
            value = true to kotlinx.coroutines.withContext(kotlinx.coroutines.Dispatchers.Default) {
              decodeChatThumbnail(content, 1200)
            }
          }
          val image = decoded.second
          if (!decoded.first) BrandLoadingPanel(minHeight = 120.dp)
          else if (image != null) Image(image.asImageBitmap(), contentDescription = attachmentToPreview.fileName,
            modifier = Modifier.fillMaxWidth().heightIn(max = 420.dp), contentScale = ContentScale.Fit)
          else Text(stringResource(R.string.notes_file_preview_unavailable))
        }
        attachmentToPreview.type == "audio" -> Button(enabled = !audioPreparing, onClick = {
          if (audioPlayer != null) {
            runCatching { audioPlayer?.stop() }; audioPlayer?.release(); audioPlayer = null
          } else scope.launch {
            audioPreparing = true
            val prepared = runCatching {
              kotlinx.coroutines.withContext(kotlinx.coroutines.Dispatchers.IO) {
                audioFile.writeBytes(content)
                MediaPlayer().apply {
                  setDataSource(audioFile.absolutePath)
                  prepare()
                }
              }
            }.getOrNull()
            audioPreparing = false
            if (prepared != null) {
              prepared.setOnCompletionListener { player -> player.release(); audioPlayer = null }
              audioPlayer = prepared
              runCatching { prepared.start() }.onFailure {
                prepared.release(); audioPlayer = null
              }
            }
          }
        }) { Text(stringResource(if (audioPlayer == null) R.string.voice_preview
          else R.string.voice_record_stop)) }
        else -> FilePreviewContent(attachmentToPreview.fileName, attachmentToPreview.mimeType,
          content, modifier = Modifier.heightIn(max = 420.dp))
      } },
      confirmButton = { TextButton(onClick = { previewAttachment = null }) {
        Text(stringResource(R.string.assistant_close))
      } })
  }
  if (aiOpen) XopcBottomSheet(XopcSheetPreset.Medium, onDismissRequest = { aiOpen = false },
    modifier = Modifier.testTag("note-ai-sheet")) {
    val formScroll = if (aiPreview == null) Modifier.verticalScroll(rememberScrollState()) else Modifier
    XopcSheetHeader(title = stringResource(R.string.notes_ai_edit), onClose = { aiOpen = false })
    Column(modifier = Modifier.fillMaxWidth().then(formScroll).padding(horizontal = 20.dp, vertical = 8.dp),
      verticalArrangement = Arrangement.spacedBy(12.dp)) {
      if (aiPreview == null) {
        OutlinedTextField(aiInstruction, { aiInstruction = it }, modifier = Modifier.fillMaxWidth()
          .testTag("note-ai-instruction"), minLines = 3, shape = themedCorners(14),
          label = { Text(stringResource(R.string.notes_ai_instruction)) })
        Button(onClick = { scope.launch {
          aiBusy = true; aiError = false
          runCatching { onAiPreview(aiInstruction) }.onSuccess { aiPreview = it }
            .onFailure { aiError = true }
          aiBusy = false
        } }, enabled = !aiBusy && !state.draftLoading &&
          state.draft?.id == selectedId && aiInstruction.isNotBlank(),
          shape = CircleShape,
          modifier = Modifier.fillMaxWidth().height(46.dp).testTag("note-ai-generate")) {
          Text(stringResource(R.string.notes_ai_preview))
        }
      } else {
        Text(aiPreview!!.summary.ifBlank { aiPreview!!.message },
          style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
        Column(modifier = Modifier.fillMaxWidth().weight(1f, fill = false).heightIn(max = 380.dp)
          .verticalScroll(rememberScrollState()).testTag("note-ai-preview"),
          verticalArrangement = Arrangement.spacedBy(8.dp)) {
          Text(stringResource(R.string.notes_ai_before),
            style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
          Surface(shape = themedCorners(14), color = MaterialTheme.colorScheme.surfaceContainerLow) {
            Box(Modifier.fillMaxWidth().padding(14.dp)) { MarkdownContent(aiPreview!!.originalMarkdown) }
          }
          Text(stringResource(R.string.notes_ai_after),
            style = MaterialTheme.typography.labelMedium,
            color = MaterialTheme.colorScheme.primary,
            modifier = Modifier.padding(top = 4.dp))
          Surface(shape = themedCorners(14), color = MaterialTheme.colorScheme.primaryContainer.copy(alpha = 0.45f)) {
            Box(Modifier.fillMaxWidth().padding(14.dp)) { MarkdownContent(aiPreview!!.proposedMarkdown) }
          }
        }
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
          FilledTonalButton(onClick = { aiPreview = null }, shape = CircleShape,
            modifier = Modifier.weight(1f).height(46.dp)) { Text(stringResource(R.string.notes_ai_retry)) }
          Button(onClick = {
            val proposal = aiPreview!!
            if (state.draft?.id == selectedId && state.draft?.markdown == proposal.originalMarkdown) {
              onApplyAi(proposal); aiOpen = false; editorOpen = true
            } else aiError = true
          }, shape = CircleShape, modifier = Modifier.weight(1f).height(46.dp).testTag("note-ai-apply")) {
            Text(stringResource(R.string.notes_ai_apply))
          }
        }
      }
      if (aiBusy) BrandLoadingIndicator(modifier = Modifier.fillMaxWidth())
      if (aiError) Text(stringResource(R.string.progress_load_failed),
        color = MaterialTheme.colorScheme.error)
    }
  }
  if (attachmentSheetOpen) XopcBottomSheet(XopcSheetPreset.Compact, onDismissRequest = { attachmentSheetOpen = false },
    modifier = Modifier.testTag("note-attachment-sheet")) {
    XopcSheetHeader(title = stringResource(R.string.notes_add_attachment), onClose = { attachmentSheetOpen = false })
    Column(modifier = Modifier.fillMaxWidth().padding(horizontal = 20.dp, vertical = 4.dp),
      verticalArrangement = Arrangement.spacedBy(8.dp)) {
      NoteSheetActionRow(R.drawable.action_photo, stringResource(R.string.assistant_action_photos),
        tag = "note-attachment-photo") {
        photoPicker.launch(PickVisualMediaRequest(ActivityResultContracts.PickVisualMedia.ImageOnly))
      }
      NoteSheetActionRow(R.drawable.action_folder, stringResource(R.string.assistant_action_local_files),
        tag = "note-attachment-file") {
        filePicker.launch(arrayOf("*/*"))
      }
      NoteSheetActionRow(R.drawable.action_microphone, stringResource(R.string.notes_create_voice),
        tag = "note-attachment-voice") {
        attachmentSheetOpen = false
        if (ContextCompat.checkSelfPermission(context, Manifest.permission.RECORD_AUDIO) ==
          PackageManager.PERMISSION_GRANTED) noteVoice.start()
        else noteVoicePermission.launch(Manifest.permission.RECORD_AUDIO)
      }
    }
  }
  if (noteVoice.phase != "idle") AlertDialog(onDismissRequest = noteVoice::cancel,
    modifier = Modifier.testTag("note-voice-record-dialog"),
    title = { Text(stringResource(R.string.notes_create_voice)) },
    text = { Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
      Text(when (noteVoice.phase) {
        "recording" -> stringResource(R.string.voice_recording_seconds, noteVoiceElapsed)
        "paused" -> stringResource(R.string.voice_recording_paused_seconds,
          noteVoice.elapsedSeconds)
        "ready" -> stringResource(R.string.voice_recorded_seconds, noteVoice.durationSeconds)
        "playing" -> stringResource(R.string.voice_playing)
        else -> stringResource(R.string.voice_record_error)
      })
      if (noteVoice.error.isNotBlank()) Text(noteVoice.error,
        color = MaterialTheme.colorScheme.error)
      Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        if (noteVoice.phase == "recording" || noteVoice.phase == "paused") {
          OutlinedButton(onClick = if (noteVoice.phase == "recording")
            noteVoice::pauseRecording else noteVoice::resumeRecording,
            modifier = Modifier.testTag("note-voice-pause-resume")) {
            Text(stringResource(if (noteVoice.phase == "recording") R.string.voice_record_pause
              else R.string.voice_record_resume))
          }
          Button(onClick = noteVoice::stopRecording,
            modifier = Modifier.testTag("note-voice-stop")) {
            Text(stringResource(R.string.voice_record_stop))
          }
        }
        if (noteVoice.phase == "ready") {
          OutlinedButton(onClick = noteVoice::play) { Text(stringResource(R.string.voice_preview)) }
          Button(onClick = { scope.launch {
            noteVoiceBusy = true; attachmentError = false
            try {
              val (bytes, seconds) = kotlinx.coroutines.withContext(kotlinx.coroutines.Dispatchers.IO) {
                noteVoice.consume()
              }
              onAttachVoice(bytes, seconds)
              noteVoice.cancel()
            } catch (_: Exception) { attachmentError = true }
            noteVoiceBusy = false
          } }, enabled = !noteVoiceBusy, modifier = Modifier.testTag("note-voice-add")) {
            Text(stringResource(R.string.voice_add_attachment))
          }
        }
        if (noteVoice.phase == "playing") OutlinedButton(onClick = noteVoice::stopPlayback) {
          Text(stringResource(R.string.voice_record_stop))
        }
      }
      if (attachmentError) Text(stringResource(R.string.notes_attachment_error),
        color = MaterialTheme.colorScheme.error)
    } }, confirmButton = { TextButton(onClick = noteVoice::cancel) {
      Text(stringResource(R.string.progress_cancel))
    } })
  val detail = state.detail?.takeIf { it.id == selectedId }
  if (historyOpen && detail != null) XopcBottomSheet(XopcSheetPreset.Medium, onDismissRequest = { historyOpen = false },
    modifier = Modifier.testTag("note-history-sheet")) {
    BackHandler(enabled = historyTimestamp != null) {
      historyTimestamp = null
      onLoadHistory()
    }
    Column(modifier = Modifier.fillMaxWidth().heightIn(max = 560.dp)
      .padding(horizontal = 20.dp, vertical = 12.dp),
      verticalArrangement = Arrangement.spacedBy(12.dp)) {
      Text(stringResource(R.string.notes_history), style = MaterialTheme.typography.titleLarge)
      if (state.historyLoading || state.snapshotLoading || state.restoreBusy) {
        BrandLoadingPanel(modifier = Modifier.testTag("note-history-loading"))
      } else if (state.restoreError || state.snapshotError || state.historyError) {
        Text(stringResource(R.string.notes_history_error), color = MaterialTheme.colorScheme.error,
          modifier = Modifier.testTag("note-history-error"))
        OutlinedButton(onClick = {
          if (state.snapshotError && historyTimestamp != null) onLoadSnapshot(historyTimestamp!!)
          else onLoadHistory()
        }, modifier = Modifier.testTag("note-history-retry")) {
          Text(stringResource(R.string.progress_refresh))
        }
      } else if (state.snapshot?.noteId == detail.id) {

        Text(state.snapshot.title ?: detail.title, style = MaterialTheme.typography.titleMedium)
        Column(modifier = Modifier.weight(1f, fill = false)
          .verticalScroll(rememberScrollState()).testTag("note-history-preview")) {
          MarkdownContent(state.snapshot.markdown)
        }
        Button(onClick = { restoreConfirmOpen = true },
          modifier = Modifier.testTag("note-history-restore")) {
          Text(stringResource(R.string.notes_restore_version))
        }
      } else if (state.history.isEmpty()) {
        Text(stringResource(R.string.notes_history_empty), modifier = Modifier.testTag("note-history-empty"))
      } else {
        LazyColumn(modifier = Modifier.heightIn(max = 420.dp)) {
          items(state.history, key = { it.timestamp }) { entry ->
            TextButton(onClick = {
              historyTimestamp = entry.timestamp
              onLoadSnapshot(entry.timestamp)
            }, modifier = Modifier.fillMaxWidth().testTag("note-history-${entry.timestamp}")) {
              Text("${DateFormat.getDateTimeInstance().format(Date(entry.timestamp))} · " +
                entry.snippet.ifBlank { entry.trigger })
            }
          }
        }
      }
    }
  }
  if (restoreConfirmOpen) XopcConfirmDialog(
    onDismiss = { restoreConfirmOpen = false },
    onConfirm = { restoreConfirmOpen = false; onRestoreSnapshot() },
    title = stringResource(R.string.notes_restore_version),
    message = stringResource(R.string.notes_restore_confirm),
    confirmLabel = stringResource(R.string.notes_restore_version),
    confirmTag = "note-history-confirm-restore",
  )
  if (deleteConfirmOpen) XopcConfirmDialog(
    onDismiss = { deleteConfirmOpen = false },
    onConfirm = { deleteConfirmOpen = false; onDeleteNote() },
    title = stringResource(R.string.notes_delete),
    message = stringResource(R.string.notes_delete_confirm),
    confirmLabel = stringResource(R.string.notes_delete),
    destructive = true,
    confirmTag = "note-confirm-delete",
    cancelTag = "note-cancel-delete",
  )
  if (moreOpen && detail != null) XopcBottomSheet(XopcSheetPreset.Compact, onDismissRequest = { moreOpen = false },
    modifier = Modifier.testTag("note-more-sheet")) {
    XopcSheetHeader(title = stringResource(R.string.notes_more), onClose = { moreOpen = false })
    Column(modifier = Modifier.fillMaxWidth().padding(horizontal = 20.dp, vertical = 4.dp),
      verticalArrangement = Arrangement.spacedBy(8.dp)) {
      NoteSheetActionRow(R.drawable.action_pin,
        stringResource(if (detail.pinned) R.string.notes_unpin else R.string.notes_pin),
        enabled = !state.metadataBusy, tag = "note-toggle-pin") {
        moreOpen = false
        onMetadataChange(NoteMetadataPatch(pinned = !detail.pinned))
      }
      NoteSheetActionRow(R.drawable.message_bookmark, stringResource(R.string.notes_manage_tags),
        enabled = !state.metadataBusy, tag = "note-manage-tags") {
        tagsText = detail.tags.joinToString(", ")
        moreOpen = false
        tagsOpen = true
      }
      if (detail.status != "archived") NoteSheetActionRow(R.drawable.action_folder,
        stringResource(R.string.notes_archive), enabled = !state.metadataBusy, tag = "note-archive") {
        moreOpen = false
        onMetadataChange(NoteMetadataPatch(status = "archived"))
      }
      NoteSheetActionRow(R.drawable.message_share, stringResource(R.string.notes_share),
        enabled = !state.shareBusy && !state.metadataBusy && !state.deleteBusy &&
          !state.draftSaving && state.draft?.takeIf {
            it.id == detail.id && it.version != state.draftSyncedVersion
          } == null,
        tag = "note-share") {
        moreOpen = false
        onShareNote()
      }
      NoteSheetActionRow(R.drawable.action_delete, stringResource(R.string.notes_delete),
        enabled = !state.deleteBusy && !state.metadataBusy, destructive = true, tag = "note-delete") {
        moreOpen = false
        deleteConfirmOpen = true
      }
    }
  }
  if (state.shareBusy) AlertDialog(onDismissRequest = {},
    title = { Text(stringResource(R.string.notes_share)) },
    text = { BrandLoadingPanel(modifier = Modifier.testTag("note-share-loading"), minHeight = 120.dp) },
    confirmButton = {})
  if (state.shareError) AlertDialog(onDismissRequest = onDismissShare,
    title = { Text(stringResource(R.string.notes_share)) },
    text = { Text(stringResource(R.string.notes_share_error)) },
    confirmButton = { TextButton(onClick = onDismissShare) { Text(stringResource(R.string.assistant_close)) } })
  val share = state.share?.takeIf { it.noteId == selectedId && detail?.id == selectedId }
  if (share != null) XopcBottomSheet(XopcSheetPreset.Medium, onDismissRequest = onDismissShare,
    modifier = Modifier.testTag("note-share-sheet")) {
    Column(modifier = Modifier.fillMaxWidth().verticalScroll(rememberScrollState()).padding(20.dp),
      verticalArrangement = Arrangement.spacedBy(12.dp)) {
      Text(share.title, style = MaterialTheme.typography.titleLarge)
      Text(share.url, color = MaterialTheme.colorScheme.primary,
        modifier = Modifier.testTag("note-share-url"))
      Text(stringResource(when (share.reachability) {
        "public" -> R.string.notes_share_public
        "lan" -> R.string.notes_share_lan
        else -> R.string.notes_share_local
      }))
      if (share.hint.isNotBlank()) Text(share.hint)
      Text(stringResource(R.string.notes_share_expires, share.expiresAt))
      Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        OutlinedButton(onClick = {
          (context.getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager)
            .setPrimaryClip(ClipData.newPlainText(share.title, share.url))
        }, modifier = Modifier.testTag("note-share-copy")) { Text(stringResource(R.string.notes_share_copy)) }
        Button(onClick = {
          val send = Intent(Intent.ACTION_SEND).apply {
            type = "text/plain"
            putExtra(Intent.EXTRA_TEXT, "${share.title}\n${share.url}")
          }
          context.startActivity(Intent.createChooser(send, null))
        }, modifier = Modifier.testTag("note-share-system")) {
          Text(stringResource(R.string.notes_share_system))
        }
      }
    }
  }
  if (tagsOpen && detail != null) AlertDialog(onDismissRequest = { tagsOpen = false },
    title = { Text(stringResource(R.string.notes_manage_tags)) },
    text = { Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
      OutlinedTextField(tagsText, { tagsText = it.take(51_300) },
        modifier = Modifier.testTag("note-tags-input"),
        placeholder = { Text(stringResource(R.string.notes_tags_hint)) })
      if (!tagsValid) Text(stringResource(R.string.notes_tags_limit),
        color = MaterialTheme.colorScheme.error, modifier = Modifier.testTag("note-tags-limit"))
    } },
    confirmButton = { TextButton(onClick = {
      tagsOpen = false
      onMetadataChange(NoteMetadataPatch(tags = parsedTags))
    }, enabled = !state.metadataBusy && tagsValid, modifier = Modifier.testTag("note-tags-save")) {
      Text(stringResource(R.string.notes_tags_save))
    } },
    dismissButton = { TextButton(onClick = { tagsOpen = false }) {
      Text(stringResource(R.string.assistant_close))
    } })
}

@Composable
internal fun NoteDraftContent(state: NotesUiState, onChange: (String, String) -> Unit,
  onSave: () -> Unit, modifier: Modifier = Modifier,
  onResolveConflict: (Boolean) -> Unit = {}, onAddAttachment: () -> Unit = {},
  attachmentBusy: Boolean = false, attachmentError: Boolean = false) {
  val draft = state.draft
  val syntaxColor = MaterialTheme.colorScheme.onSurfaceVariant
  val editFormatting = remember(syntaxColor) {
    VisualTransformation { source ->
      val formatted = buildAnnotatedString {
        append(source)
        NOTE_EDITOR_HEADING.findAll(source.text).forEach { match ->
          val end = match.range.last + 1
          val titleStart = source.text.indexOf(' ', match.range.first + match.value.indexOf('#')) + 1
          addStyle(SpanStyle(fontWeight = FontWeight.Bold), titleStart, end)
          addStyle(SpanStyle(color = syntaxColor), match.range.first, titleStart)
        }
        NOTE_INLINE_EMPHASIS.findAll(source.text).forEach { match ->
          val text = match.groups[2] ?: match.groups[3] ?: return@forEach
          val end = text.range.last + 1
          addStyle(if (match.groups[2] != null) SpanStyle(fontWeight = FontWeight.Bold)
            else SpanStyle(fontStyle = FontStyle.Italic), text.range.first, end)
          addStyle(SpanStyle(color = syntaxColor), match.range.first, text.range.first)
          addStyle(SpanStyle(color = syntaxColor), end, match.range.last + 1)
        }
      }
      TransformedText(formatted, OffsetMapping.Identity)
    }
  }
  var bodyValue by remember(draft?.id) { mutableStateOf(TextFieldValue(draft?.markdown.orEmpty())) }
  var preview by remember(draft?.id) { mutableStateOf(false) }
  var undo by remember(draft?.id) { mutableStateOf<List<String>>(emptyList()) }
  var redo by remember(draft?.id) { mutableStateOf<List<String>>(emptyList()) }
  if (draft != null && bodyValue.text != draft.markdown) {
    bodyValue = bodyValue.copy(text = draft.markdown,
      selection = TextRange(bodyValue.selection.start.coerceAtMost(draft.markdown.length)))
  }
  fun updateBody(value: TextFieldValue, recordHistory: Boolean = true) {
    val current = draft ?: return
    if (value.text != current.markdown) {
      if (recordHistory) { undo = (undo + current.markdown).takeLast(100); redo = emptyList() }
      onChange(current.title, value.text)
    }
    bodyValue = value
  }
  fun insertMarkdown(prefix: String, suffix: String = "") {
    val start = bodyValue.selection.min
    val end = bodyValue.selection.max
    val selected = bodyValue.text.substring(start, end)
    val replacement = prefix + selected + suffix
    val text = bodyValue.text.replaceRange(start, end, replacement)
    val caret = if (selected.isEmpty()) start + prefix.length else start + replacement.length
    updateBody(TextFieldValue(text, TextRange(caret)))
  }
  fun formatLine(prefix: String) {
    val selection = bodyValue.selection
    val start = bodyValue.text.lastIndexOf('\n', selection.min - 1) + 1
    val existing = NOTE_LINE_PREFIX.find(bodyValue.text.substring(start))?.value.orEmpty()
    val replacement = if (existing == prefix) "" else prefix
    val text = bodyValue.text.replaceRange(start, start + existing.length, replacement)
    val delta = replacement.length - existing.length
    val selectionStart = maxOf(start + replacement.length, selection.start + delta)
    val selectionEnd = maxOf(start + replacement.length, selection.end + delta)
    updateBody(TextFieldValue(text, TextRange(selectionStart, selectionEnd)))
  }
  Column(modifier = modifier,
    verticalArrangement = Arrangement.spacedBy(12.dp)) {
    if (draft == null) {
      if (state.draftError) Text(stringResource(R.string.notes_draft_error),
        color = MaterialTheme.colorScheme.error)
      else BrandLoadingPanel(modifier = Modifier.testTag("notes-draft-loading"))
      return@Column
    }
    val titleHint = stringResource(R.string.notes_title)
    BasicTextField(draft.title, { onChange(it, draft.markdown) },
      modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp).testTag("notes-draft-title"),
      textStyle = MaterialTheme.typography.headlineSmall.copy(
        color = MaterialTheme.colorScheme.onSurface, fontWeight = FontWeight.Bold),
      singleLine = true, enabled = !(state.draftSaving && state.draftConflict != null),
      decorationBox = { inner -> Box {
        if (draft.title.isEmpty()) Text(titleHint,
          style = MaterialTheme.typography.headlineSmall,
          color = MaterialTheme.colorScheme.onSurfaceVariant)
        inner()
      } })
    Surface(shape = themedCorners(12), color = MaterialTheme.colorScheme.surfaceContainerLow,
      modifier = Modifier.fillMaxWidth()) {
      Row(modifier = Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()).padding(horizontal = 4.dp, vertical = 3.dp),
        horizontalArrangement = Arrangement.spacedBy(2.dp), verticalAlignment = Alignment.CenterVertically) {
        val blocked = state.draftSaving && state.draftConflict != null
        val tool = Modifier.height(36.dp)
        TextButton(onClick = { preview = !preview }, contentPadding = PaddingValues(horizontal = 10.dp),
          modifier = tool.testTag("notes-preview-toggle")) {
          Text(stringResource(if (preview) R.string.notes_edit else R.string.notes_preview),
            style = MaterialTheme.typography.labelLarge)
        }
        if (!preview) {
          TextButton(onClick = {
            if (undo.isNotEmpty()) {
              val previous = undo.last(); undo = undo.dropLast(1)
              redo = (redo + bodyValue.text).takeLast(100)
              updateBody(TextFieldValue(previous, TextRange(previous.length)), false)
            }
          }, enabled = !blocked && undo.isNotEmpty(), contentPadding = PaddingValues(horizontal = 8.dp),
            modifier = tool.testTag("notes-undo")) { Text("↶") }
          TextButton(onClick = {
            if (redo.isNotEmpty()) {
              val next = redo.last(); redo = redo.dropLast(1)
              undo = (undo + bodyValue.text).takeLast(100)
              updateBody(TextFieldValue(next, TextRange(next.length)), false)
            }
          }, enabled = !blocked && redo.isNotEmpty(), contentPadding = PaddingValues(horizontal = 8.dp),
            modifier = tool.testTag("notes-redo")) { Text("↷") }
          listOf("B" to "**", "I" to "*").forEach { (label, marker) ->
            TextButton(onClick = { insertMarkdown(marker, marker) }, enabled = !blocked,
              contentPadding = PaddingValues(horizontal = 8.dp),
              modifier = tool.testTag("notes-format-${label.lowercase()}")) {
              Text(label, fontWeight = FontWeight.SemiBold)
            }
          }
          (1..3).forEach { level ->
            TextButton(onClick = { formatLine("#".repeat(level) + " ") }, enabled = !blocked,
              contentPadding = PaddingValues(horizontal = 8.dp),
              modifier = tool.testTag("notes-heading-$level")) { Text("H$level") }
          }
          listOf("•" to "- ", "1." to "1. ", "☐" to "- [ ] ", "❝" to "> ").forEach { (label, prefix) ->
            TextButton(onClick = { formatLine(prefix) }, enabled = !blocked,
              contentPadding = PaddingValues(horizontal = 8.dp), modifier = tool) { Text(label) }
          }
          listOf("</>" to "`code`", "🔗" to "[link](https://)", "—" to "\n---\n").forEach { (label, value) ->
            TextButton(onClick = { insertMarkdown(value) }, enabled = !blocked,
              contentPadding = PaddingValues(horizontal = 8.dp), modifier = tool) { Text(label) }
          }
        }
      }
    }
    if (preview) Column(modifier = Modifier.fillMaxWidth().weight(1f)
      .verticalScroll(rememberScrollState())
      .testTag("notes-draft-preview")) {
      MarkdownContent(bodyValue.text)
    } else BasicTextField(bodyValue, { updateBody(it) },
      visualTransformation = editFormatting,
      modifier = Modifier.fillMaxWidth().weight(1f).testTag("notes-draft-body")
        .padding(horizontal = 2.dp, vertical = 8.dp),
      textStyle = MaterialTheme.typography.bodyLarge.copy(color = MaterialTheme.colorScheme.onSurface),
      cursorBrush = SolidColor(MaterialTheme.colorScheme.primary),
      enabled = !(state.draftSaving && state.draftConflict != null),
      decorationBox = { inner -> Box {
        if (bodyValue.text.isEmpty()) Text(stringResource(R.string.notes_body),
          style = MaterialTheme.typography.bodyLarge,
          color = MaterialTheme.colorScheme.onSurfaceVariant)
        inner()
      } })
    if (state.draftError) Text(stringResource(R.string.notes_draft_error),
      color = MaterialTheme.colorScheme.error, modifier = Modifier.testTag("notes-draft-error"))
    if (attachmentError) Text(stringResource(R.string.notes_attachment_error),
      color = MaterialTheme.colorScheme.error, modifier = Modifier.testTag("note-attachment-error"))
    if (state.draftLimitReached) Text(stringResource(R.string.notes_draft_limit),
      color = MaterialTheme.colorScheme.error, modifier = Modifier.testTag("notes-draft-limit"))
    val conflict = state.draftConflict?.takeIf { it.id == draft.id }
    if (conflict != null) {
      Card(modifier = Modifier.fillMaxWidth().testTag("notes-conflict")) {
        Column(modifier = Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
          Text(stringResource(R.string.notes_conflict_title),
            style = MaterialTheme.typography.titleMedium, color = MaterialTheme.colorScheme.error)
          Text(stringResource(R.string.notes_conflict_help))
          Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            OutlinedButton(onClick = { onResolveConflict(false) }, enabled = !state.draftSaving,
              modifier = Modifier.testTag("notes-use-remote")) {
              Text(stringResource(R.string.notes_use_remote))
            }
            Button(onClick = { onResolveConflict(true) }, enabled = !state.draftSaving,
              modifier = Modifier.testTag("notes-keep-local")) {
              Text(stringResource(R.string.notes_keep_local))
            }
          }
        }
      }
    }
    else Text(stringResource(when {
      draft.version == state.draftSyncedVersion -> R.string.notes_synced
      state.draftSaving -> R.string.notes_syncing
      draft.version == state.draftSavedVersion -> R.string.notes_saved_locally
      else -> R.string.notes_saving_locally
    }),
      style = MaterialTheme.typography.bodySmall)
    Row(modifier = Modifier.fillMaxWidth().padding(bottom = 8.dp), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
      FilledTonalButton(onClick = onAddAttachment,
        enabled = !attachmentBusy && !state.draftSaving &&
          (draft.title.isNotBlank() || draft.markdown.isNotBlank()),
        shape = CircleShape,
        modifier = Modifier.weight(1f).height(46.dp).testTag("note-add-attachment")) {
        Text(stringResource(R.string.notes_add_attachment), maxLines = 1, overflow = TextOverflow.Ellipsis)
      }
      Button(onClick = onSave, enabled = conflict == null &&
        (draft.title.isNotBlank() || draft.markdown.isNotBlank() ||
          draft.version == state.draftSyncedVersion),
        shape = CircleShape,
        modifier = Modifier.weight(1f).height(46.dp).testTag("notes-draft-save"),
        colors = ButtonDefaults.buttonColors(containerColor = MaterialTheme.colorScheme.primary,
          contentColor = MaterialTheme.colorScheme.onPrimary)) {
        Text(stringResource(R.string.notes_save), maxLines = 1)
      }
    }
  }
}

@Composable
internal fun NotesListContent(state: NotesUiState, search: String, onSearchChange: (String) -> Unit,
  onSubmit: () -> Unit, onStatus: (String) -> Unit, onOpen: (String) -> Unit,
  onLoadMore: () -> Unit, modifier: Modifier = Modifier, onOpenDraft: (String) -> Unit = {},
  searchOpen: Boolean = false, listState: LazyListState = rememberLazyListState(),
  filtersOpen: MutableState<Boolean> = rememberSaveable { mutableStateOf(false) },
  bottomContentPadding: Dp = 20.dp, pendingVoiceCount: Int = 0, onRecoverVoice: () -> Unit = {}) {
  val motionAllowed = rememberMotionAllowed()
  Column(modifier = modifier, verticalArrangement = Arrangement.spacedBy(12.dp)) {
    androidx.compose.animation.AnimatedVisibility(
      visible = searchOpen,
      enter = xopcExpandPanelEnter(motionAllowed, Alignment.Top),
      exit = xopcExpandPanelExit(motionAllowed, Alignment.Top),
    ) {
      XopcPageSearchField(
        query = search,
        onQueryChange = onSearchChange,
        placeholder = stringResource(R.string.notes_search),
        tag = "notes-search",
        maxLength = 4096,
        onSearch = onSubmit,
        trailingAction = {
          IconButton(onClick = onSubmit, enabled = !state.loading,
            modifier = Modifier.size(48.dp).testTag("notes-refresh")) {
            Icon(painterResource(R.drawable.action_search), stringResource(R.string.notes_search))
          }
        },
      )
    }
    XopcPullToRefreshBox(
      isRefreshing = state.loading && state.items.isNotEmpty(),
      onRefresh = onSubmit,
      modifier = Modifier.weight(1f).fillMaxWidth(),
    ) {
    LazyColumn(state = listState, modifier = Modifier.fillMaxSize().testTag("notes-list"),
      verticalArrangement = Arrangement.spacedBy(8.dp),
      contentPadding = PaddingValues(bottom = bottomContentPadding)) {
      if (pendingVoiceCount > 0) item(key = "voice-recovery") {
        Surface(onClick = onRecoverVoice, modifier = Modifier.fillMaxWidth().testTag("notes-recover-voice"),
          shape = themedCorners(14), color = MaterialTheme.colorScheme.surfaceContainer) {
          Row(Modifier.padding(12.dp), horizontalArrangement = Arrangement.spacedBy(12.dp),
            verticalAlignment = Alignment.CenterVertically) {
            Surface(shape = themedCorners(8), color = MaterialTheme.colorScheme.primaryContainer) {
              Box(Modifier.size(32.dp), contentAlignment = Alignment.Center) {
                Icon(painterResource(R.drawable.action_microphone), contentDescription = null,
                  tint = MaterialTheme.colorScheme.onPrimaryContainer, modifier = Modifier.size(18.dp))
              }
            }
            Text(stringResource(R.string.voice_note_pending), style = MaterialTheme.typography.titleSmall,
              modifier = Modifier.weight(1f))
            Text(pendingVoiceCount.toString(), style = MaterialTheme.typography.labelMedium,
              color = MaterialTheme.colorScheme.onSurfaceVariant)
            Icon(painterResource(R.drawable.action_chevron_right), contentDescription = null,
              tint = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.size(16.dp))
          }
        }
      }
      if (state.loading && state.items.isEmpty()) item {
        XopcListSkeleton(modifier = Modifier.testTag("notes-loading"), rows = 4)
      }
      if (state.listError) item {
        XopcErrorState(
          message = stringResource(R.string.progress_load_failed),
          retryLabel = stringResource(R.string.progress_refresh),
          onRetry = onSubmit,
          retryTag = "notes-retry",
        )
      }
      if (!state.loading && !state.listError && state.items.isEmpty() && state.drafts.isEmpty()) item {
        XopcEmptyState(
          message = stringResource(R.string.notes_empty),
          modifier = Modifier.testTag("notes-empty"),
        )
      }
      items(state.drafts, key = { "draft-${it.id}" }) { draft ->
        NoteDraftCard(draft, onOpenDraft)
      }
      items(state.items, key = { it.id }) { note -> NoteCard(note, onOpen) }
      if (state.hasMore) item {
        OutlinedButton(onClick = onLoadMore, enabled = !state.loadingMore,
          modifier = Modifier.fillMaxWidth().testTag("notes-load-more")) {
          if (state.loadingMore) BrandLoadingIndicator(extent = 20.dp)
          Text(stringResource(R.string.notes_load_more))
        }
      }
      if (state.moreError) item {
        XopcInlineBanner(
          message = stringResource(R.string.notes_more_error),
          tone = XopcBannerTone.Danger,
          modifier = Modifier.testTag("notes-more-error"),
        )
      }
    }
    }
  }
}

@Composable
private fun NotesFilesContent(spaces: List<ManagedFileSpace>, items: List<ManagedFile>,
  selected: ManagedFile?, content: ByteArray?, loading: Boolean, error: Boolean,
  onRetry: () -> Unit, onOpenSpace: (ManagedFileSpace) -> Unit,
  onOpenFile: (ManagedFile) -> Unit, modifier: Modifier = Modifier,
  search: String = "", onSearchChange: (String) -> Unit = {}) {
  Column(modifier = modifier, verticalArrangement = Arrangement.spacedBy(12.dp)) {
    if (selected == null) {
      OutlinedTextField(value = search, onValueChange = { onSearchChange(it.take(200)) },
        modifier = Modifier.fillMaxWidth().testTag("notes-files-search"),
        placeholder = { Text(stringResource(R.string.notes_search_files)) }, singleLine = true)
    }
    if (error) OutlinedButton(onClick = onRetry, modifier = Modifier.testTag("notes-files-retry")) {
      Text(stringResource(R.string.progress_load_failed))
    }
    if (selected != null) {
      Text(selected.name, style = MaterialTheme.typography.titleLarge,
        modifier = Modifier.testTag("notes-file-title"))
      Text(selected.relativePath, style = MaterialTheme.typography.bodySmall,
        color = MaterialTheme.colorScheme.onSurfaceVariant)
      val isBitmap = isBitmapPreview(selected.name, selected.mimeType)
      val decodedBitmap by produceState<Pair<Boolean, android.graphics.Bitmap?>>(false to null, content, isBitmap) {
        if (content != null && isBitmap) {
          value = true to kotlinx.coroutines.withContext(kotlinx.coroutines.Dispatchers.Default) {
            decodeChatThumbnail(content, 2048)
          }
        } else {
          value = false to null
        }
      }
      val bitmap = decodedBitmap.second
      if (content != null && isBitmap && !decodedBitmap.first) {
        Box(Modifier.fillMaxWidth().weight(1f), contentAlignment = Alignment.Center) {
          BrandLoadingIndicator(extent = 28.dp, modifier = Modifier.testTag("notes-files-loading"))
        }
      } else if (bitmap != null) Image(bitmap.asImageBitmap(), selected.name,
        modifier = Modifier.fillMaxWidth().weight(1f).testTag("notes-file-image"),
        contentScale = ContentScale.Fit)
      else if (content != null) FilePreviewContent(selected.name, selected.mimeType, content,
        modifier = Modifier.fillMaxWidth().weight(1f).testTag("notes-file-preview"))
      else if (loading) Box(Modifier.fillMaxWidth().weight(1f), contentAlignment = Alignment.Center) {
        BrandLoadingIndicator(extent = 28.dp, modifier = Modifier.testTag("notes-files-loading"))
      }
      else Text(stringResource(R.string.notes_file_preview_unavailable),
        color = MaterialTheme.colorScheme.onSurfaceVariant)
    } else if (loading && spaces.isEmpty() && items.isEmpty()) {
      Box(Modifier.fillMaxWidth().weight(1f), contentAlignment = Alignment.Center) {
        BrandLoadingIndicator(extent = 28.dp, modifier = Modifier.testTag("notes-files-loading"))
      }
    } else LazyColumn(modifier = Modifier.weight(1f),
      verticalArrangement = Arrangement.spacedBy(10.dp)) {
      if (spaces.isNotEmpty()) {
        item { Text(stringResource(R.string.notes_file_spaces), style = MaterialTheme.typography.titleSmall) }
        items(spaces, key = { "space-${it.id}" }) { space ->
          Card(onClick = { onOpenSpace(space) }, modifier = Modifier.fillMaxWidth()
            .heightIn(min = 56.dp).testTag("notes-space-${space.id}")) {
            Row(modifier = Modifier.fillMaxWidth().padding(16.dp),
              horizontalArrangement = Arrangement.spacedBy(12.dp)) {
              Icon(painterResource(R.drawable.action_folder), contentDescription = null)
              Text(space.title, modifier = Modifier.weight(1f))
              ActionIcon(R.drawable.action_chevron_right, size = 16.dp)
            }
          }
        }
      }
      if (items.isNotEmpty()) {
        item { Text(stringResource(R.string.notes_file_items), style = MaterialTheme.typography.titleSmall) }
        items(items, key = { "file-${it.id}" }) { file -> ManagedFileCard(file, onOpenFile) }
      }
      if (!loading && !error && spaces.isEmpty() && items.isEmpty()) item {
        Text(stringResource(R.string.notes_files_empty),
          color = MaterialTheme.colorScheme.onSurfaceVariant)
      }
    }
  }
}

@Composable
private fun ManagedFileCard(file: ManagedFile, onOpen: (ManagedFile) -> Unit) {
  Card(onClick = { onOpen(file) }, modifier = Modifier.fillMaxWidth().heightIn(min = 56.dp)
    .testTag("notes-file-${file.id}")) {
    Row(modifier = Modifier.fillMaxWidth().padding(14.dp),
      horizontalArrangement = Arrangement.spacedBy(12.dp), verticalAlignment = Alignment.CenterVertically) {
      Icon(painterResource(if (file.kind == "directory") R.drawable.action_folder else R.drawable.tab_notes),
        contentDescription = null, modifier = Modifier.size(20.dp))
      Column(modifier = Modifier.weight(1f)) {
        Text(file.name, maxLines = 1, overflow = TextOverflow.Ellipsis)
        Text(file.relativePath, maxLines = 1, overflow = TextOverflow.Ellipsis,
          style = MaterialTheme.typography.bodySmall,
          color = MaterialTheme.colorScheme.onSurfaceVariant)
      }
      ActionIcon(R.drawable.action_chevron_right, size = 16.dp)
    }
  }
}

@Composable
private fun NoteDraftCard(draft: NoteDraft, onOpen: (String) -> Unit) {
  Card(onClick = { onOpen(draft.id) }, modifier = Modifier.fillMaxWidth().testTag("note-draft-${draft.id}")) {
    Column(modifier = Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(5.dp)) {
      Text(draft.title.ifBlank { stringResource(R.string.notes_untitled) },
        style = MaterialTheme.typography.titleMedium, maxLines = 1, overflow = TextOverflow.Ellipsis)
      Text(stringResource(R.string.notes_local_draft), style = MaterialTheme.typography.bodySmall,
        color = MaterialTheme.colorScheme.primary)
      if (draft.markdown.isNotBlank()) MarkdownContent(draft.markdown.take(500),
        modifier = Modifier.fillMaxWidth().testTag("note-draft-preview"), maxLines = 2)
    }
  }
}

@Composable
private fun NoteSheetActionRow(iconRes: Int, label: String, enabled: Boolean = true,
  destructive: Boolean = false, tag: String = "", onClick: () -> Unit) {
  val contentColor = if (destructive) MaterialTheme.colorScheme.error else MaterialTheme.colorScheme.onSurface
  val containerColor = if (destructive) MaterialTheme.colorScheme.errorContainer.copy(alpha = 0.45f)
    else MaterialTheme.colorScheme.surfaceContainerLow
  Surface(onClick = onClick, enabled = enabled, shape = themedCorners(14), color = containerColor,
    modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp).then(if (tag.isNotEmpty()) Modifier.testTag(tag) else Modifier)) {
    Row(Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 12.dp),
      horizontalArrangement = Arrangement.spacedBy(12.dp), verticalAlignment = Alignment.CenterVertically) {
      ActionIcon(iconRes, size = 18.dp, color = contentColor)
      Text(label, style = MaterialTheme.typography.bodyLarge, fontWeight = FontWeight.Medium,
        color = contentColor, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f))
    }
  }
}

@Composable
private fun NoteCard(note: NoteSummary, onOpen: (String) -> Unit) {
  val voice = note.kind == "voice"
  Card(onClick = { onOpen(note.id) }, modifier = Modifier.fillMaxWidth().heightIn(min = if (voice) 72.dp else 84.dp)
    .testTag("note-${note.id}"), shape = themedCorners(16),
    colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceContainerLow)) {
    Row(modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 14.dp),
      horizontalArrangement = Arrangement.spacedBy(12.dp), verticalAlignment = Alignment.CenterVertically) {
      if (voice) Surface(shape = themedCorners(10), color = MaterialTheme.colorScheme.primaryContainer) {
        Box(Modifier.size(36.dp), contentAlignment = Alignment.Center) {
          Icon(painterResource(R.drawable.action_microphone), contentDescription = null,
            tint = MaterialTheme.colorScheme.primary, modifier = Modifier.size(18.dp))
        }
      }
      Column(modifier = Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(5.dp)) {
        val title = if (voice) voiceRecordingTitle(note.title) else note.title.ifBlank { stringResource(R.string.notes_untitled) }
        Row(horizontalArrangement = Arrangement.spacedBy(6.dp), verticalAlignment = Alignment.CenterVertically) {
          if (note.pinned) {
            ActionIcon(R.drawable.action_pin, size = 14.dp, color = MaterialTheme.colorScheme.primary)
          }
          Text(title, style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Medium,
            maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f))
        }
        if (note.snippet.isNotBlank()) Text(note.snippet, maxLines = 2,
          overflow = TextOverflow.Ellipsis, style = MaterialTheme.typography.bodyMedium.copy(lineHeight = 20.sp),
          color = MaterialTheme.colorScheme.onSurfaceVariant)
        val statusLabel = noteStatusLabel(note.status)
        val date = if (voice) recordingDate(note.updatedAt) else DateFormat.getDateInstance().format(Date(note.updatedAt))
        val meta = buildString {
          append(date)
          append(" · ")
          append(statusLabel)
          if (note.projectNames.isNotEmpty()) {
            append(" · ")
            append(note.projectNames.joinToString(" · "))
          }
        }
        Text(meta, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant,
          maxLines = 1, overflow = TextOverflow.Ellipsis)
        if (note.tags.isNotEmpty()) Text(note.tags.take(2).joinToString("  ") { "#$it" },
          style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.primary,
          maxLines = 1, overflow = TextOverflow.Ellipsis)
      }
      ActionIcon(R.drawable.action_chevron_right, color = MaterialTheme.colorScheme.onSurfaceVariant, size = 14.dp)
    }
  }
}

@Composable
internal fun NotesDetailContent(state: NotesUiState, id: String, onRetry: () -> Unit,
  modifier: Modifier = Modifier, onEdit: () -> Unit = {}, onMore: () -> Unit = {},
  onHistory: () -> Unit = {}, onAi: () -> Unit = {}, onContinueChat: () -> Unit = {},
  chatBusy: Boolean = false, onOpenLink: (String) -> Unit = {},
  onPreviewAttachment: (NoteAttachment) -> Unit = {}, scroll: ScrollState = rememberScrollState()) {
  val note = state.detail.takeIf { it?.id == id }
  val reader = remember(id) { MarkdownNoteReadingState() }
  var readerOpen by rememberSaveable(id) { mutableStateOf(false) }
  if (readerOpen) NoteReadingDialog(reader, onDismiss = { readerOpen = false })
  Box(modifier = modifier.fillMaxWidth().testTag("note-detail")) {
    Column(modifier = Modifier.fillMaxSize().verticalScroll(scroll)
      .padding(top = 8.dp, bottom = 84.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
      if (state.detailLoading && note == null) BrandLoadingPanel(
        modifier = Modifier.testTag("note-detail-loading"))
      if (state.detailError) OutlinedButton(onClick = onRetry,
        modifier = Modifier.testTag("note-detail-retry")) {
        Text(stringResource(R.string.progress_load_failed))
      }
      if (state.metadataError) Text(stringResource(R.string.notes_metadata_error),
        color = MaterialTheme.colorScheme.error, modifier = Modifier.testTag("note-metadata-error"))
      if (state.deleteError) Text(stringResource(R.string.notes_delete_error),
        color = MaterialTheme.colorScheme.error, modifier = Modifier.testTag("note-delete-error"))
      if (state.metadataBusy) BrandLoadingIndicator(
        modifier = Modifier.fillMaxWidth().testTag("note-metadata-busy"))
      if (state.deleteBusy) BrandLoadingIndicator(
        modifier = Modifier.fillMaxWidth().testTag("note-delete-busy"))
      if (note != null) NoteBody(note, onOpenLink, onPreviewAttachment, reader, { readerOpen = true })
    }
    if (note != null) {
      Surface(
        modifier = Modifier.align(Alignment.BottomCenter).fillMaxWidth()
          .padding(bottom = 8.dp).testTag("note-detail-toolbar"),
        shape = CircleShape,
        color = MaterialTheme.colorScheme.surfaceContainerHigh,
        shadowElevation = 3.dp,
      ) {
        Row(
          modifier = Modifier.fillMaxWidth().padding(horizontal = 6.dp, vertical = 4.dp),
          horizontalArrangement = Arrangement.spacedBy(2.dp),
          verticalAlignment = Alignment.CenterVertically,
        ) {
          NoteDetailAction(R.drawable.action_new_chat, stringResource(R.string.notes_edit), onEdit,
            note.remoteVersion != null && !state.metadataBusy && !state.deleteBusy,
            emphasized = true, modifier = Modifier.weight(1f).testTag("note-detail-edit"))
          NoteDetailAction(R.drawable.action_lightbulb, stringResource(R.string.notes_ai_edit), onAi,
            note.remoteVersion != null && !state.metadataBusy && !state.deleteBusy,
            modifier = Modifier.weight(1f).testTag("note-detail-ai"))
          NoteDetailAction(R.drawable.action_refresh, stringResource(R.string.notes_history), onHistory,
            !state.metadataBusy && !state.deleteBusy,
            modifier = Modifier.weight(1f).testTag("note-detail-history"))
          NoteDetailAction(R.drawable.tab_conversations, stringResource(R.string.notes_continue_chat), onContinueChat,
            !chatBusy && !state.deleteBusy,
            modifier = Modifier.weight(1f).testTag("note-detail-chat"))
          NoteDetailAction(R.drawable.action_more_horizontal, stringResource(R.string.notes_more), onMore,
            note.remoteVersion != null && !state.metadataBusy && !state.deleteBusy,
            modifier = Modifier.weight(1f).testTag("note-detail-more"))
        }
      }
    }
  }
}

@Composable
private fun NoteDetailAction(iconRes: Int, label: String, onClick: () -> Unit,
  enabled: Boolean, emphasized: Boolean = false, modifier: Modifier = Modifier) {
  val tint = when {
    !enabled -> MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = XopcDesignTokens.DisabledAlpha)
    emphasized -> MaterialTheme.colorScheme.primary
    else -> MaterialTheme.colorScheme.onSurface
  }
  Surface(
    onClick = onClick,
    enabled = enabled,
    shape = CircleShape,
    color = if (emphasized && enabled) MaterialTheme.colorScheme.primaryContainer.copy(alpha = 0.65f)
      else androidx.compose.ui.graphics.Color.Transparent,
    modifier = modifier.height(50.dp),
  ) {
    Column(
      modifier = Modifier.fillMaxSize().padding(horizontal = 2.dp),
      horizontalAlignment = Alignment.CenterHorizontally,
      verticalArrangement = Arrangement.spacedBy(2.dp, Alignment.CenterVertically),
    ) {
      ActionIcon(iconRes, size = 18.dp, color = tint)
      Text(
        text = label,
        fontSize = 10.5.sp,
        lineHeight = 13.sp,
        fontWeight = if (emphasized) FontWeight.Medium else FontWeight.Normal,
        color = tint,
        maxLines = 1,
        softWrap = false,
        overflow = TextOverflow.Ellipsis,
      )
    }
  }
}

@Composable
private fun NoteBody(note: NoteDetail, onOpenLink: (String) -> Unit,
  onPreviewAttachment: (NoteAttachment) -> Unit, reader: MarkdownNoteReadingState,
  onReadingTools: () -> Unit) {
  Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp),
    verticalAlignment = Alignment.Top) {
    Text(note.title.ifBlank { stringResource(R.string.notes_untitled) },
      style = MaterialTheme.typography.headlineMedium, fontWeight = FontWeight.Bold,
      modifier = Modifier.weight(1f).testTag("note-detail-title"))
    if (reader.entries.isNotEmpty()) {
      Surface(onClick = onReadingTools, shape = CircleShape,
        color = MaterialTheme.colorScheme.surfaceContainerLow,
        modifier = Modifier.size(40.dp).testTag("note-reading-tools")) {
        Box(contentAlignment = Alignment.Center) {
          ActionIcon(R.drawable.action_search, size = 18.dp,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            contentDescription = stringResource(R.string.notes_reading_tools))
        }
      }
    }
  }
  Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp),
    verticalAlignment = Alignment.CenterVertically) {
    Text(DateFormat.getDateTimeInstance().format(Date(note.updatedAt)),
      style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant,
      modifier = Modifier.weight(1f))
    Surface(shape = CircleShape, color = MaterialTheme.colorScheme.surfaceContainerLow) {
      Text(noteStatusLabel(note.status), Modifier.padding(horizontal = 10.dp, vertical = 4.dp),
        style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
    }
  }
  if (note.tags.isNotEmpty()) Row(modifier = Modifier.horizontalScroll(rememberScrollState()),
    horizontalArrangement = Arrangement.spacedBy(6.dp)) {
    note.tags.forEach { tag ->
      Text("#$tag", style = MaterialTheme.typography.labelMedium,
        color = MaterialTheme.colorScheme.primary,
        modifier = Modifier.background(MaterialTheme.colorScheme.primaryContainer,
          CircleShape).padding(horizontal = 10.dp, vertical = 5.dp))
    }
  }
  if (note.attachments.isNotEmpty()) Row(modifier = Modifier.fillMaxWidth()
    .horizontalScroll(rememberScrollState()).testTag("note-attachments"),
    horizontalArrangement = Arrangement.spacedBy(8.dp)) {
    note.attachments.forEach { attachment ->
      Surface(onClick = { onPreviewAttachment(attachment) }, shape = themedCorners(12),
        color = MaterialTheme.colorScheme.surfaceContainerLow,
        modifier = Modifier.testTag("note-attachment-${attachment.id}")) {
        Row(Modifier.padding(horizontal = 12.dp, vertical = 10.dp),
          horizontalArrangement = Arrangement.spacedBy(6.dp), verticalAlignment = Alignment.CenterVertically) {
          ActionIcon(R.drawable.action_link, size = 15.dp, color = MaterialTheme.colorScheme.primary)
          Text(attachment.fileName, style = MaterialTheme.typography.labelLarge,
            maxLines = 1, overflow = TextOverflow.Ellipsis)
        }
      }
    }
  }
  if (note.markdown.isNotEmpty()) MarkdownContent(note.markdown,
    modifier = Modifier.fillMaxWidth().testTag("note-detail-body"), onOpenLink = onOpenLink, noteReader = reader)
  else Text(stringResource(R.string.notes_empty_body),
    style = MaterialTheme.typography.bodyLarge, color = MaterialTheme.colorScheme.onSurfaceVariant,
    modifier = Modifier.testTag("note-detail-body"))
}

@Composable
private fun NoteReadingDialog(reader: MarkdownNoteReadingState, onDismiss: () -> Unit) {
  var query by rememberSaveable { mutableStateOf("") }
  val entries = remember(reader.entries, query) {
    val search = query.trim()
    reader.entries.mapNotNull { entry ->
      if (search.isEmpty()) return@mapNotNull entry.takeIf { it.headingLevel > 0 }
      val index = entry.text.indexOf(search, ignoreCase = true)
      if (index == -1) return@mapNotNull null
      val start = (index - 48).coerceAtLeast(0)
      val end = (index + search.length + 72).coerceAtMost(entry.text.length)
      entry.copy(text = (if (start == 0) "" else "…") + entry.text.substring(start, end), headingLevel = 0)
    }
  }
  AlertDialog(onDismissRequest = onDismiss,
    title = { Text(stringResource(if (query.isBlank()) R.string.notes_outline else R.string.notes_find_results)) },
    text = {
      Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
        OutlinedTextField(query, { query = it }, singleLine = true,
          label = { Text(stringResource(R.string.notes_search_body)) },
          modifier = Modifier.fillMaxWidth().testTag("note-find-query"))
        if (entries.isEmpty()) {
          Text(stringResource(if (query.isBlank()) R.string.notes_no_headings else R.string.notes_no_matches))
        } else {
          LazyColumn(Modifier.heightIn(max = 320.dp)) {
            items(entries, key = { it.id }) { entry ->
              TextButton(onClick = { reader.jumpTo(entry.id); onDismiss() },
                modifier = Modifier.fillMaxWidth().testTag("note-find-result")
                  .padding(start = ((entry.headingLevel - 1).coerceAtLeast(0) * 8).dp)) {
                Text(entry.text, Modifier.fillMaxWidth(), maxLines = 3, overflow = TextOverflow.Ellipsis)
              }
            }
          }
        }
      }
    },
    confirmButton = { TextButton(onClick = onDismiss) { Text(stringResource(R.string.progress_cancel)) } })
}

@Composable
internal fun noteStatusLabel(status: String): String = stringResource(when (status) {
  "inbox" -> R.string.notes_inbox
  "processed" -> R.string.notes_processed
  "archived" -> R.string.notes_archived
  else -> R.string.notes_all
})
