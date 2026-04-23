import { listWorkspaceDir, type WorkspaceEntry } from '@/features/workspace/workspace-api';
import { fetchJson } from '@/lib/fetch';
import { apiUrl } from '@/lib/url';

export type AtCategory = 'files' | 'docs' | 'symbols' | 'urls';

export type AtPickKind = 'file' | 'doc' | 'symbol' | 'url';

export interface AtMentionItem {
  pickKind: AtPickKind;
  name: string;
  /** Workspace-relative path, full URL (`pickKind === 'url'`), or empty for browse-up row. */
  relativePath: string;
  isDirectory: boolean;
  isBrowseUp?: boolean;
  isRecent?: boolean;
  line?: number;
  preview?: string;
}

interface SearchResponse {
  ok: boolean;
  payload: {
    entries: Array<{ name: string; path: string; isDirectory: boolean }>;
  };
}

interface SymbolSearchResponse {
  ok: boolean;
  payload: {
    entries: Array<{ symbol: string; path: string; line: number; preview: string }>;
  };
}

const EMPTY_QUERY_CACHE_TTL_MS = 30_000;
let emptyQueryCache: { key: string; at: number; items: AtMentionItem[] } | null = null;

function cacheKey(sessionKey: string, onlyMarkdown: boolean): string {
  return `${sessionKey.trim()}\0${onlyMarkdown ? 'md' : 'all'}`;
}

function mapFileEntries(
  entries: Array<{ name: string; path: string; isDirectory: boolean }>,
  pickKind: AtPickKind,
): AtMentionItem[] {
  return entries.map((e) => ({
    pickKind,
    name: e.name,
    relativePath: e.path,
    isDirectory: e.isDirectory,
  }));
}

/** Fuzzy filename / path search over the session workspace. */
export async function searchWorkspaceFiles(
  query: string,
  options: { sessionKey?: string; agentId?: string; limit?: number; onlyMarkdown?: boolean },
): Promise<AtMentionItem[]> {
  const sk = options.sessionKey?.trim();
  const aid = options.agentId?.trim();
  const limit = options.limit ?? 15;
  const q = query.trim();
  const onlyMd = options.onlyMarkdown === true;
  const params = new URLSearchParams();
  params.set('q', q);
  params.set('limit', String(limit));
  if (onlyMd) params.set('onlyMarkdown', 'true');
  if (sk) params.set('sessionKey', sk);
  else if (aid) params.set('agentId', aid);

  if (sk && q.length === 0 && !onlyMd) {
    const ck = cacheKey(sk, false);
    const now = Date.now();
    if (emptyQueryCache && emptyQueryCache.key === ck && now - emptyQueryCache.at < EMPTY_QUERY_CACHE_TTL_MS) {
      return emptyQueryCache.items;
    }
  }

  const res = await fetchJson<SearchResponse>(
    apiUrl(`/api/workspace/editor/files/search?${params.toString()}`),
  );
  const items = mapFileEntries(res.payload.entries ?? [], onlyMd ? 'doc' : 'file');

  if (sk && q.length === 0 && !onlyMd) {
    emptyQueryCache = { key: cacheKey(sk, false), at: Date.now(), items };
  }

  return items;
}

export async function searchWorkspaceSymbols(
  query: string,
  options: { sessionKey?: string; agentId?: string; limit?: number },
): Promise<AtMentionItem[]> {
  const sk = options.sessionKey?.trim();
  const aid = options.agentId?.trim();
  const limit = options.limit ?? 15;
  const q = query.trim();
  const params = new URLSearchParams();
  params.set('q', q);
  params.set('limit', String(limit));
  if (sk) params.set('sessionKey', sk);
  else if (aid) params.set('agentId', aid);

  const res = await fetchJson<SymbolSearchResponse>(
    apiUrl(`/api/workspace/editor/symbols/search?${params.toString()}`),
  );
  return (res.payload.entries ?? []).map((e) => ({
    pickKind: 'symbol' as const,
    name: e.symbol,
    relativePath: e.path,
    isDirectory: false,
    line: e.line,
    preview: e.preview,
  }));
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

export function isValidHttpUrl(s: string): boolean {
  const t = s.trim();
  if (!/^https?:\/\//i.test(t)) return false;
  try {
    const u = new URL(t);
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch {
    return false;
  }
}

export function urlMentionItem(href: string): AtMentionItem {
  const u = href.trim();
  let name = u;
  try {
    name = new URL(u).hostname || u;
  } catch {
    /* keep */
  }
  return {
    pickKind: 'url',
    name,
    relativePath: u,
    isDirectory: false,
  };
}
