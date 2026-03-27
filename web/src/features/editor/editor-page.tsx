import { FolderOpen, Search } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';

import { MarkdownSplit } from '@/components/markdown/markdown-split';
import { FileTree, type TreeEntry } from '@/features/file-tree/file-tree';
import { useEditorStore } from '@/features/editor/editor-store';
import { isElectron } from '@/lib/electron-env';
import {
  createElectronWorkspaceAdapter,
  createGatewayWorkspaceAdapter,
  type WorkspaceFilesAdapter,
} from '@/lib/workspace-files';
import { useThemeStore } from '@/stores/theme-store';

async function loadTreeRecursive(adapter: WorkspaceFilesAdapter, dir: string): Promise<TreeEntry[]> {
  const raw = await adapter.list(dir);
  const out: TreeEntry[] = [];
  for (const e of raw) {
    if (e.isDirectory) {
      const children = await loadTreeRecursive(adapter, e.path);
      out.push({ name: e.name, path: e.path, isDirectory: true, children });
    } else {
      out.push({ name: e.name, path: e.path, isDirectory: false });
    }
  }
  return out;
}

export function EditorPage() {
  const { rootDir, selectedPath, fileContent, setRootDir, setSelectedPath, setFileContent } =
    useEditorStore();
  const resolved = useThemeStore((s) => s.resolved);
  const isDark = resolved === 'dark';
  const [searchQuery, setSearchQuery] = useState('');
  const [searchHits, setSearchHits] = useState<
    Array<{ filePath: string; lineNumber: number; lineContent: string }>
  >([]);
  const [tree, setTree] = useState<TreeEntry[]>([]);
  const [treeError, setTreeError] = useState<string | null>(null);

  const electronMode = isElectron();
  const adapter = useMemo((): WorkspaceFilesAdapter | null => {
    if (electronMode) {
      return createElectronWorkspaceAdapter(rootDir);
    }
    return createGatewayWorkspaceAdapter();
  }, [electronMode, rootDir]);

  const refreshTree = useCallback(async () => {
    if (!adapter) {
      setTree([]);
      return;
    }
    setTreeError(null);
    try {
      if (adapter.kind === 'electron' && !rootDir) {
        setTree([]);
        return;
      }
      const baseDir = '';
      const entries = await loadTreeRecursive(adapter, baseDir);
      setTree(entries);
    } catch (e) {
      setTree([]);
      setTreeError(e instanceof Error ? e.message : String(e));
    }
  }, [adapter, rootDir]);

  useEffect(() => {
    void refreshTree();
  }, [refreshTree]);

  const openFolder = useCallback(async () => {
    const api = window.electronAPI;
    if (!api) return;
    const dir = await api.file.openDirectory();
    if (dir) {
      setRootDir(dir);
      setSelectedPath(null);
      setFileContent('');
    }
  }, [setRootDir, setSelectedPath, setFileContent]);

  const loadFile = useCallback(
    async (path: string) => {
      if (!adapter) return;
      const text = await adapter.read(path);
      setSelectedPath(path);
      setFileContent(text);
      if (electronMode && window.electronAPI) {
        window.electronAPI.file.watchFile(path, (next) => {
          setFileContent(next);
        });
      }
    },
    [adapter, electronMode, setSelectedPath, setFileContent],
  );

  const handleSave = useCallback(
    async (content: string) => {
      if (!selectedPath || !adapter) return;
      await adapter.write(selectedPath, content);
    },
    [selectedPath, adapter],
  );

  const runSearch = useCallback(async () => {
    if (!adapter || !searchQuery.trim()) {
      setSearchHits([]);
      return;
    }
    try {
      const baseDir = '';
      if (adapter.kind === 'electron' && !rootDir) {
        setSearchHits([]);
        return;
      }
      const raw = await adapter.search(searchQuery.trim(), baseDir);
      setSearchHits(
        raw.map((r) => ({ filePath: r.filePath, lineNumber: r.lineNumber, lineContent: r.lineContent })),
      );
    } catch {
      setSearchHits([]);
    }
  }, [adapter, rootDir, searchQuery]);

  const emptyTreeHint = useMemo(() => {
    if (treeError) return treeError;
    if (adapter?.kind === 'electron' && !rootDir) return 'Open a folder to browse files.';
    if (!adapter) return 'Loading…';
    return 'No matching files in this folder.';
  }, [adapter, rootDir, treeError]);

  return (
    <div className="bg-surface-base flex min-h-0 flex-1 flex-col">
      <header className="border-edge flex shrink-0 flex-wrap items-center gap-2 border-b px-4 py-3">
        {electronMode ? (
          <button
            type="button"
            className="bg-surface-panel border-edge text-fg inline-flex items-center gap-2 rounded-lg border px-3 py-2 text-sm font-medium hover:bg-surface-hover"
            onClick={() => void openFolder()}
          >
            <FolderOpen className="size-4" aria-hidden />
            Open folder
          </button>
        ) : null}
        {adapter ? (
          <span className="text-fg-muted max-w-md truncate text-xs" title={adapter.displayRootLabel}>
            {adapter.kind === 'electron' && rootDir ? rootDir : adapter.displayRootLabel}
          </span>
        ) : null}
        <div className="ml-auto flex min-w-[12rem] max-w-md flex-1 items-center gap-2">
          <input
            type="search"
            placeholder="Search in folder…"
            className="border-edge bg-surface-panel text-fg placeholder:text-fg-subtle flex-1 rounded-lg border px-3 py-2 text-sm"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && void runSearch()}
          />
          <button
            type="button"
            className="text-accent-fg hover:text-accent-hover inline-flex items-center gap-1 text-sm"
            onClick={() => void runSearch()}
          >
            <Search className="size-4" aria-hidden />
            Search
          </button>
        </div>
      </header>
      <div className="flex min-h-0 flex-1">
        <aside className="border-edge bg-surface-panel flex w-56 shrink-0 flex-col border-r md:w-64">
          <FileTree
            tree={tree}
            selectedPath={selectedPath}
            onSelectFile={(path) => void loadFile(path)}
            emptyHint={emptyTreeHint}
          />
          {searchHits.length > 0 ? (
            <div className="border-edge max-h-40 overflow-y-auto border-t p-2 text-xs">
              <p className="text-fg-muted mb-1 font-medium">Results</p>
              <ul className="space-y-1">
                {searchHits.slice(0, 20).map((h, i) => (
                  <li key={`${h.filePath}:${h.lineNumber}:${i}`}>
                    <button
                      type="button"
                      className="text-accent-fg hover:underline w-full truncate text-left"
                      title={h.lineContent}
                      onClick={() => void loadFile(h.filePath)}
                    >
                      {h.filePath}:{h.lineNumber}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </aside>
        <main className="min-h-0 min-w-0 flex-1">
          {selectedPath ? (
            <MarkdownSplit
              key={selectedPath}
              initialContent={fileContent}
              onSave={handleSave}
              isDark={isDark}
            />
          ) : (
            <div className="text-fg-muted flex h-full items-center justify-center text-sm">
              Select a file
              {adapter?.kind === 'electron' && !rootDir ? ' after opening a folder' : ''}.
            </div>
          )}
        </main>
      </div>
    </div>
  );
}
