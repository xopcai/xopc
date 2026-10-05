package ai.xopc.mobile.gateway

data class NoteSaveReconciliation(val draft: NoteDraft, val needsSync: Boolean)

/** Acknowledging an older write must never replace edits made while that write was in flight. */
fun reconcileNoteSave(sent: NoteDraft, current: NoteDraft?, note: NoteDetail,
  nextMutationId: String): NoteSaveReconciliation {
  require(note.remoteVersion != null && note.remoteVersion > 0) { "INVALID_NOTE_REVISION" }
  require(current == null || current.id == sent.id) { "MISMATCHED_NOTE_DRAFT" }
  return if (current != null && current.version > sent.version) {
    NoteSaveReconciliation(current.copy(id = note.id, baseRemoteVersion = note.remoteVersion,
      mutationId = nextMutationId), true)
  } else {
    NoteSaveReconciliation(NoteDraft(note.id, note.title, note.markdown, nextMutationId,
      current?.version ?: sent.version, note.remoteVersion), false)
  }
}
