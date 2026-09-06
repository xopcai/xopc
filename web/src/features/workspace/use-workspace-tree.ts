import { useCallback, useMemo, useRef, useState } from 'react';

import type { TreeEntry } from '@/features/file-tree/file-tree-types';
import {
  fetchWorkspaceDirectoryListing,
  fetchWorkspaceRootResource,
  listWorkspaceDir,
  type WorkspaceEntry,
  type WorkspaceEditorRequestOptions,
} from '@/features/workspace/workspace-api';

/** Convert flat API entries into TreeEntry nodes (children initially empty for dirs). */
function toTreeEntries(entries: WorkspaceEntry[]): TreeEntry[] {
  return entries.map((entry) => ({
    fileId: entry.id,
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

export function useWorkspaceTree(agentId: string, sessionKey?: string | null, projectId?: string | null) {
  const [tree, setTree] = useState<TreeEntry[]>([]);
  const [rootResource, setRootResource] = useState<TreeEntry | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const loadedDirsRef = useRef<Set<string>>(new Set());
  const trimmedAgentId = agentId.trim();
  const trimmedSessionKey = sessionKey?.trim() ?? '';
  /** Project and session scopes must not re-fetch when the selected agent changes. */
  const projectPart = projectId?.trim() ?? '';
  const sessionPart = projectPart ? '' : trimmedSessionKey;
  const agentWhenNoSession = !projectPart && !trimmedSessionKey ? trimmedAgentId : '';

  const editorOpts = useMemo((): WorkspaceEditorRequestOptions | undefined => {
    if (projectPart) return { projectId: projectPart };
    if (sessionPart) return { sessionKey: sessionPart };
    if (agentWhenNoSession) return { agentId: agentWhenNoSession };
    return undefined;
  }, [projectPart, sessionPart, agentWhenNoSession]);

  const loadRoot = useCallback(async () => {
    setLoading(true);
    setError(null);
    loadedDirsRef.current.clear();
    try {
      const [listing, root] = await Promise.all([
        fetchWorkspaceDirectoryListing('', editorOpts),
        fetchWorkspaceRootResource(editorOpts),
      ]);
      setTree(toTreeEntries(listing.entries));
      setRootResource(toTreeEntries([root])[0] ?? null);
      loadedDirsRef.current.add('');
    } catch (err) {
      setRootResource(null);
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [editorOpts]);

  const loadChildren = useCallback(
    async (dirPath: string) => {
      if (loadedDirsRef.current.has(dirPath)) return;
      loadedDirsRef.current.add(dirPath);
      try {
        const entries = await listWorkspaceDir(dirPath, editorOpts);
        const children = toTreeEntries(entries);
        setTree((prev) => mergeChildren(prev, dirPath, children));
      } catch {
        loadedDirsRef.current.delete(dirPath);
      }
    },
    [editorOpts],
  );

  const reset = useCallback(() => {
    setTree([]);
    setRootResource(null);
    setError(null);
    loadedDirsRef.current.clear();
  }, []);

  return { tree, rootResource, loading, error, loadRoot, loadChildren, reset };
}
