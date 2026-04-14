import * as Dialog from '@radix-ui/react-dialog';
import { FolderOpen, RefreshCw, X } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';

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
import {
  getFileName,
  WorkspaceFilePreviewPanel,
} from '@/features/workspace/workspace-file-preview-dialog';
import { useWorkspaceTree } from '@/features/workspace/use-workspace-tree';
import { cn } from '@/lib/cn';
import { messages } from '@/i18n/messages';
import { useLocaleStore } from '@/stores/locale-store';
import { useSidebarStore } from '@/stores/sidebar-store';

export interface WorkspaceDrawerProps {
  open: boolean;
  onClose: () => void;
}

export function WorkspaceDrawer({ open, onClose }: WorkspaceDrawerProps) {
  const language = useLocaleStore((s) => s.language);
  const m = messages(language);
  const sidebarCollapsed = useSidebarStore((s) => s.collapsed);

  const { tree, loading, error, loadRoot, loadChildren, reset } = useWorkspaceTree();
  const [previewFilePath, setPreviewFilePath] = useState<string | null>(null);
  const [pathCopiedFlash, setPathCopiedFlash] = useState(false);

  useEffect(() => {
    if (!open) {
      reset();
      setPreviewFilePath(null);
      setPathCopiedFlash(false);
      return;
    }
    void loadRoot();
  }, [open, loadRoot, reset]);

  const handleExpandDir = useCallback(
    (dirPath: string) => {
      void loadChildren(dirPath);
    },
    [loadChildren],
  );

  const handleAction = useCallback(async (action: FileTreeAction, entry: TreeEntry) => {
    if (entry.isDirectory) return;
    switch (action) {
      case 'preview':
        setPreviewFilePath(entry.path);
        break;
      case 'download':
        try {
          const { content } = await readWorkspaceFile(entry.path);
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
  }, []);

  const drawerWidth = sidebarCollapsed ? '4.5rem' : '16rem';
  const splitDrawerWidth = `calc(100vw - ${drawerWidth})`;

  return (
    <Dialog.Root open={open} onOpenChange={(v) => !v && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay
          className="xopc-dialog-overlay fixed inset-0 z-[70] bg-scrim"
          onPointerDown={(e) => {
            if (e.target === e.currentTarget) onClose();
          }}
        />
        <Dialog.Content
          className={cn(
            'xopc-drawer-right xopc-workspace-drawer fixed inset-y-0 right-0 z-[71] flex h-full flex-row items-stretch overflow-hidden border-l border-edge bg-surface-panel shadow-popover outline-none',
            'dark:border-edge',
            /* Single column: keep tree flush-right so width shrink does not sweep the panel; avoids flex min-content widening the column mid-transition */
            !previewFilePath && 'w-80 max-w-full justify-end',
          )}
          style={previewFilePath ? { width: splitDrawerWidth } : undefined}
          aria-describedby={undefined}
          onInteractOutside={(e) => e.preventDefault()}
          onPointerDownOutside={(e) => e.preventDefault()}
        >
          {previewFilePath ? (
            <div
              key={previewFilePath}
              className="xopc-workspace-preview-pane flex min-h-0 min-w-0 flex-1 flex-col border-r border-edge dark:border-edge"
            >
              <WorkspaceFilePreviewPanel
                filePath={previewFilePath}
                onClose={() => setPreviewFilePath(null)}
              />
            </div>
          ) : null}

          <div className="flex h-full min-h-0 w-80 min-w-0 max-w-80 shrink-0 grow-0 flex-col overflow-x-hidden bg-surface-panel">
            <div className="flex h-11 shrink-0 items-center gap-2 border-b border-edge px-4 dark:border-edge">
              <FolderOpen className="size-4 shrink-0 text-fg-muted" aria-hidden />
              <Dialog.Title className="min-w-0 flex-1 truncate text-base font-semibold leading-tight tracking-tight text-fg">
                {m.workspace.title}
              </Dialog.Title>
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
              <Dialog.Close asChild>
                <Button
                  type="button"
                  variant="ghost"
                  className="size-9 shrink-0 rounded-md p-0"
                  aria-label={m.workspace.close}
                >
                  <X className="size-4" strokeWidth={1.75} />
                </Button>
              </Dialog.Close>
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
              selectedPath={previewFilePath}
              onSelectFile={(path) => setPreviewFilePath(path)}
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
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
