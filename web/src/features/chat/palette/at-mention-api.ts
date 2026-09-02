import {
  listWorkspaceDir,
  searchWorkspaceFiles as searchManagedFiles,
  type WorkspaceEntry,
} from '@/features/workspace/workspace-api';

export interface AtMentionFileItem {
  kind: 'file';
  name: string;
  /** Workspace-relative path, or empty for browse-up row. */
  relativePath: string;
  isDirectory: boolean;
  isBrowseUp?: boolean;
  isRecent?: boolean;
}

export interface AtMentionNoteItem {
  kind: 'note';
  name: string;
  description: string;
  noteRef: {
    sourceId: string;
    expectedVersion: string;
  };
}

export type AtMentionItem = AtMentionFileItem | AtMentionNoteItem;

const EMPTY_QUERY_CACHE_TTL_MS = 30_000;
let emptyQueryCache: { key: string; at: number; items: AtMentionFileItem[] } | null = null;

function cacheKey(sessionKey: string): string {
  return sessionKey.trim();
}

function mapFileEntries(entries: Array<{ name: string; path: string; isDirectory: boolean }>): AtMentionFileItem[] {
  return entries.map((e) => ({
    kind: 'file',
    name: e.name,
    relativePath: e.path,
    isDirectory: e.isDirectory,
  }));
}

/** Fuzzy filename / path search over the session workspace. */
export async function searchWorkspaceFiles(
  query: string,
  options: { sessionKey?: string; agentId?: string; limit?: number },
): Promise<AtMentionFileItem[]> {
  const sk = options.sessionKey?.trim();
  const aid = options.agentId?.trim();
  const limit = options.limit ?? 15;
  const q = query.trim();
  if (sk && q.length === 0) {
    const ck = cacheKey(sk);
    const now = Date.now();
    if (emptyQueryCache && emptyQueryCache.key === ck && now - emptyQueryCache.at < EMPTY_QUERY_CACHE_TTL_MS) {
      return emptyQueryCache.items;
    }
  }

  const requestOptions = { sessionKey: sk, agentId: aid };
  const entries = q.length === 0
    ? await listWorkspaceDir('', requestOptions)
    : await searchManagedFiles(q, requestOptions, limit);
  const items = mapFileEntries(entries);

  if (sk && q.length === 0) {
    emptyQueryCache = { key: cacheKey(sk), at: Date.now(), items };
  }

  return items;
}

/** List one directory level (browse mode). */
export async function fetchWorkspaceBrowseEntries(
  dir: string,
  options: { sessionKey?: string; agentId?: string },
): Promise<WorkspaceEntry[]> {
  return listWorkspaceDir(dir, {
    sessionKey: options.sessionKey,
    agentId: options.agentId,
  });
}
