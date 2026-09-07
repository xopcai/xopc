import { useParams } from 'react-router-dom';

import { NotesHomePage } from './notes-home-page';
import { NoteDetailPage } from './note-detail-page';

export function NotesPage() {
  const { noteId } = useParams<{ noteId?: string }>();
  return noteId ? <NoteDetailPage /> : <NotesHomePage />;
}
