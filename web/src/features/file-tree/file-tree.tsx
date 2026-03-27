import { ChevronRight, FileText, Folder } from 'lucide-react';
import { useState } from 'react';

import { cn } from '@/lib/cn';

export interface TreeEntry {
  name: string;
  path: string;
  isDirectory: boolean;
  children?: TreeEntry[];
}

function TreeRow({
  entry,
  depth,
  selectedPath,
  onSelect,
}: {
  entry: TreeEntry;
  depth: number;
  selectedPath: string | null;
  onSelect: (path: string, isDir: boolean) => void;
}) {
  const [open, setOpen] = useState(depth < 2);
  const isSel = selectedPath === entry.path;

  if (entry.isDirectory) {
    return (
      <div className="select-none">
        <button
          type="button"
          className={cn(
            'flex w-full items-center gap-1 rounded-md py-1 pr-2 text-left text-sm',
            'hover:bg-surface-hover',
            isSel && 'bg-accent-soft text-accent-fg',
          )}
          style={{ paddingLeft: 8 + depth * 12 }}
          onClick={() => {
            setOpen(!open);
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
        {open && entry.children?.length ? (
          <div>
            {entry.children.map((c) => (
              <TreeRow
                key={c.path}
                entry={c}
                depth={depth + 1}
                selectedPath={selectedPath}
                onSelect={onSelect}
              />
            ))}
          </div>
        ) : null}
      </div>
    );
  }

  return (
    <button
      type="button"
      className={cn(
        'flex w-full items-center gap-1.5 rounded-md py-1 pr-2 text-left text-sm',
        'hover:bg-surface-hover',
        isSel && 'bg-accent-soft text-accent-fg',
      )}
      style={{ paddingLeft: 8 + depth * 12 }}
      onClick={() => onSelect(entry.path, false)}
    >
      <FileText className="size-3.5 shrink-0 text-fg-muted" aria-hidden />
      <span className="truncate">{entry.name}</span>
    </button>
  );
}

export function FileTree({
  tree,
  selectedPath,
  onSelectFile,
  emptyHint,
}: {
  tree: TreeEntry[];
  selectedPath: string | null;
  onSelectFile: (path: string) => void;
  emptyHint: string;
}) {
  const handleSelect = (path: string, isDir: boolean) => {
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
        />
      ))}
    </div>
  );
}
