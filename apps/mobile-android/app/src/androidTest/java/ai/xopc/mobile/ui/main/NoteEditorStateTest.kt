package ai.xopc.mobile.ui.main

import ai.xopc.mobile.gateway.NoteDetail
import ai.xopc.mobile.gateway.NoteDraft
import ai.xopc.mobile.gateway.NoteSnapshot
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class NoteEditorStateTest {
  private val sent = NoteDraft("local-00000000-0000-0000-0000-000000000051", "Before",
    "Old body", "00000000-0000-0000-0000-000000000052", 3)
  private val remote = NoteDetail("note-remote", "Before", "Old body", "inbox", "thought",
    2000L, false, emptyList(), 2L)
  private val nextKey = "00000000-0000-0000-0000-000000000053"

  @Test fun newerKeystrokesSurviveAndKeepEditorOpenDespiteCloseRequest() {
    val latest = sent.copy(title = "After", markdown = "New body", version = 4)
    val next = applyNoteSave(NotesUiState(draft = latest, drafts = listOf(latest)), sent,
      remote, nextKey, true)
    assertEquals("New body", next.draft?.markdown)
    assertEquals(remote.id, next.draft?.id)
    assertEquals(2L, next.draft?.baseRemoteVersion)
    assertEquals(sent.version, next.draftSyncedVersion)
    assertEquals(listOf(remote.id), next.drafts.map { it.id })
    assertNull(next.createdNoteId)
  }

  @Test fun cleanAutoSaveKeepsEditorButManualDoneClosesIt() {
    val notes = NotesUiState(draft = sent, drafts = listOf(sent))
    val auto = applyNoteSave(notes, sent, remote, nextKey, false)
    assertEquals(remote.id, auto.draft?.id)
    assertEquals(auto.draft?.version, auto.draftSyncedVersion)
    assertEquals(emptyList<NoteDraft>(), auto.drafts)
    assertNull(auto.createdNoteId)
    val done = applyNoteSave(notes, sent, remote, nextKey, true)
    assertNull(done.draft)
    assertEquals(remote.id, done.createdNoteId)
  }

  @Test fun restoringCurrentContentDoesNotScheduleAnotherRemoteMutation() {
    val current = NoteDetail("note-remote", "Current", "Current body", "inbox", "thought",
      2000L, false, emptyList(), 5L)
    val previous = NoteDraft("note-remote", "Unsynced", "Unsynced body", nextKey, 7, 4)
    val same = NoteSnapshot("note-remote", 1234L, "sync", "Current", "Current body")
    val clean = restoredNoteDraft(current, same, previous, nextKey)
    assertEquals(false, clean.needsSync)
    assertEquals(8L, clean.draft.version)
    assertEquals(5L, clean.draft.baseRemoteVersion)
    val older = restoredNoteDraft(current, same.copy(markdown = "Older body"), previous, nextKey)
    assertEquals(true, older.needsSync)
    assertEquals("Older body", older.draft.markdown)
  }
}
