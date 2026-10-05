package ai.xopc.mobile.ui.main

import ai.xopc.mobile.R
import ai.xopc.mobile.gateway.NoteDetail
import ai.xopc.mobile.gateway.NoteDraft
import ai.xopc.mobile.gateway.NoteMetadataPatch
import ai.xopc.mobile.gateway.NoteSummary
import ai.xopc.mobile.gateway.ManagedFile
import ai.xopc.mobile.gateway.ManagedFileSpace
import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import android.content.Intent
import android.graphics.BitmapFactory
import androidx.activity.compose.BackHandler
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
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.background
import androidx.compose.foundation.Image
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.FilterChip
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.Alignment
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.TextRange
import androidx.compose.ui.text.input.TextFieldValue
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.delay
import java.text.DateFormat
import java.util.Date

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
  onStartVoice: (() -> Unit)? = null,
  onNoteFileSpaces: suspend () -> List<ManagedFileSpace> = { emptyList() },
  onNoteFiles: suspend (String?, String, String) -> List<ManagedFile> = { _, _, _ -> emptyList() },
  onNoteFileText: suspend (String) -> String = { "" },
  onNoteFileContent: suspend (String) -> ByteArray = { byteArrayOf() },
  onTopLevelChange: (Boolean) -> Unit = {}) {
  val context = LocalContext.current
  var query by rememberSaveable(state.gatewayId) { mutableStateOf(state.search) }
  LaunchedEffect(query, state.gatewayId) {
    if (query.trim() != state.search) {
      delay(350)
      onSearch(query.trim(), state.status)
    }
  }
  var selectedId by rememberSaveable(state.gatewayId) { mutableStateOf<String?>(null) }
  var editorOpen by rememberSaveable(state.gatewayId) { mutableStateOf(false) }
  var creationSheetOpen by rememberSaveable(state.gatewayId) { mutableStateOf(false) }
  var fileBrowserOpen by rememberSaveable(state.gatewayId) { mutableStateOf(false) }
  var fileSpaceId by rememberSaveable(state.gatewayId) { mutableStateOf<String?>(null) }
  var filePath by rememberSaveable(state.gatewayId) { mutableStateOf("") }
  var selectedFile by remember(state.gatewayId) { mutableStateOf<ManagedFile?>(null) }
  var fileRefreshRevision by rememberSaveable(state.gatewayId) { mutableStateOf(0) }
  var fileSpaces by remember(state.gatewayId) { mutableStateOf<List<ManagedFileSpace>>(emptyList()) }
  var fileItems by remember(state.gatewayId) { mutableStateOf<List<ManagedFile>>(emptyList()) }
  var searchFiles by remember(state.gatewayId) { mutableStateOf<List<ManagedFile>>(emptyList()) }
  var fileText by remember(state.gatewayId) { mutableStateOf<String?>(null) }
  var fileImage by remember(state.gatewayId) { mutableStateOf<ByteArray?>(null) }
  var filesLoading by remember(state.gatewayId) { mutableStateOf(false) }
  var filesError by remember(state.gatewayId) { mutableStateOf(false) }
  LaunchedEffect(selectedId, editorOpen, fileBrowserOpen) {
    onTopLevelChange(selectedId == null && !editorOpen && !fileBrowserOpen)
  }
  LaunchedEffect(query, state.gatewayId) {
    if (query.isBlank()) searchFiles = emptyList()
    else {
      delay(350)
      searchFiles = runCatching { onNoteFiles(null, "", query.trim()) }.getOrDefault(emptyList())
    }
  }
  LaunchedEffect(fileBrowserOpen, fileSpaceId, filePath, fileRefreshRevision, state.gatewayId) {
    if (!fileBrowserOpen) return@LaunchedEffect
    filesLoading = true
    filesError = false
    runCatching {
      fileSpaces = onNoteFileSpaces()
      fileItems = onNoteFiles(fileSpaceId, filePath, "")
    }.onFailure { filesError = true }
    filesLoading = false
  }
  LaunchedEffect(selectedFile?.id) {
    fileText = null
    fileImage = null
    val file = selectedFile ?: return@LaunchedEffect
    if (file.mimeType.startsWith("text/") || file.mimeType in setOf("application/json", "application/xml")) {
      fileText = runCatching { onNoteFileText(file.id) }.getOrNull()
    } else if (file.mimeType.startsWith("image/") && file.mimeType != "image/svg+xml") {
      fileImage = runCatching { onNoteFileContent(file.id) }.getOrNull()
    }
  }
  var moreOpen by rememberSaveable(state.gatewayId) { mutableStateOf(false) }
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
      draft.title.isBlank() && draft.markdown.isBlank())) editorOpen = false
    else onSaveDraft()
  }
  BackHandler(enabled = editorOpen || selectedId != null) {
    if (editorOpen) closeEditor() else selectedId = null
  }
  BackHandler(enabled = fileBrowserOpen) {
    when {
      selectedFile != null -> selectedFile = null
      filePath.isNotEmpty() -> filePath = filePath.substringBeforeLast('/', "")
      fileSpaceId != null -> fileSpaceId = null
      else -> fileBrowserOpen = false
    }
  }
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
      if (selectedId == id) selectedId = null
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
    deleteConfirmOpen = false
    onDismissShare()
  }
  Column(modifier = Modifier.fillMaxSize().padding(insets).padding(horizontal = 20.dp, vertical = 12.dp),
    verticalArrangement = Arrangement.spacedBy(12.dp)) {
    Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
      Text(if (fileBrowserOpen) stringResource(R.string.notes_files) else stringResource(R.string.tab_notes),
        style = MaterialTheme.typography.headlineSmall, fontWeight = FontWeight.SemiBold)
      if (fileBrowserOpen || editorOpen || selectedId != null) TextButton(onClick = {
        if (fileBrowserOpen) {
          when {
            selectedFile != null -> selectedFile = null
            filePath.isNotEmpty() -> filePath = filePath.substringBeforeLast('/', "")
            fileSpaceId != null -> fileSpaceId = null
            else -> fileBrowserOpen = false
          }
        } else if (editorOpen) closeEditor() else selectedId = null
      },
        modifier = Modifier.testTag("notes-back")) { Text(stringResource(R.string.progress_back)) }
      else IconButton(onClick = { creationSheetOpen = true },
        enabled = !state.draftLoading && !state.draftSaving,
        modifier = Modifier.testTag("notes-new")) {
        Text("+", style = MaterialTheme.typography.headlineLarge)
      }
    }
    if (fileBrowserOpen) NotesFilesContent(fileSpaces, fileItems, selectedFile, fileText, fileImage,
      filesLoading, filesError, { fileRefreshRevision++ }, { space ->
        selectedFile = null; filePath = ""; fileSpaceId = space.id
      }, { file ->
        if (file.kind == "directory") { fileSpaceId = file.spaceId; filePath = file.relativePath }
        else selectedFile = file
      }, Modifier.weight(1f))
    else if (editorOpen) NoteDraftContent(state, onDraftChange, onSaveDraft,
      Modifier.weight(1f), onResolveConflict)
    else if (selectedId == null) {
      NotesListContent(state, query, { query = it },
      { onSearch(query.trim(), state.status) }, { status -> onSearch(query.trim(), status) },
      { id -> selectedId = id; onOpen(id) }, onLoadMore, Modifier.weight(1f),
      { id -> editorOpen = true; onOpenDraft(id) }, { fileBrowserOpen = true }, searchFiles,
      { file -> fileBrowserOpen = true; selectedFile = file })
    } else NotesDetailContent(state, selectedId!!, { onOpen(selectedId!!) }, Modifier.weight(1f),
      { editorOpen = true; onEditNote() }, { moreOpen = true }, {
        historyTimestamp = null
        historyOpen = true
        onLoadHistory()
      })
  }
  if (creationSheetOpen) ModalBottomSheet(onDismissRequest = { creationSheetOpen = false },
    modifier = Modifier.testTag("notes-create-sheet")) {
    Column(modifier = Modifier.fillMaxWidth().padding(horizontal = 20.dp, vertical = 12.dp),
      verticalArrangement = Arrangement.spacedBy(10.dp)) {
      Text(stringResource(R.string.notes_new), style = MaterialTheme.typography.titleLarge,
        fontWeight = FontWeight.Bold, modifier = Modifier.padding(bottom = 6.dp))
      Card(onClick = { creationSheetOpen = false; editorOpen = true; onNew() },
        modifier = Modifier.fillMaxWidth().heightIn(min = 56.dp).testTag("notes-create-text")) {
        Row(modifier = Modifier.fillMaxWidth().padding(16.dp),
          horizontalArrangement = Arrangement.spacedBy(14.dp)) {
          Icon(painterResource(R.drawable.tab_notes), contentDescription = null)
          Text(stringResource(R.string.notes_create_text), modifier = Modifier.weight(1f))
          Text("›")
        }
      }
      Card(onClick = { creationSheetOpen = false; onStartVoice?.invoke() },
        enabled = onStartVoice != null,
        modifier = Modifier.fillMaxWidth().heightIn(min = 64.dp).testTag("notes-create-voice")) {
        Row(modifier = Modifier.fillMaxWidth().padding(16.dp),
          horizontalArrangement = Arrangement.spacedBy(14.dp)) {
          Icon(painterResource(R.drawable.action_microphone), contentDescription = null,
            tint = MaterialTheme.colorScheme.error)
          Column(modifier = Modifier.weight(1f)) {
            Text(stringResource(R.string.notes_create_voice))
            Text(stringResource(R.string.notes_create_voice_hint),
              style = MaterialTheme.typography.bodySmall,
              color = MaterialTheme.colorScheme.onSurfaceVariant)
          }
          Text("›")
        }
      }
    }
  }
  val detail = state.detail?.takeIf { it.id == selectedId }
  if (historyOpen && detail != null) ModalBottomSheet(onDismissRequest = { historyOpen = false },
    modifier = Modifier.testTag("note-history-sheet")) {
    Column(modifier = Modifier.fillMaxWidth().heightIn(max = 560.dp)
      .padding(horizontal = 20.dp, vertical = 12.dp),
      verticalArrangement = Arrangement.spacedBy(12.dp)) {
      Text(stringResource(R.string.notes_history), style = MaterialTheme.typography.titleLarge)
      if (state.historyLoading || state.snapshotLoading || state.restoreBusy) {
        CircularProgressIndicator(modifier = Modifier.testTag("note-history-loading"))
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
        OutlinedButton(onClick = { historyTimestamp = null; onLoadHistory() },
          modifier = Modifier.testTag("note-history-list-back")) {
          Text(stringResource(R.string.progress_back))
        }
        Text(state.snapshot.title ?: detail.title, style = MaterialTheme.typography.titleMedium)
        Text(state.snapshot.markdown, modifier = Modifier.weight(1f, fill = false)
          .verticalScroll(rememberScrollState()).testTag("note-history-preview"))
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
  if (restoreConfirmOpen) AlertDialog(onDismissRequest = { restoreConfirmOpen = false },
    title = { Text(stringResource(R.string.notes_restore_version)) },
    text = { Text(stringResource(R.string.notes_restore_confirm)) },
    confirmButton = { TextButton(onClick = { restoreConfirmOpen = false; onRestoreSnapshot() },
      modifier = Modifier.testTag("note-history-confirm-restore")) {
      Text(stringResource(R.string.notes_restore_version))
    } },
    dismissButton = { TextButton(onClick = { restoreConfirmOpen = false }) {
      Text(stringResource(R.string.progress_back))
    } })
  if (deleteConfirmOpen) AlertDialog(onDismissRequest = { deleteConfirmOpen = false },
    title = { Text(stringResource(R.string.notes_delete)) },
    text = { Text(stringResource(R.string.notes_delete_confirm)) },
    confirmButton = { TextButton(onClick = { deleteConfirmOpen = false; onDeleteNote() },
      modifier = Modifier.testTag("note-confirm-delete")) {
      Text(stringResource(R.string.notes_delete), color = MaterialTheme.colorScheme.error)
    } },
    dismissButton = { TextButton(onClick = { deleteConfirmOpen = false },
      modifier = Modifier.testTag("note-cancel-delete")) {
      Text(stringResource(R.string.progress_back))
    } })
  if (moreOpen && detail != null) ModalBottomSheet(onDismissRequest = { moreOpen = false },
    modifier = Modifier.testTag("note-more-sheet")) {
    Column(modifier = Modifier.fillMaxWidth().padding(horizontal = 20.dp, vertical = 12.dp),
      verticalArrangement = Arrangement.spacedBy(8.dp)) {
      Text(stringResource(R.string.notes_more), style = MaterialTheme.typography.titleLarge)
      TextButton(onClick = {
        moreOpen = false
        onMetadataChange(NoteMetadataPatch(pinned = !detail.pinned))
      }, enabled = !state.metadataBusy, modifier = Modifier.testTag("note-toggle-pin")) {
        Text(stringResource(if (detail.pinned) R.string.notes_unpin else R.string.notes_pin))
      }
      TextButton(onClick = {
        tagsText = detail.tags.joinToString(", ")
        moreOpen = false
        tagsOpen = true
      }, enabled = !state.metadataBusy, modifier = Modifier.testTag("note-manage-tags")) {
        Text(stringResource(R.string.notes_manage_tags))
      }
      if (detail.status != "archived") TextButton(onClick = {
        moreOpen = false
        onMetadataChange(NoteMetadataPatch(status = "archived"))
      }, enabled = !state.metadataBusy, modifier = Modifier.testTag("note-archive")) {
        Text(stringResource(R.string.notes_archive))
      }
      TextButton(onClick = { moreOpen = false; onShareNote() },
        enabled = !state.shareBusy && !state.metadataBusy && !state.deleteBusy &&
          !state.draftSaving && state.draft?.takeIf {
            it.id == detail.id && it.version != state.draftSyncedVersion
          } == null,
        modifier = Modifier.testTag("note-share")) {
        Text(stringResource(R.string.notes_share))
      }
      TextButton(onClick = { moreOpen = false; deleteConfirmOpen = true },
        enabled = !state.deleteBusy && !state.metadataBusy,
        modifier = Modifier.testTag("note-delete")) {
        Text(stringResource(R.string.notes_delete), color = MaterialTheme.colorScheme.error)
      }
    }
  }
  if (state.shareBusy) AlertDialog(onDismissRequest = {},
    title = { Text(stringResource(R.string.notes_share)) },
    text = { CircularProgressIndicator(modifier = Modifier.testTag("note-share-loading")) },
    confirmButton = {})
  if (state.shareError) AlertDialog(onDismissRequest = onDismissShare,
    title = { Text(stringResource(R.string.notes_share)) },
    text = { Text(stringResource(R.string.notes_share_error)) },
    confirmButton = { TextButton(onClick = onDismissShare) { Text(stringResource(R.string.progress_back)) } })
  val share = state.share?.takeIf { it.noteId == selectedId && detail?.id == selectedId }
  if (share != null) ModalBottomSheet(onDismissRequest = onDismissShare,
    modifier = Modifier.testTag("note-share-sheet")) {
    Column(modifier = Modifier.fillMaxWidth().padding(20.dp),
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
      Text(stringResource(R.string.progress_back))
    } })
}

@Composable
internal fun NoteDraftContent(state: NotesUiState, onChange: (String, String) -> Unit,
  onSave: () -> Unit, modifier: Modifier = Modifier,
  onResolveConflict: (Boolean) -> Unit = {}) {
  val draft = state.draft
  var bodyValue by remember(draft?.id) { mutableStateOf(TextFieldValue(draft?.markdown.orEmpty())) }
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
  fun setHeading(level: Int) {
    val start = bodyValue.text.lastIndexOf('\n', (bodyValue.selection.min - 1).coerceAtLeast(0)) + 1
    val end = bodyValue.text.indexOf('\n', start).let { if (it < 0) bodyValue.text.length else it }
    val line = bodyValue.text.substring(start, end).replace(Regex("^#{1,3} "), "")
    val heading = "#".repeat(level) + " " + line
    val text = bodyValue.text.replaceRange(start, end, heading)
    updateBody(TextFieldValue(text, TextRange((start + heading.length).coerceAtMost(text.length))))
  }
  Column(modifier = modifier.verticalScroll(rememberScrollState()),
    verticalArrangement = Arrangement.spacedBy(12.dp)) {
    if (draft == null) {
      if (state.draftError) Text(stringResource(R.string.notes_draft_error),
        color = MaterialTheme.colorScheme.error)
      else CircularProgressIndicator(modifier = Modifier.testTag("notes-draft-loading"))
      return@Column
    }
    OutlinedTextField(draft.title, { onChange(it, draft.markdown) },
      modifier = Modifier.fillMaxWidth().testTag("notes-draft-title"),
      label = { Text(stringResource(R.string.notes_title)) }, singleLine = true,
      enabled = !(state.draftSaving && state.draftConflict != null))
    Row(modifier = Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()),
      horizontalArrangement = Arrangement.spacedBy(4.dp)) {
      val blocked = state.draftSaving && state.draftConflict != null
      TextButton(onClick = {
        if (undo.isNotEmpty()) {
          val previous = undo.last(); undo = undo.dropLast(1)
          redo = (redo + bodyValue.text).takeLast(100)
          updateBody(TextFieldValue(previous, TextRange(previous.length)), false)
        }
      }, enabled = !blocked && undo.isNotEmpty(), modifier = Modifier.testTag("notes-undo")) { Text("↶") }
      TextButton(onClick = {
        if (redo.isNotEmpty()) {
          val next = redo.last(); redo = redo.dropLast(1)
          undo = (undo + bodyValue.text).takeLast(100)
          updateBody(TextFieldValue(next, TextRange(next.length)), false)
        }
      }, enabled = !blocked && redo.isNotEmpty(), modifier = Modifier.testTag("notes-redo")) { Text("↷") }
      listOf("B" to "**", "I" to "*").forEach { (label, marker) ->
        TextButton(onClick = { insertMarkdown(marker, marker) }, enabled = !blocked,
          modifier = Modifier.testTag("notes-format-${label.lowercase()}")) { Text(label) }
      }
      (1..3).forEach { level ->
        TextButton(onClick = { setHeading(level) }, enabled = !blocked,
          modifier = Modifier.testTag("notes-heading-$level")) { Text("H$level") }
      }
      listOf("•" to "- ", "☐" to "- [ ] ", "❝" to "> ", "</>" to "`code`",
        "🔗" to "[link](https://)", "—" to "\n---\n").forEach { (label, value) ->
        TextButton(onClick = { insertMarkdown(value) }, enabled = !blocked) { Text(label) }
      }
    }
    OutlinedTextField(bodyValue, { updateBody(it) },
      modifier = Modifier.fillMaxWidth().testTag("notes-draft-body"),
      label = { Text(stringResource(R.string.notes_body)) }, minLines = 8,
      enabled = !(state.draftSaving && state.draftConflict != null))
    if (state.draftError) Text(stringResource(R.string.notes_draft_error),
      color = MaterialTheme.colorScheme.error, modifier = Modifier.testTag("notes-draft-error"))
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
    Button(onClick = onSave, enabled = conflict == null &&
      (draft.title.isNotBlank() || draft.markdown.isNotBlank() ||
        draft.version == state.draftSyncedVersion),
      modifier = Modifier.testTag("notes-draft-save")) {
      Text(stringResource(R.string.notes_save))
    }
  }
}

@Composable
internal fun NotesListContent(state: NotesUiState, search: String, onSearchChange: (String) -> Unit,
  onSubmit: () -> Unit, onStatus: (String) -> Unit, onOpen: (String) -> Unit,
  onLoadMore: () -> Unit, modifier: Modifier = Modifier, onOpenDraft: (String) -> Unit = {},
  onOpenFiles: (() -> Unit)? = null, searchFiles: List<ManagedFile> = emptyList(),
  onOpenSearchFile: (ManagedFile) -> Unit = {}) {
  var filtersOpen by rememberSaveable { mutableStateOf(false) }
  Column(modifier = modifier, verticalArrangement = Arrangement.spacedBy(12.dp)) {
    Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp),
      verticalAlignment = Alignment.CenterVertically) {
      BasicTextField(search, { onSearchChange(it.take(4096)) },
        modifier = Modifier.weight(1f).heightIn(min = 48.dp)
          .background(MaterialTheme.colorScheme.surfaceContainer, RoundedCornerShape(14.dp))
          .padding(horizontal = 14.dp, vertical = 13.dp).testTag("notes-search"),
        singleLine = true, textStyle = MaterialTheme.typography.bodyLarge.copy(
          color = MaterialTheme.colorScheme.onSurface),
        keyboardOptions = KeyboardOptions(imeAction = ImeAction.Search),
        keyboardActions = KeyboardActions(onSearch = { onSubmit() }),
        decorationBox = { inner -> Box {
          if (search.isEmpty()) Text(stringResource(R.string.notes_search),
            color = MaterialTheme.colorScheme.onSurfaceVariant)
          inner()
        } })
      IconButton(onClick = { onOpenFiles?.invoke() }, enabled = onOpenFiles != null,
        modifier = Modifier.size(48.dp)
          .background(MaterialTheme.colorScheme.surfaceContainer, RoundedCornerShape(14.dp))
          .testTag("notes-files")) {
        Icon(painterResource(R.drawable.action_folder), stringResource(R.string.notes_files))
      }
    }
    Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.End) {
      TextButton(onClick = onSubmit, enabled = !state.loading,
        modifier = Modifier.testTag("notes-refresh")) { Text(stringResource(R.string.progress_refresh)) }
      TextButton(onClick = { filtersOpen = !filtersOpen },
        modifier = Modifier.testTag("notes-filter-menu")) { Text(stringResource(R.string.notes_filter)) }
    }
    if (filtersOpen) Row(modifier = Modifier.horizontalScroll(rememberScrollState()),
      horizontalArrangement = Arrangement.spacedBy(6.dp)) {
      listOf("" to R.string.notes_all, "inbox" to R.string.notes_inbox,
        "processed" to R.string.notes_processed, "archived" to R.string.notes_archived).forEach { (status, label) ->
        FilterChip(selected = state.status == status, onClick = { onStatus(status) },
          label = { Text(stringResource(label)) }, modifier = Modifier.testTag("notes-filter-${status.ifEmpty { "all" }}"))
      }
    }
    LazyColumn(modifier = Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(10.dp),
      contentPadding = PaddingValues(bottom = 20.dp)) {
      if (state.loading && state.items.isEmpty()) item {
        CircularProgressIndicator(modifier = Modifier.testTag("notes-loading"))
      }
      if (state.listError) item { OutlinedButton(onClick = onSubmit,
        modifier = Modifier.testTag("notes-retry")) {
        Text(stringResource(R.string.progress_load_failed))
      } }
      if (!state.loading && !state.listError && state.items.isEmpty() && searchFiles.isEmpty()) item {
        if (state.drafts.isEmpty()) Text(stringResource(R.string.notes_empty),
          modifier = Modifier.testTag("notes-empty"))
      }
      items(state.drafts, key = { "draft-${it.id}" }) { draft ->
        NoteDraftCard(draft, onOpenDraft)
      }
      items(state.items, key = { it.id }) { note -> NoteCard(note, onOpen) }
      if (search.isNotBlank() && searchFiles.isNotEmpty()) item {
        Text(stringResource(R.string.notes_files), style = MaterialTheme.typography.titleSmall,
          modifier = Modifier.padding(top = 8.dp))
      }
      if (search.isNotBlank()) items(searchFiles, key = { "file-${it.id}" }) { file ->
        ManagedFileCard(file, onOpenSearchFile)
      }
      if (state.hasMore) item {
        OutlinedButton(onClick = onLoadMore, enabled = !state.loadingMore,
          modifier = Modifier.fillMaxWidth().testTag("notes-load-more")) {
          Text(stringResource(R.string.notes_load_more))
        }
      }
      if (state.moreError) item { Text(stringResource(R.string.notes_more_error),
        color = MaterialTheme.colorScheme.error, modifier = Modifier.testTag("notes-more-error")) }
    }
  }
}

@Composable
private fun NotesFilesContent(spaces: List<ManagedFileSpace>, items: List<ManagedFile>,
  selected: ManagedFile?, preview: String?, image: ByteArray?, loading: Boolean, error: Boolean,
  onRetry: () -> Unit, onOpenSpace: (ManagedFileSpace) -> Unit,
  onOpenFile: (ManagedFile) -> Unit, modifier: Modifier = Modifier) {
  Column(modifier = modifier, verticalArrangement = Arrangement.spacedBy(12.dp)) {
    if (error) OutlinedButton(onClick = onRetry, modifier = Modifier.testTag("notes-files-retry")) {
      Text(stringResource(R.string.progress_load_failed))
    }
    if (loading) CircularProgressIndicator(modifier = Modifier.testTag("notes-files-loading"))
    if (selected != null) {
      Text(selected.name, style = MaterialTheme.typography.titleLarge,
        modifier = Modifier.testTag("notes-file-title"))
      Text(selected.relativePath, style = MaterialTheme.typography.bodySmall,
        color = MaterialTheme.colorScheme.onSurfaceVariant)
      val bitmap = remember(image) { image?.let { bytes ->
        val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
        BitmapFactory.decodeByteArray(bytes, 0, bytes.size, bounds)
        var sample = 1
        while (bounds.outWidth / sample > 2048 || bounds.outHeight / sample > 2048) sample *= 2
        BitmapFactory.decodeByteArray(bytes, 0, bytes.size,
          BitmapFactory.Options().apply { inSampleSize = sample })
      } }
      if (bitmap != null) Image(bitmap.asImageBitmap(), selected.name,
        modifier = Modifier.fillMaxWidth().weight(1f).testTag("notes-file-image"),
        contentScale = ContentScale.Fit)
      else if (preview != null) Text(preview, modifier = Modifier.fillMaxWidth().weight(1f)
        .verticalScroll(rememberScrollState()).testTag("notes-file-preview"),
        style = MaterialTheme.typography.bodyMedium)
      else Text(stringResource(R.string.notes_file_preview_unavailable),
        color = MaterialTheme.colorScheme.onSurfaceVariant)
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
              Text("›")
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
      Text("›")
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
      if (draft.markdown.isNotBlank()) Text(draft.markdown.take(200), maxLines = 2,
        overflow = TextOverflow.Ellipsis, style = MaterialTheme.typography.bodyMedium)
    }
  }
}

@Composable
private fun NoteCard(note: NoteSummary, onOpen: (String) -> Unit) {
  Card(onClick = { onOpen(note.id) }, modifier = Modifier.fillMaxWidth().heightIn(min = 96.dp)
    .testTag("note-${note.id}")) {
    Row(modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 16.dp),
      horizontalArrangement = Arrangement.spacedBy(12.dp), verticalAlignment = Alignment.CenterVertically) {
      Column(modifier = Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(5.dp)) {
        Text((if (note.pinned) "⌖ " else "") + note.title.ifBlank { stringResource(R.string.notes_untitled) },
          style = MaterialTheme.typography.titleMedium, maxLines = 1, overflow = TextOverflow.Ellipsis)
        if (note.snippet.isNotBlank()) Text(note.snippet, maxLines = 2,
          overflow = TextOverflow.Ellipsis, style = MaterialTheme.typography.bodyMedium.copy(lineHeight = 20.sp),
          color = MaterialTheme.colorScheme.onSurfaceVariant)
        val statusLabel = stringResource(when (note.status) {
          "inbox" -> R.string.notes_inbox
          "processed" -> R.string.notes_processed
          "archived" -> R.string.notes_archived
          else -> R.string.notes_all
        })
        Text("${DateFormat.getDateInstance().format(Date(note.updatedAt))} · $statusLabel",
          style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
        if (note.tags.isNotEmpty()) Text(note.tags.take(2).joinToString("  ") { "#$it" },
          style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.primary,
          maxLines = 1, overflow = TextOverflow.Ellipsis)
      }
      Text("›", color = MaterialTheme.colorScheme.onSurfaceVariant,
        style = MaterialTheme.typography.titleLarge)
    }
  }
}

@Composable
internal fun NotesDetailContent(state: NotesUiState, id: String, onRetry: () -> Unit,
  modifier: Modifier = Modifier, onEdit: () -> Unit = {}, onMore: () -> Unit = {},
  onHistory: () -> Unit = {}) {
  val note = state.detail.takeIf { it?.id == id }
  Column(modifier = modifier.verticalScroll(rememberScrollState()),
    verticalArrangement = Arrangement.spacedBy(12.dp)) {
    if (state.detailLoading && note == null) CircularProgressIndicator(modifier = Modifier.testTag("note-detail-loading"))
    if (state.detailError) OutlinedButton(onClick = onRetry, modifier = Modifier.testTag("note-detail-retry")) {
      Text(stringResource(R.string.progress_load_failed))
    }
    if (state.metadataError) Text(stringResource(R.string.notes_metadata_error),
      color = MaterialTheme.colorScheme.error, modifier = Modifier.testTag("note-metadata-error"))
    if (state.deleteError) Text(stringResource(R.string.notes_delete_error),
      color = MaterialTheme.colorScheme.error, modifier = Modifier.testTag("note-delete-error"))
    if (note != null) {
      Row(modifier = Modifier.horizontalScroll(rememberScrollState()),
        horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        OutlinedButton(onClick = onEdit, enabled = note.remoteVersion != null &&
          !state.metadataBusy && !state.deleteBusy,
          modifier = Modifier.testTag("note-detail-edit")) { Text(stringResource(R.string.notes_edit)) }
        OutlinedButton(onClick = onMore, enabled = note.remoteVersion != null &&
          !state.metadataBusy && !state.deleteBusy,
          modifier = Modifier.testTag("note-detail-more")) { Text(stringResource(R.string.notes_more)) }
        OutlinedButton(onClick = onHistory, enabled = !state.metadataBusy && !state.deleteBusy,
          modifier = Modifier.testTag("note-detail-history")) { Text(stringResource(R.string.notes_history)) }
      }
      if (state.metadataBusy) CircularProgressIndicator(modifier = Modifier.testTag("note-metadata-busy"))
      if (state.deleteBusy) CircularProgressIndicator(modifier = Modifier.testTag("note-delete-busy"))
      NoteBody(note)
    }
  }
}

@Composable
private fun NoteBody(note: NoteDetail) {
  Text(note.title.ifBlank { stringResource(R.string.notes_untitled) },
    style = MaterialTheme.typography.headlineSmall, fontWeight = FontWeight.SemiBold,
    modifier = Modifier.testTag("note-detail-title"))
  Text("${DateFormat.getDateTimeInstance().format(Date(note.updatedAt))} · ${note.status}",
    style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
  if (note.tags.isNotEmpty()) Text(note.tags.joinToString("  ") { "#$it" },
    style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.primary)
  Text(note.markdown.ifEmpty { stringResource(R.string.notes_empty_body) },
    style = MaterialTheme.typography.bodyLarge, modifier = Modifier.testTag("note-detail-body"))
}
