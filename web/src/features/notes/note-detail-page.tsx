import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { useCallback, useMemo } from "react";

import { safeInternalReturnPath } from "@/lib/navigation-return";

import { NoteDetailPanel } from "./note-detail-panel";

export function NoteDetailPage() {
  const { noteId } = useParams<{ noteId: string }>();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const returnPath = useMemo(() => safeInternalReturnPath(
    searchParams.get("returnTo"),
    "/notes",
    ["/chat", "/projects", "/notes", "/tasks"],
  ), [searchParams]);

  const handleBack = useCallback(() => {
    navigate(returnPath);
  }, [navigate, returnPath]);

  if (!noteId) {
    return null;
  }

  return (
    <div className="mx-auto flex h-full min-h-0 w-full max-w-6xl flex-1 flex-col">
      <NoteDetailPanel noteId={noteId} onBack={handleBack} />
    </div>
  );
}
