import { memo, useEffect } from 'react';
import { useLocation, useParams } from 'react-router-dom';

import { WorkspaceFilePreviewPanel } from '@/features/workspace/workspace-file-preview-dialog';
import { useWorkspaceEditorAgentStore } from '@/stores/workspace-editor-agent-store';
import { useWorkspacePreviewStore } from '@/stores/workspace-preview-store';

/**
 * Embedded workspace file preview pane (VSCode-style editor area).
 *
 * Lives inside the main layout as a sibling to <Outlet>, not as a portal dialog.
 * Clicking a file in the file tree simply swaps the content here — no modal
 * open/close animation.
 */
export const WorkspacePreviewPane = memo(function WorkspacePreviewPane() {
  const { pathname } = useLocation();
  const { sessionKey: sessionKeyParam } = useParams();
  const chatSessionKey =
    pathname.startsWith('/chat') && sessionKeyParam
      ? decodeURIComponent(sessionKeyParam)
      : undefined;
  const path = useWorkspacePreviewStore((s) => s.path);
  const line = useWorkspacePreviewStore((s) => s.line);
  const setPath = useWorkspacePreviewStore((s) => s.setPath);
  const editorAgentId = useWorkspaceEditorAgentStore((s) => s.agentId);

  // Close preview when leaving /chat routes.
  useEffect(() => {
    if (!pathname.startsWith('/chat')) {
      setPath(null);
    }
  }, [pathname, setPath]);

  // Escape closes the preview.
  useEffect(() => {
    if (!path) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      setPath(null);
      e.stopPropagation();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [path, setPath]);

  if (!path) {
    return null;
  }

  return (
    <div
      role="region"
      aria-label="File preview"
      className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden border border-edge bg-surface-panel dark:border-edge"
    >
      <WorkspaceFilePreviewPanel
        filePath={path}
        targetLine={line}
        sessionKey={chatSessionKey}
        agentId={editorAgentId.trim() || undefined}
        onClose={() => setPath(null)}
      />
    </div>
  );
});
