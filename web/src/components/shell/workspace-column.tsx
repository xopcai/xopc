import { FileText, Search, X } from 'lucide-react';
import { memo, useCallback, useEffect, useMemo, useState, type CSSProperties } from 'react';
import { useLocation, useParams } from 'react-router-dom';

import { APP_CHROME_NO_DRAG_CLASS } from '@/components/shell/app-chrome';
import { Button } from '@/components/ui/button';
import { RefreshButton } from '@/components/ui/refresh-button';
import { Skeleton } from '@/components/ui/skeleton';
import {
  FileTree,
} from '@/features/file-tree/file-tree';
import type { FileTreeAction, TreeEntry } from '@/features/file-tree/file-tree-types';
import { inferMimeTypeFromFileName } from '@/features/chat/attachments/attachment-utils-core';
import {
  downloadBinaryFile,
  downloadTextFile,
  fetchWorkspaceFileBlob,
  readWorkspaceFile,
  searchWorkspaceFiles,
} from '@/features/workspace/workspace-api';
import {
  detectPreviewFileType,
  getPreviewFileName,
  readModeForPreviewType,
} from '@/features/preview-runtime';
import { showComposerNotification } from '@/features/chat/composer/composer-notifications';
import { ShareLinkDialog } from '@/features/shares/share-link-dialog';
import { useShareLink } from '@/features/shares/use-share-link';
import { useWorkspaceTree } from '@/features/workspace/use-workspace-tree';
import { WorkspaceOpenLocationMenu } from '@/features/workspace/workspace-open-location-menu';
import { cn } from '@/lib/cn';
import { copyTextToClipboard } from '@/lib/copy-to-clipboard';
import { isElectron } from '@/lib/electron-env';
import { messages } from '@/i18n/messages';
import { useLocaleStore } from '@/stores/locale-store';
import { useWorkspaceEditorAgentStore } from '@/stores/workspace-editor-agent-store';
import { clampWorkspacePanelWidthPx, useWorkspacePanelStore } from '@/stores/workspace-panel-store';
import { useWorkspacePreviewStore } from '@/stores/workspace-preview-store';

/** Right-hand workspace file browser (project files only). Preview uses `WorkspacePreviewDialog`. */
export const WorkspaceColumn = memo(function WorkspaceColumn({ elevated = false }: { elevated?: boolean }) {
  const language = useLocaleStore((s) => s.language);
  const m = messages(language);
  const { pathname } = useLocation();
  const { sessionKey: sessionKeyParam } = useParams();
  const routeChatSessionKey =
    pathname.startsWith('/chat') && sessionKeyParam
      ? decodeURIComponent(sessionKeyParam)
      : null;
  const open = useWorkspacePanelStore((s) => s.open);
  const setOpen = useWorkspacePanelStore((s) => s.setOpen);
  const sessionKeyOverride = useWorkspacePanelStore((s) => s.sessionKeyOverride);
  const widthPx = useWorkspacePanelStore((s) => s.widthPx);
  const setWidthPx = useWorkspacePanelStore((s) => s.setWidthPx);
  const chatSessionKey = sessionKeyOverride ?? routeChatSessionKey;
  const [widthResizing, setWidthResizing] = useState(false);
  const [fileSearchOpen, setFileSearchOpen] = useState(false);
  const [fileSearchQuery, setFileSearchQuery] = useState('');
  const [fileSearchResults, setFileSearchResults] = useState<Array<{ name: string; path: string }>>([]);
  const [fileSearchLoading, setFileSearchLoading] = useState(false);
  const [fileSearchError, setFileSearchError] = useState<string | null>(null);
  const previewPath = useWorkspacePreviewStore((s) => s.path);
  const setPreviewPath = useWorkspacePreviewStore((s) => s.setPath);
  const workspaceAgentId = useWorkspaceEditorAgentStore((s) => s.agentId);

  const { tree, loading, error, workspaceRoot, loadRoot, loadChildren, reset } = useWorkspaceTree(
    workspaceAgentId,
    chatSessionKey,
  );
  /** When the tree is session-scoped, agent id from the store is irrelevant — avoid re-fetching on agent sync. */
  const treeScopeKey = chatSessionKey ?? workspaceAgentId;

  const workspaceReadOpts = useMemo(
    () =>
      chatSessionKey != null
        ? { sessionKey: chatSessionKey }
        : workspaceAgentId.trim()
          ? { agentId: workspaceAgentId.trim() }
          : undefined,
    [chatSessionKey, workspaceAgentId],
  );
  const normalizedFileSearchQuery = fileSearchQuery.trim();

  const {
    dialogOpen,
    loading: shareLoading,
    result,
    error: shareError,
    pendingParams: pendingShareParams,
    createShareLink,
    confirmShareLink,
    handleOpenChange,
  } = useShareLink();

  const onWorkspaceResizePointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (!open) return;
      e.preventDefault();
      const el = e.currentTarget;
      const panelEl = el.closest<HTMLElement>('#app-workspace-panel');
      el.setPointerCapture(e.pointerId);
      setWidthResizing(true);
      const startX = e.clientX;
      const startW = useWorkspacePanelStore.getState().widthPx;
      const pid = e.pointerId;
      let rafId = 0;
      let nextWidth = startW;
      let committedWidth = startW;
      const applyWidth = () => {
        rafId = 0;
        committedWidth = nextWidth;
        panelEl?.style.setProperty('--workspace-panel-px', `${committedWidth}px`);
      };
      const onMove = (ev: PointerEvent) => {
        // Left edge: drag left widens, drag right narrows
        nextWidth = clampWorkspacePanelWidthPx(startW + (startX - ev.clientX));
        if (rafId === 0) {
          rafId = window.requestAnimationFrame(applyWidth);
        }
      };
      const onDone = () => {
        if (rafId !== 0) {
          window.cancelAnimationFrame(rafId);
          applyWidth();
        }
        try {
          el.releasePointerCapture(pid);
        } catch {
          /* ignore */
        }
        setWidthResizing(false);
        setWidthPx(committedWidth);
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', onDone);
        window.removeEventListener('pointercancel', onDone);
      };
      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onDone);
      window.addEventListener('pointercancel', onDone);
    },
    [open, setWidthPx],
  );

  useEffect(() => {
    if (!pathname.startsWith('/chat')) {
      setOpen(false);
    }
  }, [pathname, setOpen]);

  useEffect(() => {
    if (!open) {
      reset();
      setPreviewPath(null);
      return;
    }
    setPreviewPath(null);
    void loadRoot();
  }, [open, treeScopeKey, loadRoot, reset, setPreviewPath]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if (fileSearchOpen) {
        e.preventDefault();
        e.stopPropagation();
        setFileSearchQuery('');
        setFileSearchOpen(false);
        return;
      }
      if (useWorkspacePreviewStore.getState().path) return;
      setOpen(false);
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [fileSearchOpen, open, setOpen]);

  useEffect(() => {
    if (!open || !fileSearchOpen || !normalizedFileSearchQuery) {
      setFileSearchResults([]);
      setFileSearchLoading(false);
      setFileSearchError(null);
      return;
    }
    let cancelled = false;
    setFileSearchLoading(true);
    setFileSearchError(null);
    setFileSearchResults([]);
    const timer = window.setTimeout(() => {
      void searchWorkspaceFiles(normalizedFileSearchQuery, workspaceReadOpts, 50)
        .then((entries) => {
          if (!cancelled) setFileSearchResults(entries);
        })
        .catch((err) => {
          if (!cancelled) setFileSearchError(err instanceof Error ? err.message : String(err));
        })
        .finally(() => {
          if (!cancelled) setFileSearchLoading(false);
        });
    }, 180);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [fileSearchOpen, normalizedFileSearchQuery, open, workspaceReadOpts]);

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
    async (action: FileTreeAction, entry: TreeEntry, appPath?: string) => {
      switch (action) {
        case 'preview':
          if (entry.isDirectory) return;
          setPreviewPath(entry.path);
          break;
        case 'download':
          if (entry.isDirectory) return;
          try {
            const fileName = getPreviewFileName(entry.path);
            if (readModeForPreviewType(detectPreviewFileType(fileName)) !== 'text') {
              const blob = await fetchWorkspaceFileBlob(entry.path, workspaceReadOpts);
              const buf = await blob.arrayBuffer();
              const mime = inferMimeTypeFromFileName(fileName) ?? 'application/octet-stream';
              downloadBinaryFile(fileName, buf, mime);
            } else {
              const { content } = await readWorkspaceFile(entry.path, workspaceReadOpts);
              downloadTextFile(fileName, content);
            }
          } catch {
            /* ignore */
          }
          break;
        case 'copyPath':
          try {
            const ok = await copyTextToClipboard(entry.absolutePath ?? entry.path);
            if (ok) {
              showComposerNotification('success', m.workspace.pathCopied, undefined, { duration: 2500 });
            }
          } catch {
            /* ignore */
          }
          break;
        case 'openDefault':
          if (!entry.absolutePath || !window.electronAPI?.shell?.openPath) return;
          await window.electronAPI.shell.openPath(entry.absolutePath);
          break;
        case 'openWith':
          if (!entry.absolutePath || !window.electronAPI?.shell?.chooseAppAndOpenPath) return;
          await window.electronAPI.shell.chooseAppAndOpenPath(entry.absolutePath);
          break;
        case 'openWithApp':
          if (!entry.absolutePath || !appPath || !window.electronAPI?.shell?.openPathWithApp) return;
          await window.electronAPI.shell.openPathWithApp(entry.absolutePath, appPath);
          break;
        case 'revealInFolder':
          if (!entry.absolutePath || !window.electronAPI?.shell?.showItemInFolder) return;
          await window.electronAPI.shell.showItemInFolder(entry.absolutePath);
          break;
        case 'share':
          await createShareLink({
            path: entry.path,
            ...(entry.isDirectory ? { kind: 'directory', directoryMode: 'browse' } : {}),
            ...workspaceReadOpts,
          });
          break;
        default:
          break;
      }
    },
    [createShareLink, m.workspace.pathCopied, setPreviewPath, workspaceReadOpts],
  );

  return (
    <>
      {open ? (
        <button
          type="button"
          className={cn('fixed inset-0 bg-scrim md:hidden', elevated ? 'z-[109]' : 'z-40')}
          aria-label={m.closeMenu}
          onClick={() => setOpen(false)}
        />
      ) : null}

      <aside
        id="app-workspace-panel"
        aria-label={m.workspace.title}
        aria-hidden={!open}
        className={cn(
          'flex min-h-0 flex-col overflow-hidden bg-surface-base',
          'max-md:fixed max-md:right-0 max-md:top-0 max-md:h-[100dvh] max-md:shadow-popover',
          'max-md:transition-transform max-md:duration-200 max-md:ease-out',
          'motion-reduce:max-md:transition-none',
          'max-md:w-[min(20rem,92vw)]',
          open ? 'max-md:translate-x-0' : 'max-md:pointer-events-none max-md:translate-x-full',
          'md:relative md:h-full md:translate-x-0',
          elevated && open ? 'pointer-events-auto z-[110]' : 'max-md:z-50',
          'motion-reduce:md:transition-none',
          !open &&
            'md:pointer-events-none md:w-0 md:min-w-0 md:max-w-0 md:overflow-hidden',
          open && 'app-workspace-panel-expanded-width md:shrink-0',
          open && widthResizing && 'workspace-panel-rail-resizing',
        )}
        style={
          open
            ? ({
                '--workspace-panel-px': `${widthPx}px`,
              } as CSSProperties)
            : undefined
        }
      >
        {open ? (
          <div
            className={cn(
              'relative flex h-full min-h-0 w-full min-w-0 flex-col overflow-x-hidden overflow-y-hidden bg-surface-base',
            )}
          >
            <div
              role="separator"
              aria-orientation="vertical"
              aria-label={m.workspace.resizeHandleAria}
              onPointerDown={onWorkspaceResizePointerDown}
              className={cn(
                'pointer-events-auto absolute left-0 top-0 z-20 hidden h-full w-2 cursor-col-resize md:block',
                "before:content-[''] before:pointer-events-none before:absolute before:left-1/2 before:top-0 before:z-0 before:h-full before:w-px before:-translate-x-1/2",
                'before:bg-transparent before:transition-[background-color] before:duration-150',
                'hover:bg-surface-hover/20 hover:before:bg-edge/65 dark:hover:before:bg-edge/75',
                widthResizing && 'bg-surface-hover/30 before:!bg-edge/80 dark:before:!bg-edge/85',
                'transition-[background-color] duration-150',
                'touch-none select-none',
                APP_CHROME_NO_DRAG_CLASS,
              )}
            />
            <div className="flex h-11 shrink-0 items-center gap-2 border-b border-edge px-4 dark:border-edge">
              <h2 className="sr-only">{m.workspace.title}</h2>
              <WorkspaceOpenLocationMenu workspacePath={workspaceRoot ?? ''} />
              <div className="ml-auto flex shrink-0 items-center gap-1">
                <Button
                  type="button"
                  variant="ghost"
                  className={cn('size-9 shrink-0 rounded-md p-0', fileSearchOpen && 'bg-surface-hover text-fg')}
                  aria-label={m.workspace.search}
                  title={m.workspace.search}
                  aria-pressed={fileSearchOpen}
                  onClick={() => setFileSearchOpen(true)}
                >
                  <Search className="size-4" strokeWidth={1.75} />
                </Button>
                <RefreshButton
                  className="size-9 shrink-0 rounded-md p-0"
                  loading={loading}
                  label={m.cron.refresh}
                  onClick={loadRoot}
                />
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
            </div>

            {fileSearchOpen ? (
              <div className="shrink-0 border-b border-edge bg-surface-muted/40 px-3 py-2">
                <div className="flex h-9 items-center gap-2 rounded-md border border-edge bg-surface-panel px-2 focus-within:border-accent focus-within:ring-2 focus-within:ring-accent/20">
                  <Search className="size-4 shrink-0 text-fg-subtle" strokeWidth={1.75} aria-hidden />
                  <input
                    type="text"
                    role="searchbox"
                    value={fileSearchQuery}
                    onChange={(event) => setFileSearchQuery(event.target.value)}
                    placeholder={m.workspace.searchPlaceholder}
                    aria-label={m.workspace.searchPlaceholder}
                    className="min-w-0 flex-1 bg-transparent text-sm text-fg outline-none placeholder:text-fg-subtle"
                  />
                  <button
                    type="button"
                    className="flex size-7 shrink-0 items-center justify-center rounded-md text-fg-muted hover:bg-surface-hover hover:text-fg"
                    aria-label={m.workspace.clearSearch}
                    title={m.workspace.clearSearch}
                    onClick={() => {
                      setFileSearchQuery('');
                      setFileSearchOpen(false);
                    }}
                  >
                    <X className="size-4" strokeWidth={1.75} aria-hidden />
                  </button>
                </div>
              </div>
            ) : null}

            {error ? (
              <p className="shrink-0 px-4 py-2 text-xs text-red-600 dark:text-red-400">
                {m.workspace.loadError}: {error}
              </p>
            ) : null}

            {normalizedFileSearchQuery ? (
              <div className="min-h-0 flex-1 overflow-y-auto py-2">
                {fileSearchLoading ? (
                  <div className="space-y-2 px-3 py-1">
                    <Skeleton className="h-11 w-full" />
                    <Skeleton className="h-11 w-full" />
                    <Skeleton className="h-11 w-full" />
                  </div>
                ) : fileSearchError ? (
                  <p className="px-3 py-2 text-xs text-red-600 dark:text-red-400">
                    {m.workspace.loadError}: {fileSearchError}
                  </p>
                ) : fileSearchResults.length === 0 ? (
                  <p className="px-3 py-2 text-xs text-fg-muted">{m.workspace.noSearchResults}</p>
                ) : (
                  fileSearchResults.map((entry) => (
                    <button
                      key={entry.path}
                      type="button"
                      className={cn(
                        'flex w-full min-w-0 items-center gap-2 px-3 py-2 text-left hover:bg-surface-hover',
                        previewPath === entry.path && 'bg-accent-soft text-accent-fg',
                      )}
                      onClick={() => setPreviewPath(entry.path)}
                      title={entry.path}
                    >
                      <FileText className="size-4 shrink-0 text-fg-muted" aria-hidden />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm text-fg">{entry.name}</span>
                        <span className="block truncate text-xs text-fg-subtle">{entry.path}</span>
                      </span>
                    </button>
                  ))
                )}
              </div>
            ) : (
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
                  share: m.workspace.shareLink,
                  ...(isElectron()
                    ? {
                        openDefault: m.workspace.openSystemApp,
                        openWith: m.workspace.chooseApp,
                        revealInFolder: m.workspace.revealInFolder,
                        recommendedApps: m.workspace.recommendedApps,
                      }
                    : {}),
                }}
                emptyHint={m.workspace.emptyDir}
              />
            )}
          </div>
        ) : null}
      </aside>

      <ShareLinkDialog
        open={dialogOpen}
        onOpenChange={handleOpenChange}
        loading={shareLoading}
        error={shareError}
        result={result}
        pendingParams={pendingShareParams}
        onConfirm={(options) => void confirmShareLink(options)}
      />
    </>
  );
});
