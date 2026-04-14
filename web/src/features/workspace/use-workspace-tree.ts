import { useCallback, useRef, useState } from 'react';

import type { TreeEntry } from '@/features/file-tree/file-tree';
import { listWorkspaceDir, type WorkspaceEntry } from '@/features/workspace/workspace-api';

/** Convert flat API entries into TreeEntry nodes (children initially empty for dirs). */
function toTreeEntries(entries: WorkspaceEntry[]): TreeEntry[] {
  return entries.map((entry) => ({
    name: entry.name,
    path: entry.path,
    isDirectory: entry.isDirectory,
    children: entry.isDirectory ? [] : undefined,
  }));
}

/** Recursively merge loaded children into an existing tree at targetPath. */
function mergeChildren(
  tree: TreeEntry[],
  targetPath: string,
  children: TreeEntry[],
): TreeEntry[] {
  return tree.map((node) => {
    if (node.path === targetPath) {
      return { ...node, children };
    }
    if (node.isDirectory && node.children?.length) {
      return { ...node, children: mergeChildren(node.children, targetPath, children) };
    }
    return node;
  });
}

export function useWorkspaceTree() {
  const [tree, setTree] = useState<TreeEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const loadedDirsRef = useRef<Set<string>>(new Set());

  const loadRoot = useCallback(async () => {
    setLoading(true);
    setError(null);
    loadedDirsRef.current.clear();
    try {
      const entries = await listWorkspaceDir('');
      setTree(toTreeEntries(entries));
      loadedDirsRef.current.add('');
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  const loadChildren = useCallback(async (dirPath: string) => {
    if (loadedDirsRef.current.has(dirPath)) return;
    loadedDirsRef.current.add(dirPath);
    try {
      const entries = await listWorkspaceDir(dirPath);
      const children = toTreeEntries(entries);
      setTree((prev) => mergeChildren(prev, dirPath, children));
    } catch {
      loadedDirsRef.current.delete(dirPath);
    }
  }, []);

  const reset = useCallback(() => {
    setTree([]);
    setError(null);
    loadedDirsRef.current.clear();
  }, []);

  return { tree, loading, error, loadRoot, loadChildren, reset };
}
