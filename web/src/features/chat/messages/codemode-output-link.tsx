import { useState } from 'react';

import { Button } from '@/components/ui/button';
import { resolveWorkspaceFileReference } from '@/features/workspace/workspace-api';
import { useWorkspacePreviewStore } from '@/stores/workspace-preview-store';

export function CodemodeOutputLink({ path, conversationId, label }: { path: string; conversationId?: string | null; label: string }) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string>();
  const setPreview = useWorkspacePreviewStore(state => state.setPath);
  const open = async () => {
    setPending(true);
    setError(undefined);
    try {
      const file = await resolveWorkspaceFileReference(path, { conversationId: conversationId ?? undefined });
      if (!file?.capabilities.includes('preview')) throw new Error('Output file is unavailable');
      setPreview(file.absolutePath ?? file.workspaceRelativePath ?? path, undefined, undefined, conversationId);
    } catch (failure) { setError(failure instanceof Error ? failure.message : String(failure)); }
    finally { setPending(false); }
  };
  return <div className="mt-2"><Button variant="ghost" disabled={pending} onClick={() => { void open(); }} className="text-accent">{label}</Button>
    {error ? <p className="text-xs text-red-600">{error}</p> : null}</div>;
}
