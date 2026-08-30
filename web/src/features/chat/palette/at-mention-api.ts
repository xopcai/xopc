import { listWorkspaceDir, type WorkspaceEntry } from '@/features/workspace/workspace-api';
import { fetchJson } from '@/lib/fetch';
import { apiUrl } from '@/lib/url';

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

interface SearchResponse {
  ok: boolean;
  payload: {
    entries: Array<{ name: string; path: string; isDirectory: boolean }>;
  };
}

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
  const params = new URLSearchParams();
  params.set('q', q);
  params.set('limit', String(limit));
  if (sk) params.set('sessionKey', sk);
  else if (aid) params.set('agentId', aid);

  if (sk && q.length === 0) {
    const ck = cacheKey(sk);
    const now = Date.now();
    if (emptyQueryCache && emptyQueryCache.key === ck && now - emptyQueryCache.at < EMPTY_QUERY_CACHE_TTL_MS) {
      return emptyQueryCache.items;
    }
  }

  const res = await fetchJson<SearchResponse>(
    apiUrl(`/api/workspace/editor/files/search?${params.toString()}`),
  );
  const items = mapFileEntries(res.payload.entries ?? []);

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
