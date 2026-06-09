import { useNavigate, useParams } from 'react-router-dom';
import { useCallback } from 'react';

import { NoteDetailPanel } from './note-detail-panel';

export function NoteDetailPage() {
  const { noteId } = useParams<{ noteId: string }>();
  const navigate = useNavigate();

  const handleBack = useCallback(() => {
    navigate('/notes');
  }, [navigate]);

  if (!noteId) {
    return null;
  }

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-1 flex-col">
      <NoteDetailPanel noteId={noteId} onBack={handleBack} />
    </div>
  );
}
