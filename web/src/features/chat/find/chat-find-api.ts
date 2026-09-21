import { apiFetch } from '@/lib/fetch';
import { apiUrl } from '@/lib/url';

export type ChatFindMatch = {
  displayIndex: number;
  occurrence: number;
};

export type ChatFindResult = {
  query: string;
  total: number;
  truncated: boolean;
  matches: ChatFindMatch[];
};

export async function findChatMessages(
  conversationId: string,
  query: string,
  options: { taskId?: string | null; signal?: AbortSignal } = {},
): Promise<ChatFindResult> {
  const path = options.taskId
    ? `/api/tasks/${encodeURIComponent(options.taskId)}/conversation/find`
    : `/api/sessions/${encodeURIComponent(conversationId)}/find`;
  const params = new URLSearchParams({ q: query, limit: '1000' });
  const response = await apiFetch(apiUrl(`${path}?${params}`), { signal: options.signal });
  if (!response.ok) throw new Error(`HTTP ${response.status}: ${response.statusText}`);
  const value = await response.json() as Partial<ChatFindResult> & { ok?: unknown };
  if (value.ok !== true || !Array.isArray(value.matches) || typeof value.total !== 'number') {
    throw new Error('Invalid chat find response');
  }
  return {
    query: typeof value.query === 'string' ? value.query : query,
    total: value.total,
    truncated: value.truncated === true,
    matches: value.matches.filter((match): match is ChatFindMatch =>
      Number.isInteger(match?.displayIndex) && match.displayIndex >= 0
      && Number.isInteger(match?.occurrence) && match.occurrence >= 0),
  };
}
