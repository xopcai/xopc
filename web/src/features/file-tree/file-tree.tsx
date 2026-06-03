import { ChevronRight, FileText, Folder, MoreHorizontal } from 'lucide-react';
import { useState } from 'react';

import { cn } from '@/lib/cn';

export interface TreeEntry {
  name: string;
  path: string;
  /** Host absolute path when provided by the gateway (copy path). */
  absolutePath?: string;
  isDirectory: boolean;
  children?: TreeEntry[];
}

export type FileTreeAction = 'preview' | 'download' | 'copyPath' | 'share';

export function fileExtColor(name: string): string {
  const lower = name.toLowerCase();
  if (lower.endsWith('.md')) return 'text-green-600 dark:text-green-400';
  if (lower.endsWith('.json')) return 'text-yellow-600 dark:text-yellow-400';
  if (lower.endsWith('.ts') || lower.endsWith('.js')) return 'text-blue-600 dark:text-blue-400';
  return 'text-fg-muted';
}

function ActionMenu({
  entry,
  labels,
  onAction,
}: {
  entry: TreeEntry;
  labels: { preview: string; download: string; copyPath: string; share: string };
  onAction: (action: FileTreeAction, entry: TreeEntry) => void;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const close = () => setMenuOpen(false);

  // Directories only get share + copy-path; preview/download have no sensible meaning.
  const items: { action: FileTreeAction; label: string }[] = entry.isDirectory
    ? [
        { action: 'share', label: labels.share },
        { action: 'copyPath', label: labels.copyPath },
      ]
    : [
        { action: 'preview', label: labels.preview },
        { action: 'download', label: labels.download },
        { action: 'share', label: labels.share },
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
            {items.map(({ action, label }) => (
              <button
                key={action}
                type="button"
                role="menuitem"
                className="block w-full px-3 py-1.5 text-left text-sm text-fg hover:bg-surface-hover"
                onClick={() => {
                  onAction(action, entry);
                  close();
                }}
              >
                {label}
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
  onSelect,
  onExpandDir,
  onAction,
  actionLabels,
}: {
  entry: TreeEntry;
  depth: number;
  selectedPath: string | null;
  onSelect: (path: string, isDir: boolean) => void;
  onExpandDir?: (dirPath: string) => void;
  onAction?: (action: FileTreeAction, entry: TreeEntry) => void;
  actionLabels?: { preview: string; download: string; copyPath: string; share: string };
}) {
  /** Collapsed by default; chevron must match visibility of children (incl. lazy-loaded empty → []). */
  const [open, setOpen] = useState(false);
  const isSel = selectedPath === entry.path;

  if (entry.isDirectory) {
    return (
      <div className="select-none">
        <div className="group flex w-full items-stretch gap-0.5">
          <button
            type="button"
            aria-expanded={open}
            className={cn(
              'flex min-w-0 flex-1 items-center gap-1 rounded-md py-1 pr-2 text-left text-sm',
              'hover:bg-surface-hover',
              isSel && 'bg-accent-soft text-accent-fg',
            )}
            style={{ paddingLeft: 8 + depth * 12 }}
            onClick={() => {
              const next = !open;
              setOpen(next);
              if (next) onExpandDir?.(entry.path);
              onSelect(entry.path, true);
            }}
          >
            <ChevronRight
              className={cn('size-3.5 shrink-0 transition-transform', open && 'rotate-90')}
              aria-hidden
            />
            <Folder className="size-3.5 shrink-0 text-fg-muted" aria-hidden />
            <span className="truncate">{entry.name}</span>
          </button>
          {onAction && actionLabels ? (
            <ActionMenu entry={entry} labels={actionLabels} onAction={onAction} />
          ) : null}
        </div>
        {open && entry.children?.length ? (
          <div>
            {entry.children.map((c) => (
              <TreeRow
                key={c.path}
                entry={c}
                depth={depth + 1}
                selectedPath={selectedPath}
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

export function FileTree({
  tree,
  selectedPath,
  onSelectFile,
  onSelectEntry,
  onExpandDir,
  onAction,
  actionLabels,
  emptyHint,
}: {
  tree: TreeEntry[];
  selectedPath: string | null;
  onSelectFile: (path: string) => void;
  /** Optional — fires on every row click (file or directory). Useful for pickers. */
  onSelectEntry?: (path: string, isDirectory: boolean) => void;
  onExpandDir?: (dirPath: string) => void;
  onAction?: (action: FileTreeAction, entry: TreeEntry) => void;
  actionLabels?: { preview: string; download: string; copyPath: string; share: string };
  emptyHint: string;
}) {
  const handleSelect = (path: string, isDir: boolean) => {
    onSelectEntry?.(path, isDir);
    if (!isDir) onSelectFile(path);
  };

  if (!tree.length) {
    return <p className="text-fg-muted px-3 py-2 text-xs">{emptyHint}</p>;
  }

  return (
    <div className="min-h-0 flex-1 overflow-y-auto py-2">
      {tree.map((e) => (
        <TreeRow
          key={e.path}
          entry={e}
          depth={0}
          selectedPath={selectedPath}
          onSelect={handleSelect}
          onExpandDir={onExpandDir}
          onAction={onAction}
          actionLabels={actionLabels}
        />
      ))}
    </div>
  );
}
