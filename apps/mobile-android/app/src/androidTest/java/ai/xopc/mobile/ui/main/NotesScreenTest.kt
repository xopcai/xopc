package ai.xopc.mobile.ui.main

import ai.xopc.mobile.R
import ai.xopc.mobile.gateway.NoteDetail
import ai.xopc.mobile.gateway.NoteSummary
import ai.xopc.mobile.gateway.NoteDraft
import ai.xopc.mobile.gateway.NoteMetadataPatch
import ai.xopc.mobile.gateway.NoteHistoryEntry
import ai.xopc.mobile.gateway.NoteSnapshot
import ai.xopc.mobile.gateway.NoteShare
import ai.xopc.mobile.gateway.NoteAiPreview
import ai.xopc.mobile.gateway.ManagedFile
import ai.xopc.mobile.gateway.ManagedFileSpace
import androidx.activity.ComponentActivity
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.test.assertIsEnabled
import androidx.compose.ui.test.assertIsNotEnabled
import androidx.compose.ui.test.assertTextContains
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onAllNodesWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performTextInput
import androidx.compose.ui.test.performTextReplacement
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test

class NotesScreenTest {
  @get:Rule val composeTestRule = createAndroidComposeRule<ComponentActivity>()

  private val note = NoteSummary("note-1", "Idea", "A short idea", "inbox", "thought",
    2000L, true, listOf("mobile"))

  @Test fun aiEditRequiresPreviewBeforeApplyingToTheDraft() {
    val detail = NoteDetail("note-1", "Idea", "Body", "inbox", "thought",
      2000L, false, emptyList(), 3L)
    var state by mutableStateOf(NotesUiState(gatewayId = "test", items = listOf(note), detail = detail))
    var applied = 0
    composeTestRule.setContent {
      NotesScreen(state, androidx.compose.foundation.layout.PaddingValues(), { _, _ -> }, {},
        { id -> state = state.copy(selectedId = id) },
        onEditNote = { state = state.copy(draft = NoteDraft(detail.id, detail.title,
          detail.markdown, "00000000-0000-0000-0000-000000000003", 1, 3)) },
        onAiPreview = { instruction ->
          assertEquals("Improve", instruction)
          NoteAiPreview("patch-1", "Updated body", "", "Body", "Improved body",
            null, null, null)
        }, onApplyAi = { preview ->
          applied++
          state = state.copy(draft = state.draft!!.copy(markdown = preview.proposedMarkdown))
        })
    }
    composeTestRule.onNodeWithTag("note-note-1").performClick()
    composeTestRule.onNodeWithTag("note-detail-ai").performClick()
    composeTestRule.onNodeWithTag("note-ai-instruction").performTextInput("Improve")
    composeTestRule.onNodeWithTag("note-ai-generate").performClick()
    composeTestRule.waitUntil(5_000) {
      composeTestRule.onAllNodesWithTag("note-ai-apply").fetchSemanticsNodes().isNotEmpty()
    }
    assertEquals(0, applied)
    composeTestRule.onNodeWithTag("note-ai-apply").performClick()
    assertEquals(1, applied)
    composeTestRule.onNodeWithTag("notes-draft-body").assertTextContains("Improved body")
  }

  @Test fun noteShareRequiresExplicitMenuActionAndShowsConfirmedLink() {
    val detail = NoteDetail("note-1", "Idea", "Body", "inbox", "thought",
      2000L, false, emptyList(), 3L)
    var state by mutableStateOf(NotesUiState(gatewayId = "test", items = listOf(note), detail = detail))
    var requests = 0
    composeTestRule.setContent {
      NotesScreen(state, androidx.compose.foundation.layout.PaddingValues(), { _, _ -> }, {},
        { id -> state = state.copy(selectedId = id) },
        onShareNote = {
          requests++
          state = state.copy(share = NoteShare("note-1", "share-1", "Idea", "https://share.example/s/test",
            "lan", "", "2026-10-05T00:00:00Z"))
        }, onDismissShare = { state = state.copy(share = null) })
    }
    composeTestRule.onNodeWithTag("note-note-1").performClick()
    composeTestRule.onNodeWithTag("note-detail-more").performClick()
    composeTestRule.onNodeWithTag("note-share").performClick()
    assertEquals(1, requests)
    composeTestRule.onNodeWithTag("note-share-url").assertExists()
    composeTestRule.onNodeWithTag("note-share-copy").assertExists()
    composeTestRule.onNodeWithTag("note-share-system").assertExists()
  }

  @Test fun listSearchFilterPagingAndDetailAreStateDriven() {
    var query by mutableStateOf("")
    var submitted = ""
    var status = ""
    var opened = ""
    var more = 0
    composeTestRule.setContent {
      NotesListContent(NotesUiState(items = listOf(note), hasMore = true), query,
        { query = it }, { submitted = query }, { status = it }, { opened = it }, { more++ })
    }
    composeTestRule.onNodeWithTag("notes-search").performTextInput("idea")
    composeTestRule.onNodeWithTag("notes-refresh").performClick()
    assertEquals("idea", submitted)
    composeTestRule.onNodeWithTag("notes-filter-menu").performClick()
    composeTestRule.onNodeWithTag("notes-filter-inbox").performClick()
    assertEquals("inbox", status)
    composeTestRule.onNodeWithTag("note-note-1").performClick()
    assertEquals("note-1", opened)
    composeTestRule.onNodeWithTag("notes-load-more").performClick()
    assertEquals(1, more)
  }

  @Test fun detailLoadingRetryAndReadOnlyBody() {
    var retries = 0
    val detail = NoteDetail("note-1", "Idea", "# Idea\nBody", "inbox", "thought",
      2000L, false, emptyList(), 3L)
    composeTestRule.setContent {
      NotesDetailContent(NotesUiState(selectedId = "note-1", detail = detail,
        detailError = true), "note-1", { retries++ })
    }
    composeTestRule.onNodeWithTag("note-detail-body").assertExists()
    composeTestRule.onNodeWithText("Body").assertExists()
    composeTestRule.onNodeWithText(composeTestRule.activity.getString(R.string.notes_inbox),
      substring = true).assertExists()
    composeTestRule.onNodeWithText("inbox", substring = true, ignoreCase = false).assertDoesNotExist()
    composeTestRule.onNodeWithTag("note-detail-retry").performClick()
    assertEquals(1, retries)
  }

  @Test fun multipleLocalDraftsRemainIndividuallyOpenable() {
    val first = NoteDraft("local-00000000-0000-0000-0000-000000000001", "One", "First body",
      "00000000-0000-0000-0000-000000000011", 1)
    val second = first.copy(id = "local-00000000-0000-0000-0000-000000000002", title = "Two")
    var opened = ""
    composeTestRule.setContent {
      NotesListContent(NotesUiState(drafts = listOf(first, second)), "", {}, {}, {}, {}, {},
        onOpenDraft = { opened = it })
    }
    composeTestRule.onNodeWithTag("note-draft-${second.id}").performClick()
    assertEquals(second.id, opened)
    composeTestRule.onNodeWithTag("note-draft-${first.id}").assertExists()
  }

  @Test fun draftLimitIsVisibleWithoutDiscardingTheEditor() {
    val draft = NoteDraft("local-00000000-0000-0000-0000-000000000003", "Idea", "Body",
      "00000000-0000-0000-0000-000000000013", 2)
    composeTestRule.setContent {
      NoteDraftContent(NotesUiState(draft = draft, draftLimitReached = true), { _, _ -> }, {})
    }
    composeTestRule.onNodeWithTag("notes-draft-limit").assertExists()
    composeTestRule.onNodeWithTag("notes-draft-body").assertExists()
  }

  @Test fun existingNoteHasEditEntry() {
    val detail = NoteDetail("note-1", "Remote", "Remote body", "inbox", "thought",
      3000L, false, emptyList(), 5L)
    var edits = 0
    composeTestRule.setContent {
      NotesDetailContent(NotesUiState(detail = detail), "note-1", {}, onEdit = { edits++ })
    }
    composeTestRule.onNodeWithTag("note-detail-edit").performClick()
    assertEquals(1, edits)
  }

  @Test fun detailMoreSheetDispatchesVersionedMetadataIntent() {
    val detail = NoteDetail("note-1", "Idea", "Body", "inbox", "thought",
      2000L, false, listOf("old"), 3L)
    var state by mutableStateOf(NotesUiState(gatewayId = "test", items = listOf(note), detail = detail))
    var patch: NoteMetadataPatch? = null
    composeTestRule.setContent {
      NotesScreen(state, androidx.compose.foundation.layout.PaddingValues(), { _, _ -> }, {},
        { id -> state = state.copy(selectedId = id) },
        onMetadataChange = { patch = it })
    }
    composeTestRule.onNodeWithTag("note-note-1").performClick()
    composeTestRule.onNodeWithTag("note-detail-more").performClick()
    composeTestRule.onNodeWithTag("note-toggle-pin").performClick()
    assertEquals(NoteMetadataPatch(pinned = true), patch)
    composeTestRule.onNodeWithTag("note-detail-more").performClick()
    composeTestRule.onNodeWithTag("note-manage-tags").performClick()
    composeTestRule.onNodeWithTag("note-tags-input").performTextReplacement("x".repeat(513))
    composeTestRule.onNodeWithTag("note-tags-limit").assertExists()
    composeTestRule.onNodeWithTag("note-tags-save").assertIsNotEnabled()
    composeTestRule.onNodeWithTag("note-tags-input").performTextReplacement("old, new, old")
    composeTestRule.onNodeWithTag("note-tags-save").performClick()
    assertEquals(NoteMetadataPatch(tags = listOf("old", "new")), patch)
    composeTestRule.onNodeWithTag("note-detail-more").performClick()
    composeTestRule.onNodeWithTag("note-archive").performClick()
    assertEquals(NoteMetadataPatch(status = "archived"), patch)
    composeTestRule.runOnIdle { state = state.copy(metadataError = true) }
    composeTestRule.onNodeWithTag("note-metadata-error").assertExists()
  }

  @Test fun historyPreviewRequiresConfirmationBeforeRestoringIntoEditor() {
    val detail = NoteDetail("note-1", "Current", "Current body", "inbox", "thought",
      2000L, false, emptyList(), 3L)
    val previous = NoteSnapshot("note-1", 1234L, "sync", "Earlier", "Old body")
    var state by mutableStateOf(NotesUiState(gatewayId = "test", items = listOf(note), detail = detail))
    var loaded = 0
    var selectedTimestamp = 0L
    var restores = 0
    composeTestRule.setContent {
      NotesScreen(state, androidx.compose.foundation.layout.PaddingValues(), { _, _ -> }, {},
        { id -> state = state.copy(selectedId = id) },
        onLoadHistory = {
          loaded++
          state = state.copy(history = listOf(NoteHistoryEntry(1234L, "sync", "Old body")),
            snapshot = null)
        },
        onLoadSnapshot = { timestamp -> selectedTimestamp = timestamp; state = state.copy(snapshot = previous) },
        onRestoreSnapshot = {
          restores++
          state = state.copy(draft = NoteDraft("note-1", "Earlier", "Old body",
            "00000000-0000-0000-0000-000000000060", 4, 3), restoredSnapshotId = "note-1")
        },
        onRestorationHandled = { state = state.copy(restoredSnapshotId = null) })
    }
    composeTestRule.onNodeWithTag("note-note-1").performClick()
    composeTestRule.onNodeWithTag("note-detail-history").performClick()
    assertEquals(1, loaded)
    composeTestRule.onNodeWithTag("note-history-1234").performClick()
    assertEquals(1234L, selectedTimestamp)
    composeTestRule.onNodeWithTag("note-history-preview").assertExists()
    composeTestRule.onNodeWithTag("note-history-restore").performClick()
    assertEquals(0, restores)
    composeTestRule.onNodeWithTag("note-history-confirm-restore").performClick()
    assertEquals(1, restores)
    composeTestRule.onNodeWithTag("notes-draft-body").assertExists()
  }

  @Test fun deleteRequiresConfirmationAndOnlyNavigatesAfterAcknowledgement() {
    val detail = NoteDetail("note-1", "Idea", "Body", "inbox", "thought",
      2000L, false, emptyList(), 3L)
    var state by mutableStateOf(NotesUiState(gatewayId = "test", items = listOf(note), detail = detail))
    var deletes = 0
    composeTestRule.setContent {
      NotesScreen(state, androidx.compose.foundation.layout.PaddingValues(), { _, _ -> }, {},
        { id -> state = state.copy(selectedId = id) },
        onDeleteNote = { deletes++ },
        onDeletionHandled = { state = state.copy(deletedNoteId = null) })
    }
    composeTestRule.onNodeWithTag("note-note-1").performClick()
    composeTestRule.onNodeWithTag("note-detail-more").performClick()
    composeTestRule.onNodeWithTag("note-delete").performClick()
    composeTestRule.onNodeWithTag("note-cancel-delete").performClick()
    assertEquals(0, deletes)
    composeTestRule.onNodeWithTag("note-detail-title").assertExists()
    composeTestRule.onNodeWithTag("note-detail-more").performClick()
    composeTestRule.onNodeWithTag("note-delete").performClick()
    composeTestRule.onNodeWithTag("note-confirm-delete").performClick()
    assertEquals(1, deletes)
    composeTestRule.onNodeWithTag("note-detail-title").assertExists()
    composeTestRule.runOnIdle { state = state.copy(deleteBusy = true) }
    composeTestRule.onNodeWithTag("note-delete-busy").assertExists()
    composeTestRule.onNodeWithTag("note-detail-edit").assertIsNotEnabled()
    composeTestRule.runOnIdle { state = state.copy(deleteBusy = false, deleteError = true) }
    composeTestRule.onNodeWithTag("note-delete-error").assertExists()
    composeTestRule.runOnIdle { state = state.copy(items = emptyList(), detail = null,
      selectedId = null, deleteError = false, deletedNoteId = "note-1") }
    composeTestRule.onNodeWithTag("notes-empty").assertExists()
  }

  @Test fun autoCreatedNoteStaysInEditorUntilBackAndThenShowsDetail() {
    val local = NoteDraft("local-00000000-0000-0000-0000-000000000031", "Idea", "Body",
      "00000000-0000-0000-0000-000000000032", 2)
    val remote = NoteDetail("note-created", "Idea", "Body", "inbox", "thought",
      3000L, false, emptyList(), 1L)
    var state by mutableStateOf(NotesUiState(gatewayId = "test", draft = local))
    composeTestRule.setContent {
      NotesScreen(state, androidx.compose.foundation.layout.PaddingValues(), { _, _ -> }, {}, {},
        onSaveDraft = { state = state.copy(createdNoteId = remote.id) },
        onCreatedHandled = { state = state.copy(createdNoteId = null) })
    }
    composeTestRule.onNodeWithTag("notes-new").performClick()
    composeTestRule.onNodeWithTag("notes-create-text").performClick()
    composeTestRule.runOnIdle { state = state.copy(draft = local.copy(id = remote.id,
      baseRemoteVersion = 1), selectedId = remote.id, detail = remote,
      draftSyncedVersion = local.version) }
    composeTestRule.onNodeWithTag("notes-draft-body").assertExists().assertIsEnabled()
    composeTestRule.onNodeWithTag("notes-back").performClick()
    composeTestRule.onNodeWithTag("note-detail-title").assertExists()
  }

  @Test fun dirtyBackRequestsSaveAndWaitsForAcknowledgement() {
    val draft = NoteDraft("local-00000000-0000-0000-0000-000000000041", "Idea", "Body",
      "00000000-0000-0000-0000-000000000042", 2)
    var saves = 0
    composeTestRule.setContent {
      NotesScreen(NotesUiState(gatewayId = "test", draft = draft),
        androidx.compose.foundation.layout.PaddingValues(), { _, _ -> }, {}, {},
        onSaveDraft = { saves++ })
    }
    composeTestRule.onNodeWithTag("notes-new").performClick()
    composeTestRule.onNodeWithTag("notes-create-text").performClick()
    composeTestRule.onNodeWithTag("notes-back").performClick()
    assertEquals(1, saves)
    composeTestRule.onNodeWithTag("notes-draft-body").assertExists()
  }

  @Test fun activeSyncDoesNotLockTheDraftTextFields() {
    val draft = NoteDraft("note-1", "Idea", "Body", "00000000-0000-0000-0000-000000000033",
      3, 2)
    composeTestRule.setContent {
      NoteDraftContent(NotesUiState(draft = draft, draftSaving = true), { _, _ -> }, {})
    }
    composeTestRule.onNodeWithTag("notes-draft-title").assertIsEnabled()
    composeTestRule.onNodeWithTag("notes-draft-body").assertIsEnabled()
  }

  @Test fun conflictRequiresAnExplicitChoice() {
    val detail = NoteDetail("note-1", "Remote", "Remote body", "inbox", "thought",
      3000L, false, emptyList(), 5L)
    val draft = NoteDraft("note-1", "Mine", "Local body", "00000000-0000-0000-0000-000000000021", 7, 4)
    var decision: Boolean? = null
    composeTestRule.setContent {
      NoteDraftContent(NotesUiState(draft = draft, draftConflict = detail), { _, _ -> }, {},
        onResolveConflict = { decision = it })
    }
    composeTestRule.onNodeWithTag("notes-conflict").assertExists()
    composeTestRule.onNodeWithTag("notes-draft-save").assertIsNotEnabled()
    composeTestRule.onNodeWithTag("notes-keep-local").performClick()
    assertEquals(true, decision)
    composeTestRule.onNodeWithTag("notes-use-remote").performClick()
    assertEquals(false, decision)
  }

  @Test fun newNoteOpensEditorAndEditsStateDrivenDraft() {
    var started = 0
    var title = ""
    var body = ""
    var saved = 0
    var draft by mutableStateOf<NoteDraft?>(null)
    composeTestRule.setContent {
      NotesScreen(NotesUiState(gatewayId = "test", draft = draft,
        draftSavedVersion = draft?.version ?: 0), androidx.compose.foundation.layout.PaddingValues(),
        { _, _ -> }, {}, {}, { started++; draft = NoteDraft("local-00000000-0000-0000-0000-000000000001",
          "", "", "00000000-0000-0000-0000-000000000002", 1) },
        { nextTitle, nextBody ->
          title = nextTitle; body = nextBody
          draft = draft?.copy(title = nextTitle, markdown = nextBody, version = draft!!.version + 1)
        }, { saved++ })
    }
    composeTestRule.onNodeWithTag("notes-new").assertIsEnabled().performClick()
    composeTestRule.onNodeWithTag("notes-create-text").performClick()
    composeTestRule.onNodeWithTag("notes-draft-title").performTextInput("Idea")
    composeTestRule.onNodeWithTag("notes-draft-body").performTextInput("Body")
    composeTestRule.onNodeWithTag("notes-draft-save").performClick()
    assertEquals(1, started)
    assertEquals("Idea", title)
    assertEquals("Body", body)
    assertEquals(1, saved)
  }

  @Test fun markdownToolbarSupportsUndoAndRedo() {
    var draft by mutableStateOf(NoteDraft("local-00000000-0000-0000-0000-000000000081", "Idea", "Body",
      "00000000-0000-0000-0000-000000000082", 1))
    composeTestRule.setContent {
      NoteDraftContent(NotesUiState(draft = draft), { title, markdown ->
        draft = draft.copy(title = title, markdown = markdown, version = draft.version + 1)
      }, {})
    }
    composeTestRule.onNodeWithTag("notes-draft-body").performTextReplacement("Body updated")
    assertEquals("Body updated", draft.markdown)
    composeTestRule.onNodeWithTag("notes-undo").performClick()
    assertEquals("Body", draft.markdown)
    composeTestRule.onNodeWithTag("notes-redo").performClick()
    assertEquals("Body updated", draft.markdown)
  }

  @Test fun createSheetExposesTextAndVoiceWithoutStartingEitherAutomatically() {
    var started = 0
    var voice = 0
    composeTestRule.setContent {
      NotesScreen(NotesUiState(gatewayId = "test"),
        androidx.compose.foundation.layout.PaddingValues(), { _, _ -> }, {}, {},
        onNew = { started++ }, onStartVoice = { voice++ })
    }
    composeTestRule.onNodeWithTag("notes-new").performClick()
    assertEquals(0, started)
    assertEquals(0, voice)
    composeTestRule.onNodeWithTag("notes-create-voice").performClick()
    assertEquals(1, voice)
  }

  @Test fun fileSearchResultOpensPreviewThroughFilesSurface() {
    val file = ManagedFile("space.abc", "space", "readme.txt", "readme.txt",
      "file", "text/plain", 4)
    var query = ""
    composeTestRule.setContent {
      NotesScreen(NotesUiState(gatewayId = "test", search = query),
        androidx.compose.foundation.layout.PaddingValues(), { text, _ -> query = text }, {}, {},
        onNoteFileSpaces = { listOf(ManagedFileSpace("space", "Workspace", false)) },
        onNoteFiles = { _, _, search -> if (search.isNotEmpty()) listOf(file) else emptyList() },
        onNoteFileContent = { "test".toByteArray() })
    }
    composeTestRule.onNodeWithTag("notes-search").performTextInput("readme")
    composeTestRule.waitUntil(5_000) {
      composeTestRule.onAllNodesWithTag("notes-file-${file.id}").fetchSemanticsNodes().isNotEmpty()
    }
    composeTestRule.onNodeWithTag("notes-file-${file.id}").performClick()
    composeTestRule.waitUntil(5_000) {
      composeTestRule.onAllNodesWithTag("notes-file-preview").fetchSemanticsNodes().isNotEmpty()
    }
    composeTestRule.onNodeWithText("test").assertExists()
  }
}
