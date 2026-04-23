import { fetchJson } from '@/lib/fetch';
import { apiUrl } from '@/lib/url';

export interface AtMentionItem {
  name: string;
  relativePath: string;
  isDirectory: boolean;
}

interface SearchResponse {
  ok: boolean;
  payload: {
    entries: Array<{ name: string; path: string; isDirectory: boolean }>;
  };
}

const EMPTY_QUERY_CACHE_TTL_MS = 30_000;
let emptyQueryCache: { key: string; at: number; items: AtMentionItem[] } | null = null;

function cacheKey(sessionKey: string): string {
  return sessionKey.trim();
}

/** Fuzzy search workspace files (gateway ripgrep `--files` + scoring). */
export async function searchWorkspaceFiles(
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
  const items: AtMentionItem[] = (res.payload.entries ?? []).map((e) => ({
    name: e.name,
    relativePath: e.path,
    isDirectory: e.isDirectory,
  }));

  if (sk && q.length === 0) {
    emptyQueryCache = { key: cacheKey(sk), at: Date.now(), items };
  }

  return items;
}
