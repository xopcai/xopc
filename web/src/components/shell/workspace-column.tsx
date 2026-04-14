import { FolderOpen, RefreshCw, X } from 'lucide-react';
import { memo, useCallback, useEffect, useState } from 'react';
import { useLocation } from 'react-router-dom';

import { Button } from '@/components/ui/button';
import {
  FileTree,
  type FileTreeAction,
  type TreeEntry,
} from '@/features/file-tree/file-tree';
import {
  downloadTextFile,
  readWorkspaceFile,
} from '@/features/workspace/workspace-api';
import { getFileName } from '@/features/workspace/workspace-file-preview-dialog';
import { useWorkspaceTree } from '@/features/workspace/use-workspace-tree';
import { cn } from '@/lib/cn';
import { messages } from '@/i18n/messages';
import { useLocaleStore } from '@/stores/locale-store';
import { useWorkspaceEditorAgentStore } from '@/stores/workspace-editor-agent-store';
import { useWorkspacePanelStore } from '@/stores/workspace-panel-store';
import { useWorkspacePreviewStore } from '@/stores/workspace-preview-store';

/** Right-hand workspace file browser (project files only). Preview uses `WorkspacePreviewDialog`. */
export const WorkspaceColumn = memo(function WorkspaceColumn() {
  const language = useLocaleStore((s) => s.language);
  const m = messages(language);
  const { pathname } = useLocation();
  const open = useWorkspacePanelStore((s) => s.open);
  const setOpen = useWorkspacePanelStore((s) => s.setOpen);
  const previewPath = useWorkspacePreviewStore((s) => s.path);
  const setPreviewPath = useWorkspacePreviewStore((s) => s.setPath);
  const workspaceAgentId = useWorkspaceEditorAgentStore((s) => s.agentId);

  const { tree, loading, error, loadRoot, loadChildren, reset } = useWorkspaceTree(workspaceAgentId);
  const [pathCopiedFlash, setPathCopiedFlash] = useState(false);

  useEffect(() => {
    if (!pathname.startsWith('/chat')) {
      setOpen(false);
    }
  }, [pathname, setOpen]);

  useEffect(() => {
    if (!open) {
      reset();
      setPreviewPath(null);
      setPathCopiedFlash(false);
      return;
    }
    setPreviewPath(null);
    void loadRoot();
  }, [open, workspaceAgentId, loadRoot, reset, setPreviewPath]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if (useWorkspacePreviewStore.getState().path) return;
      setOpen(false);
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [open, setOpen]);

  useEffect(() => {
    if (!open) return;
    const mq = window.matchMedia('(max-width: 767px)');
    if (!mq.matches) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);

  const handleExpandDir = useCallback(
    (dirPath: string) => {
      void loadChildren(dirPath);
    },
    [loadChildren],
  );

  const handleAction = useCallback(
    async (action: FileTreeAction, entry: TreeEntry) => {
      if (entry.isDirectory) return;
      switch (action) {
        case 'preview':
          setPreviewPath(entry.path);
          break;
        case 'download':
          try {
            const { content } = await readWorkspaceFile(
              entry.path,
              workspaceAgentId.trim() ? { agentId: workspaceAgentId.trim() } : undefined,
            );
            downloadTextFile(getFileName(entry.path), content);
          } catch {
            /* ignore */
          }
          break;
        case 'copyPath':
          try {
            await navigator.clipboard.writeText(entry.path);
            setPathCopiedFlash(true);
            window.setTimeout(() => setPathCopiedFlash(false), 2000);
          } catch {
            /* ignore */
          }
          break;
        default:
          break;
      }
    },
    [setPreviewPath, workspaceAgentId],
  );

  return (
    <>
      {open ? (
        <button
          type="button"
          className="fixed inset-0 z-40 bg-scrim md:hidden"
          aria-label={m.closeMenu}
          onClick={() => setOpen(false)}
        />
      ) : null}

      <aside
        id="app-workspace-panel"
        aria-label={m.workspace.title}
        aria-hidden={!open}
        className={cn(
          'flex min-h-0 flex-col overflow-hidden bg-surface-panel',
          'max-md:fixed max-md:right-0 max-md:top-0 max-md:z-50 max-md:h-[100dvh] max-md:shadow-popover',
          'max-md:transition-transform max-md:duration-200 max-md:ease-out',
          'motion-reduce:max-md:transition-none',
          'max-md:w-[min(20rem,92vw)]',
          open ? 'max-md:translate-x-0' : 'max-md:pointer-events-none max-md:translate-x-full',
          open && 'max-md:border-l max-md:border-edge max-md:dark:border-edge',
          'md:relative md:h-full md:translate-x-0',
          open &&
            'md:transition-[width,max-width] md:duration-300 md:ease-[cubic-bezier(0.22,1,0.36,1)]',
          'motion-reduce:md:transition-none',
          !open &&
            'md:pointer-events-none md:w-0 md:min-w-0 md:max-w-0 md:overflow-hidden md:border-l-0',
          open && 'md:w-80 md:max-w-80 md:shrink-0 md:border-l md:border-edge md:dark:border-edge',
        )}
      >
        {open ? (
          <div className="flex h-full min-h-0 w-80 min-w-0 max-w-80 shrink-0 grow-0 flex-col overflow-x-hidden bg-surface-panel">
            <div className="flex h-11 shrink-0 items-center gap-2 border-b border-edge px-4 dark:border-edge">
              <FolderOpen className="size-4 shrink-0 text-fg-muted" aria-hidden />
              <h2 className="min-w-0 flex-1 truncate text-base font-semibold leading-tight tracking-tight text-fg">
                {m.workspace.title}
              </h2>
              <button
                type="button"
                className="inline-flex size-9 shrink-0 items-center justify-center rounded-md text-fg-muted transition-colors hover:bg-surface-hover hover:text-fg disabled:opacity-50"
                title={m.cron.refresh}
                aria-label={m.cron.refresh}
                disabled={loading}
                onClick={() => void loadRoot()}
              >
                <RefreshCw className={cn('size-4', loading && 'animate-spin')} aria-hidden />
              </button>
              <Button
                type="button"
                variant="ghost"
                className="size-9 shrink-0 rounded-md p-0"
                aria-label={m.workspace.close}
                title={m.workspace.close}
                onClick={() => setOpen(false)}
              >
                <X className="size-4" strokeWidth={1.75} />
              </Button>
            </div>

            <p className="shrink-0 border-b border-edge px-4 py-2 text-xs text-fg-muted dark:border-edge">
              {m.workspace.currentWorkspace}
              {pathCopiedFlash ? (
                <span className="mt-1 block text-green-600 dark:text-green-400">
                  {m.workspace.pathCopied}
                </span>
              ) : null}
            </p>

            {error ? (
              <p className="shrink-0 px-4 py-2 text-xs text-red-600 dark:text-red-400">
                {m.workspace.loadError}: {error}
              </p>
            ) : null}

            <FileTree
              tree={tree}
              selectedPath={previewPath}
              onSelectFile={(path) => setPreviewPath(path)}
              onExpandDir={handleExpandDir}
              onAction={handleAction}
              actionLabels={{
                preview: m.workspace.preview,
                download: m.workspace.download,
                copyPath: m.workspace.copyPath,
              }}
              emptyHint={m.workspace.emptyDir}
            />
          </div>
        ) : null}
      </aside>
    </>
  );
});
