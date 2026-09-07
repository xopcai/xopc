import { ChevronRight, FileText, Folder, MoreHorizontal } from 'lucide-react';
import { useEffect, useMemo, useState, type DragEvent } from 'react';

import type { FileTreeAction, TreeEntry } from '@/features/file-tree/file-tree-types';
import { fileExtColor } from '@/features/file-tree/file-tree-utils';
import { cn } from '@/lib/cn';
import { isElectron } from '@/lib/electron-env';

type FileTreeActionLabels = {
  preview: string;
  download: string;
  copyPath: string;
  share?: string;
  openDefault?: string;
  openDirectory?: string;
  openWith?: string;
  revealInFolder?: string;
  trash?: string;
  delete?: string;
  recommendedApps?: string;
  desktopUpdateRequired?: string;
};

function ActionMenu({
  entry,
  labels,
  onAction,
}: {
  entry: TreeEntry;
  labels: FileTreeActionLabels;
  onAction: (action: FileTreeAction, entry: TreeEntry, appPath?: string) => void;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [recommendedApps, setRecommendedApps] = useState<Array<{ name: string; path: string }>>([]);
  const close = () => setMenuOpen(false);

  useEffect(() => {
    if (
      !menuOpen ||
      !entry.fileId ||
      !isElectron() ||
      !window.electronAPI?.shell?.getOpenWithAppsForFileResource
    ) {
      setRecommendedApps([]);
      return;
    }
    let cancelled = false;
    void window.electronAPI.shell
      .getOpenWithAppsForFileResource(entry.fileId)
      .then((apps) => {
        if (!cancelled) {
          setRecommendedApps(apps.recommended.map((app) => ({ name: app.name, path: app.path })));
        }
      })
      .catch(() => {
        if (!cancelled) setRecommendedApps([]);
      });
    return () => {
      cancelled = true;
    };
  }, [entry.fileId, entry.isDirectory, menuOpen]);

  // Managed directories can be opened locally, but preview/download still apply only to files.
  const recommendedItems: { action: FileTreeAction; label: string; appPath: string }[] =
    entry.fileId
      ? recommendedApps.map((app) => ({
          action: 'openWithApp' as const,
          label: app.name,
          appPath: app.path,
        }))
      : [];

  const shell = isElectron() ? window.electronAPI?.shell : undefined;
  const defaultOpenLabel = entry.isDirectory ? labels.openDirectory : labels.openDefault;
  const localItems: { action: FileTreeAction; label: string; appPath?: string }[] = entry.fileId
    ? [
        ...(!defaultOpenLabel || !shell?.openFileResource
          ? []
          : [{ action: 'openDefault' as const, label: defaultOpenLabel }]),
        ...(!labels.openWith || !shell?.chooseAppAndOpenFileResource
          ? []
          : [{ action: 'openWith' as const, label: labels.openWith }]),
        ...(labels.revealInFolder && shell?.showFileResourceInFolder
          ? [{ action: 'revealInFolder' as const, label: labels.revealInFolder }]
          : []),
        ...(!entry.isDirectory && labels.trash && shell?.trashFileResource
          ? [{ action: 'trash' as const, label: labels.trash }]
          : []),
      ]
    : [];

  const items: { action: FileTreeAction; label: string; appPath?: string }[] = entry.isDirectory
    ? [
        ...localItems,
        ...(labels.share ? [{ action: 'share' as const, label: labels.share }] : []),
        { action: 'copyPath', label: labels.copyPath },
      ]
    : [
        ...localItems,
        { action: 'preview', label: labels.preview },
        { action: 'download', label: labels.download },
        ...(labels.share ? [{ action: 'share' as const, label: labels.share }] : []),
        { action: 'copyPath', label: labels.copyPath },
        ...(labels.delete ? [{ action: 'delete' as const, label: labels.delete }] : []),
      ];

  return (
    <>
      {menuOpen ? (
        <button
          type="button"
          className="fixed inset-0 z-40 cursor-default bg-transparent"
          aria-hidden
          tabIndex={-1}
          onPointerDown={(e) => {
            e.preventDefault();
            close();
          }}
        />
      ) : null}
      <div className="relative shrink-0">
        <button
          type="button"
          className={cn(
            'rounded-md p-1 text-fg-muted opacity-0 transition-opacity hover:bg-surface-hover hover:text-fg',
            'group-hover:opacity-100',
            menuOpen && 'opacity-100',
          )}
          aria-haspopup="menu"
          aria-expanded={menuOpen}
          aria-label="More"
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => {
            e.stopPropagation();
            setMenuOpen((v) => !v);
          }}
        >
          <MoreHorizontal className="size-3.5" aria-hidden />
        </button>
        {menuOpen ? (
          <div
            role="menu"
            className="absolute right-0 top-full z-50 mt-0.5 min-w-[9rem] rounded-md border border-edge bg-surface-panel py-1 shadow-popover"
            onPointerDown={(e) => e.stopPropagation()}
          >
            {isElectron() && entry.fileId && !shell?.openFileResource && labels.desktopUpdateRequired ? (
              <button
                type="button"
                role="menuitem"
                disabled
                className="block w-full cursor-not-allowed px-3 py-1.5 text-left text-sm text-fg-subtle opacity-70"
                title={labels.desktopUpdateRequired}
              >
                <span className="block truncate">{labels.desktopUpdateRequired}</span>
              </button>
            ) : null}
            {localItems.filter((item) => item.action === 'openDefault').map(({ action, label, appPath }) => (
              <button
                key={appPath ? `${action}:${appPath}` : action}
                type="button"
                role="menuitem"
                className="block w-full px-3 py-1.5 text-left text-sm text-fg hover:bg-surface-hover"
                title={appPath}
                onClick={() => {
                  onAction(action, entry, appPath);
                  close();
                }}
              >
                <span className="block truncate">{label}</span>
              </button>
            ))}
            {labels.recommendedApps && recommendedItems.length > 0 ? (
              <>
                <p className="border-t border-edge-subtle px-3 pb-1 pt-2 text-[11px] font-medium uppercase tracking-normal text-fg-subtle dark:border-edge">
                  {labels.recommendedApps}
                </p>
                {recommendedItems.map(({ action, label, appPath }) => (
                  <button
                    key={`${action}:${appPath}`}
                    type="button"
                    role="menuitem"
                    className="block w-full min-w-0 px-3 py-1.5 text-left text-sm text-fg hover:bg-surface-hover"
                    title={appPath}
                    onClick={() => {
                      onAction(action, entry, appPath);
                      close();
                    }}
                  >
                    <span className="block truncate">{label}</span>
                  </button>
                ))}
              </>
            ) : null}
            {items
              .filter((item) => item.action !== 'openDefault')
              .map(({ action, label, appPath }) => (
              <button
                key={appPath ? `${action}:${appPath}` : action}
                type="button"
                role="menuitem"
                className={cn(
                  'block w-full px-3 py-1.5 text-left text-sm text-fg hover:bg-surface-hover',
                  (action === 'trash' || action === 'delete') && 'text-danger hover:bg-danger/10 hover:text-danger',
                )}
                title={appPath}
                onClick={() => {
                  onAction(action, entry, appPath);
                  close();
                }}
              >
                <span className="block truncate">{label}</span>
              </button>
            ))}
          </div>
        ) : null}
      </div>
    </>
  );
}

function isFileUploadDrag(event: DragEvent<HTMLElement>): boolean {
  return Array.from(event.dataTransfer.types).includes('Files');
}

function parentDirectory(path: string): string {
  const separator = path.lastIndexOf('/');
  return separator < 0 ? '' : path.slice(0, separator);
}

function TreeRow({
  entry,
  depth,
  selectedPath,
  forceOpen,
  onSelect,
  onExpandDir,
  onAction,
  actionLabels,
  onFileDragStart,
  onUploadFiles,
  onUploadTargetEnter,
}: {
  entry: TreeEntry;
  depth: number;
  selectedPath: string | null;
  forceOpen?: boolean;
  onSelect: (path: string, isDir: boolean) => void;
  onExpandDir?: (dirPath: string) => void;
  onAction?: (action: FileTreeAction, entry: TreeEntry, appPath?: string) => void;
  actionLabels?: FileTreeActionLabels;
  onFileDragStart?: (event: DragEvent<HTMLButtonElement>, entry: TreeEntry) => void;
  onUploadFiles?: (files: File[], directory: string) => void;
  onUploadTargetEnter?: () => void;
}) {
  /** Collapsed by default; chevron must match visibility of children (incl. lazy-loaded empty → []). */
  const [open, setOpen] = useState(false);
  const [dropActive, setDropActive] = useState(false);
  const visibleOpen = forceOpen || open;
  const isSel = selectedPath === entry.path;

  if (entry.isDirectory) {
    return (
      <div className="select-none">
        <div className="group flex w-full items-stretch gap-0.5">
          <button
            type="button"
            aria-expanded={visibleOpen}
            data-file-drop-directory={entry.path}
            className={cn(
              'flex min-w-0 flex-1 items-center gap-1 rounded-md py-1 pr-2 text-left text-sm',
              'hover:bg-surface-hover',
              isSel && 'bg-accent-soft text-accent-fg',
              dropActive && 'bg-accent-soft text-accent-fg ring-1 ring-inset ring-accent',
            )}
            style={{ paddingLeft: 8 + depth * 12 }}
            onClick={() => {
              const next = !visibleOpen;
              setOpen(next);
              if (next) onExpandDir?.(entry.path);
              onSelect(entry.path, true);
            }}
            onDragEnter={onUploadFiles ? (event) => {
              if (!isFileUploadDrag(event)) return;
              event.preventDefault();
              event.stopPropagation();
              onUploadTargetEnter?.();
              setDropActive(true);
            } : undefined}
            onDragOver={onUploadFiles ? (event) => {
              if (!isFileUploadDrag(event)) return;
              event.preventDefault();
              event.stopPropagation();
              event.dataTransfer.dropEffect = 'copy';
              setDropActive(true);
            } : undefined}
            onDragLeave={onUploadFiles ? (event) => {
              event.stopPropagation();
              if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDropActive(false);
            } : undefined}
            onDrop={onUploadFiles ? (event) => {
              if (!isFileUploadDrag(event)) return;
              event.preventDefault();
              event.stopPropagation();
              setDropActive(false);
              const files = Array.from(event.dataTransfer.files);
              if (files.length) onUploadFiles(files, entry.path);
            } : undefined}
          >
            <ChevronRight
              className={cn('size-3.5 shrink-0 transition-transform', visibleOpen && 'rotate-90')}
              aria-hidden
            />
            <Folder className="size-3.5 shrink-0 text-fg-muted" aria-hidden />
            <span className="truncate">{entry.name}</span>
          </button>
          {onAction && actionLabels ? (
            <ActionMenu entry={entry} labels={actionLabels} onAction={onAction} />
          ) : null}
        </div>
        {visibleOpen && entry.children?.length ? (
          <div>
            {entry.children.map((c) => (
              <TreeRow
                key={c.path}
                entry={c}
                depth={depth + 1}
                selectedPath={selectedPath}
                forceOpen={forceOpen}
                onSelect={onSelect}
                onExpandDir={onExpandDir}
                onAction={onAction}
                actionLabels={actionLabels}
                onFileDragStart={onFileDragStart}
                onUploadFiles={onUploadFiles}
                onUploadTargetEnter={onUploadTargetEnter}
              />
            ))}
          </div>
        ) : null}
      </div>
    );
  }

  return (
    <div className="group flex w-full items-stretch gap-0.5">
      <button
        type="button"
        draggable={Boolean(onFileDragStart)}
        className={cn(
          'flex min-w-0 flex-1 items-center gap-1.5 rounded-md py-1 pr-2 text-left text-sm',
          'hover:bg-surface-hover',
          onFileDragStart && 'cursor-grab active:cursor-grabbing',
          isSel && 'bg-accent-soft text-accent-fg',
          dropActive && 'bg-accent-soft text-accent-fg ring-1 ring-inset ring-accent',
        )}
        style={{ paddingLeft: 8 + depth * 12 }}
        onClick={() => onSelect(entry.path, false)}
        onDragStart={onFileDragStart ? (event) => onFileDragStart(event, entry) : undefined}
        onDragEnter={onUploadFiles ? (event) => {
          if (!isFileUploadDrag(event)) return;
          event.preventDefault();
          event.stopPropagation();
          onUploadTargetEnter?.();
          setDropActive(true);
        } : undefined}
        onDragOver={onUploadFiles ? (event) => {
          if (!isFileUploadDrag(event)) return;
          event.preventDefault();
          event.stopPropagation();
          event.dataTransfer.dropEffect = 'copy';
          setDropActive(true);
        } : undefined}
        onDragLeave={onUploadFiles ? (event) => {
          event.stopPropagation();
          if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDropActive(false);
        } : undefined}
        onDrop={onUploadFiles ? (event) => {
          if (!isFileUploadDrag(event)) return;
          event.preventDefault();
          event.stopPropagation();
          setDropActive(false);
          const files = Array.from(event.dataTransfer.files);
          if (files.length) onUploadFiles(files, parentDirectory(entry.path));
        } : undefined}
      >
        <FileText className={cn('size-3.5 shrink-0', fileExtColor(entry.name))} aria-hidden />
        <span className="truncate">{entry.name}</span>
      </button>
      {onAction && actionLabels ? (
        <ActionMenu entry={entry} labels={actionLabels} onAction={onAction} />
      ) : null}
    </div>
  );
}

function fileTreeEntryMatches(entry: TreeEntry, query: string) {
  return (
    entry.name.toLocaleLowerCase().includes(query) ||
    entry.path.toLocaleLowerCase().includes(query)
  );
}

function filterTreeEntries(entries: TreeEntry[], query: string): TreeEntry[] {
  if (!query) return entries;
  return entries.flatMap((entry) => {
    const children = entry.children ? filterTreeEntries(entry.children, query) : undefined;
    if (fileTreeEntryMatches(entry, query) || children?.length) {
      return [{ ...entry, children }];
    }
    return [];
  });
}

export function FileTree({
  tree,
  selectedPath,
  onSelectFile,
  onSelectEntry,
  onExpandDir,
  onAction,
  actionLabels,
  emptyHint,
  searchQuery,
  emptySearchHint,
  onFileDragStart,
  onUploadFiles,
  uploadDropHint,
}: {
  tree: TreeEntry[];
  selectedPath: string | null;
  onSelectFile: (path: string) => void;
  /** Optional — fires on every row click (file or directory). Useful for pickers. */
  onSelectEntry?: (path: string, isDirectory: boolean) => void;
  onExpandDir?: (dirPath: string) => void;
  onAction?: (action: FileTreeAction, entry: TreeEntry, appPath?: string) => void;
  actionLabels?: FileTreeActionLabels;
  emptyHint: string;
  searchQuery?: string;
  emptySearchHint?: string;
  onFileDragStart?: (event: DragEvent<HTMLButtonElement>, entry: TreeEntry) => void;
  onUploadFiles?: (files: File[], directory: string) => void;
  uploadDropHint?: string;
}) {
  const [rootDropActive, setRootDropActive] = useState(false);
  const normalizedSearchQuery = (searchQuery ?? '').trim().toLocaleLowerCase();
  const visibleTree = useMemo(
    () => filterTreeEntries(tree, normalizedSearchQuery),
    [tree, normalizedSearchQuery],
  );
  const handleSelect = (path: string, isDir: boolean) => {
    onSelectEntry?.(path, isDir);
    if (!isDir) onSelectFile(path);
  };

  return (
    <div
      className={cn(
        'relative min-h-0 flex-1 overflow-y-auto py-2',
        rootDropActive && 'bg-accent-soft/60 ring-1 ring-inset ring-accent',
      )}
      data-file-drop-directory=""
      onDragEnter={onUploadFiles ? (event) => {
        if (!isFileUploadDrag(event)) return;
        event.preventDefault();
        setRootDropActive(true);
      } : undefined}
      onDragOver={onUploadFiles ? (event) => {
        if (!isFileUploadDrag(event)) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = 'copy';
        setRootDropActive(true);
      } : undefined}
      onDragLeave={onUploadFiles ? (event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setRootDropActive(false);
      } : undefined}
      onDrop={onUploadFiles ? (event) => {
        if (!isFileUploadDrag(event)) return;
        event.preventDefault();
        setRootDropActive(false);
        const files = Array.from(event.dataTransfer.files);
        if (files.length) onUploadFiles(files, '');
      } : undefined}
    >
      {rootDropActive && uploadDropHint ? (
        <div className="pointer-events-none sticky top-0 z-20 mx-2 mb-1 rounded-md border border-accent bg-surface-panel/95 px-3 py-2 text-center text-xs font-medium text-accent-fg shadow-sm">
          {uploadDropHint}
        </div>
      ) : null}
      {!tree.length ? (
        <p className="px-3 py-2 text-xs text-fg-muted">{emptyHint}</p>
      ) : !visibleTree.length ? (
        <p className="px-3 py-2 text-xs text-fg-muted">{emptySearchHint ?? emptyHint}</p>
      ) : visibleTree.map((e) => (
          <TreeRow
            key={e.path}
            entry={e}
            depth={0}
            selectedPath={selectedPath}
            forceOpen={Boolean(normalizedSearchQuery)}
            onSelect={handleSelect}
            onExpandDir={onExpandDir}
            onAction={onAction}
            actionLabels={actionLabels}
            onFileDragStart={onFileDragStart}
            onUploadFiles={onUploadFiles}
            onUploadTargetEnter={() => setRootDropActive(false)}
          />
      ))}
    </div>
  );
}
