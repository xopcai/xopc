import { useParams } from 'react-router-dom';

import { NotesWorkbench } from './notes-workbench';

export function NotesPage() {
  const { noteId } = useParams<{ noteId?: string }>();
  return (
    <NotesWorkbench
      selectedNoteId={noteId}
      basePath="/notes"
      managePageHeader
      showLibrary
      allowMediaCapture
      listWidthStorageKey="xopc.notes.listWidth"
    />
  );
}
