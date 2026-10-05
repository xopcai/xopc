package ai.xopc.mobile.ui.main

import ai.xopc.mobile.R
import ai.xopc.mobile.gateway.NoteDetail
import ai.xopc.mobile.gateway.NoteDraft
import ai.xopc.mobile.gateway.NoteMetadataPatch
import ai.xopc.mobile.gateway.NoteSummary
import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import android.content.Intent
import androidx.activity.compose.BackHandler
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.horizontalScroll
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
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
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
  onShareNote: () -> Unit = {}, onDismissShare: () -> Unit = {}) {
  val context = LocalContext.current
  var query by rememberSaveable(state.gatewayId) { mutableStateOf(state.search) }
  var selectedId by rememberSaveable(state.gatewayId) { mutableStateOf<String?>(null) }
  var editorOpen by rememberSaveable(state.gatewayId) { mutableStateOf(false) }
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
      Text(stringResource(R.string.tab_notes), style = MaterialTheme.typography.headlineSmall,
        fontWeight = FontWeight.SemiBold)
      if (editorOpen || selectedId != null) TextButton(onClick = {
        if (editorOpen) closeEditor() else selectedId = null
      },
        modifier = Modifier.testTag("notes-back")) { Text(stringResource(R.string.progress_back)) }
      else Button(onClick = { editorOpen = true; onNew() },
        enabled = !state.draftLoading && !state.draftSaving, modifier = Modifier.testTag("notes-new")) {
        Text(stringResource(R.string.notes_new))
      }
    }
    if (editorOpen) NoteDraftContent(state, onDraftChange, onSaveDraft,
      Modifier.weight(1f), onResolveConflict)
    else if (selectedId == null) {
      NotesListContent(state, query, { query = it },
      { onSearch(query.trim(), state.status) }, { status -> onSearch(query.trim(), status) },
      { id -> selectedId = id; onOpen(id) }, onLoadMore, Modifier.weight(1f),
      { id -> editorOpen = true; onOpenDraft(id) })
    } else NotesDetailContent(state, selectedId!!, { onOpen(selectedId!!) }, Modifier.weight(1f),
      { editorOpen = true; onEditNote() }, { moreOpen = true }, {
        historyTimestamp = null
        historyOpen = true
        onLoadHistory()
      })
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
    OutlinedTextField(draft.markdown, { onChange(draft.title, it) },
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
  onLoadMore: () -> Unit, modifier: Modifier = Modifier, onOpenDraft: (String) -> Unit = {}) {
  Column(modifier = modifier, verticalArrangement = Arrangement.spacedBy(12.dp)) {
    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
      OutlinedTextField(search, { onSearchChange(it.take(4096)) }, modifier = Modifier.weight(1f).testTag("notes-search"),
        singleLine = true, placeholder = { Text(stringResource(R.string.notes_search)) },
        keyboardOptions = KeyboardOptions(imeAction = ImeAction.Search),
        keyboardActions = KeyboardActions(onSearch = { onSubmit() }))
      OutlinedButton(onClick = onSubmit, enabled = !state.loading,
        modifier = Modifier.testTag("notes-refresh")) { Text(stringResource(R.string.progress_refresh)) }
    }
    Row(modifier = Modifier.horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(6.dp)) {
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
      if (!state.loading && !state.listError && state.items.isEmpty()) item {
        if (state.drafts.isEmpty()) Text(stringResource(R.string.notes_empty),
          modifier = Modifier.testTag("notes-empty"))
      }
      items(state.drafts, key = { "draft-${it.id}" }) { draft ->
        NoteDraftCard(draft, onOpenDraft)
      }
      items(state.items, key = { it.id }) { note -> NoteCard(note, onOpen) }
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
  Card(onClick = { onOpen(note.id) }, modifier = Modifier.fillMaxWidth().testTag("note-${note.id}")) {
    Column(modifier = Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(5.dp)) {
      Text((if (note.pinned) "• " else "") + note.title.ifBlank { stringResource(R.string.notes_untitled) },
        style = MaterialTheme.typography.titleMedium, maxLines = 1, overflow = TextOverflow.Ellipsis)
      if (note.snippet.isNotBlank()) Text(note.snippet, maxLines = 2,
        overflow = TextOverflow.Ellipsis, style = MaterialTheme.typography.bodyMedium)
      Text("${DateFormat.getDateInstance().format(Date(note.updatedAt))} · ${note.status}",
        style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
      if (note.tags.isNotEmpty()) Text(note.tags.take(2).joinToString("  ") { "#$it" },
        style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.primary)
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
