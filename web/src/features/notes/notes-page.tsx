import { useParams, useSearchParams } from 'react-router-dom';

import { NotesHomePage } from './notes-home-page';
import { NoteDetailPage } from './note-detail-page';

export function NotesPage() {
  const { noteId } = useParams<{ noteId?: string }>();
  const [searchParams] = useSearchParams();
  const returnTo = searchParams.get('returnTo')?.trim() ?? '';
  const openedFromExternalModule =
    Boolean(noteId) && Boolean(returnTo) && !returnTo.startsWith('/notes');

  if (openedFromExternalModule) {
    return <NoteDetailPage />;
  }

  return <NotesHomePage selectedNoteId={noteId} />;
}
