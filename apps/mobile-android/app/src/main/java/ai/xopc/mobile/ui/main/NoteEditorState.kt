package ai.xopc.mobile.ui.main

import ai.xopc.mobile.gateway.NoteDetail
import ai.xopc.mobile.gateway.NoteDraft
import ai.xopc.mobile.gateway.NoteSnapshot
import ai.xopc.mobile.gateway.reconcileNoteSave

/** Applies an acknowledged remote save to the latest editor state, not the sent snapshot. */
internal fun applyNoteSave(notes: NotesUiState, sent: NoteDraft, remote: NoteDetail,
  nextMutationId: String, closeRequested: Boolean): NotesUiState {
  val current = notes.draft?.takeIf { it.id == sent.id }
  val result = reconcileNoteSave(sent, current, remote, nextMutationId)
  val close = closeRequested && !result.needsSync
  return notes.copy(draft = if (close) null else result.draft, detail = remote,
    selectedId = remote.id, draftConflict = null,
    draftSyncedVersion = if (result.needsSync) sent.version else result.draft.version,
    draftSavedVersion = if (close) 0 else if (result.needsSync)
      notes.draftSavedVersion else result.draft.version,
    createdNoteId = if (close) remote.id else null,
    drafts = if (result.needsSync)
      listOf(result.draft) + notes.drafts.filterNot { it.id == sent.id || it.id == remote.id }
    else notes.drafts.filterNot { it.id == sent.id || it.id == remote.id })
}

internal data class RestoredNoteDraft(val draft: NoteDraft, val needsSync: Boolean)

internal fun restoredNoteDraft(detail: NoteDetail, snapshot: NoteSnapshot,
  previous: NoteDraft?, mutationId: String): RestoredNoteDraft {
  require(snapshot.noteId == detail.id) { "MISMATCHED_NOTE_SNAPSHOT" }
  val revision = requireNotNull(detail.remoteVersion) { "MISSING_NOTE_REVISION" }
  val title = snapshot.title ?: detail.title
  val draft = NoteDraft(detail.id, title, snapshot.markdown, mutationId,
    (previous?.version ?: 0) + 1, revision)
  return RestoredNoteDraft(draft, title != detail.title || snapshot.markdown != detail.markdown)
}
