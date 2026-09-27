import { XopcNote, XopcNoteDraft } from '../model/note';

/** Result of reconciling a remote save with edits made while that save was in flight. */
export interface XopcNoteSaveReconciliation {
  /** Draft that should remain authoritative on the device. */
  draft: XopcNoteDraft;
  /** Whether another remote save is required. */
  needsSync: boolean;
}

/** Reconciles an acknowledged save without allowing an older response to replace newer keystrokes. */
export function reconcileNoteSave(sent: XopcNoteDraft, current: XopcNoteDraft | undefined, note: XopcNote,
  mutationId: string): XopcNoteSaveReconciliation {
  const remoteVersion = note.remoteVersion ?? 1;
  if (current && current.localVersion > sent.localVersion) {
    return {
      draft: {
        noteId: note.id,
        title: current.title,
        markdown: current.markdown,
        baseRevision: remoteVersion,
        localVersion: current.localVersion,
        updatedAt: current.updatedAt,
        syncState: 'dirty',
        mutationId
      },
      needsSync: true
    };
  }
  return {
    draft: {
      noteId: note.id,
      title: note.title ?? '',
      markdown: note.markdown,
      baseRevision: remoteVersion,
      localVersion: note.localVersion ?? sent.localVersion,
      updatedAt: note.updatedAt,
      syncState: 'clean',
      mutationId
    },
    needsSync: false
  };
}
