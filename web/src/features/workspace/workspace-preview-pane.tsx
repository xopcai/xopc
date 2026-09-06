import { memo, useEffect } from 'react';
import { useLocation, useParams } from 'react-router-dom';

import { WorkspaceFilePreviewPanel } from '@/features/workspace/workspace-file-preview-dialog';
import { useWorkspaceEditorAgentStore } from '@/stores/workspace-editor-agent-store';
import { useWorkspacePanelStore } from '@/stores/workspace-panel-store';
import { useWorkspacePreviewStore } from '@/stores/workspace-preview-store';

/**
 * Embedded workspace file preview pane (VSCode-style editor area).
 *
 * Lives inside the main layout as a sibling to <Outlet>, not as a portal dialog.
 * Clicking a file in the file tree simply swaps the content here — no modal
 * open/close animation.
 */
export const WorkspacePreviewPane = memo(function WorkspacePreviewPane({
  allowOutsideChat = false,
  sessionKey: sessionKeyOverride,
}: {
  allowOutsideChat?: boolean;
  sessionKey?: string;
} = {}) {
  const { pathname, search } = useLocation();
  const { sessionKey: sessionKeyParam } = useParams();
  const workspaceSessionKey = useWorkspacePanelStore((s) => s.sessionKeyOverride);
  const previewSessionKey = useWorkspacePreviewStore((s) => s.sessionKey);
  const chatSessionKey = previewSessionKey ?? sessionKeyOverride ?? workspaceSessionKey ?? (
    pathname.startsWith('/chat') && sessionKeyParam && sessionKeyParam !== 'new'
      ? decodeURIComponent(sessionKeyParam)
      : undefined
  );
  const path = useWorkspacePreviewStore((s) => s.path);
  const line = useWorkspacePreviewStore((s) => s.line);
  const previewProjectId = useWorkspacePreviewStore((s) => s.projectId);
  const projectId = previewProjectId ?? (!chatSessionKey && pathname.startsWith('/chat')
    ? new URLSearchParams(search).get('projectId') : null);
  const setPath = useWorkspacePreviewStore((s) => s.setPath);
  const editorAgentId = useWorkspaceEditorAgentStore((s) => s.agentId);

  // Keep a task-scoped workspace preview available after its modal closes.
  useEffect(() => {
    if (!allowOutsideChat && !workspaceSessionKey && !pathname.startsWith('/chat')) {
      setPath(null);
    }
  }, [allowOutsideChat, pathname, setPath, workspaceSessionKey]);

  // Escape closes the preview.
  useEffect(() => {
    if (!path) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented) return;
      setPath(null);
      e.stopPropagation();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
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
        projectId={projectId ?? undefined}
        sessionKey={chatSessionKey}
        agentId={editorAgentId.trim() || undefined}
        onClose={() => setPath(null)}
      />
    </div>
  );
});
