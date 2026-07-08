import { ChevronRight, FileText, Folder, MoreHorizontal } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';

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
  openWith?: string;
  revealInFolder?: string;
  recommendedApps?: string;
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
      entry.isDirectory ||
      !entry.absolutePath ||
      !isElectron() ||
      !window.electronAPI?.shell?.getOpenWithAppsForPath
    ) {
      setRecommendedApps([]);
      return;
    }
    let cancelled = false;
    void window.electronAPI.shell
      .getOpenWithAppsForPath(entry.absolutePath)
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
  }, [entry.absolutePath, entry.isDirectory, menuOpen]);

  // Directories only get share + copy-path; preview/download have no sensible meaning.
  const recommendedItems: { action: FileTreeAction; label: string; appPath: string }[] =
    entry.absolutePath && !entry.isDirectory
      ? recommendedApps.map((app) => ({
          action: 'openWithApp' as const,
          label: app.name,
          appPath: app.path,
        }))
      : [];

  const localItems: { action: FileTreeAction; label: string; appPath?: string }[] = entry.absolutePath
    ? [
        ...(entry.isDirectory || !labels.openDefault
          ? []
          : [{ action: 'openDefault' as const, label: labels.openDefault }]),
        ...(entry.isDirectory || !labels.openWith
          ? []
          : [{ action: 'openWith' as const, label: labels.openWith }]),
        ...(labels.revealInFolder
          ? [{ action: 'revealInFolder' as const, label: labels.revealInFolder }]
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
            {localItems.slice(0, labels.openDefault && !entry.isDirectory ? 1 : 0).map(({ action, label, appPath }) => (
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
          </div>
        ) : null}
      </div>
    </>
  );
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
}: {
  entry: TreeEntry;
  depth: number;
  selectedPath: string | null;
  forceOpen?: boolean;
  onSelect: (path: string, isDir: boolean) => void;
  onExpandDir?: (dirPath: string) => void;
  onAction?: (action: FileTreeAction, entry: TreeEntry, appPath?: string) => void;
  actionLabels?: FileTreeActionLabels;
}) {
  /** Collapsed by default; chevron must match visibility of children (incl. lazy-loaded empty → []). */
  const [open, setOpen] = useState(false);
  const visibleOpen = forceOpen || open;
  const isSel = selectedPath === entry.path;

  if (entry.isDirectory) {
    return (
      <div className="select-none">
        <div className="group flex w-full items-stretch gap-0.5">
          <button
            type="button"
            aria-expanded={visibleOpen}
            className={cn(
              'flex min-w-0 flex-1 items-center gap-1 rounded-md py-1 pr-2 text-left text-sm',
              'hover:bg-surface-hover',
              isSel && 'bg-accent-soft text-accent-fg',
            )}
            style={{ paddingLeft: 8 + depth * 12 }}
            onClick={() => {
              const next = !visibleOpen;
              setOpen(next);
              if (next) onExpandDir?.(entry.path);
              onSelect(entry.path, true);
            }}
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
        className={cn(
          'flex min-w-0 flex-1 items-center gap-1.5 rounded-md py-1 pr-2 text-left text-sm',
          'hover:bg-surface-hover',
          isSel && 'bg-accent-soft text-accent-fg',
        )}
        style={{ paddingLeft: 8 + depth * 12 }}
        onClick={() => onSelect(entry.path, false)}
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
    entry.path.toLocaleLowerCase().includes(query) ||
    entry.absolutePath?.toLocaleLowerCase().includes(query)
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
}) {
  const normalizedSearchQuery = (searchQuery ?? '').trim().toLocaleLowerCase();
  const visibleTree = useMemo(
    () => filterTreeEntries(tree, normalizedSearchQuery),
    [tree, normalizedSearchQuery],
  );
  const handleSelect = (path: string, isDir: boolean) => {
    onSelectEntry?.(path, isDir);
    if (!isDir) onSelectFile(path);
  };

  if (!tree.length) {
    return <p className="text-fg-muted px-3 py-2 text-xs">{emptyHint}</p>;
  }

  if (!visibleTree.length) {
    return <p className="px-3 py-2 text-xs text-fg-muted">{emptySearchHint ?? emptyHint}</p>;
  }

  return (
    <div className="min-h-0 flex-1 overflow-y-auto py-2">
      {visibleTree.map((e) => (
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
        />
      ))}
    </div>
  );
}
