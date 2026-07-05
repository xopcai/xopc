import type { Message } from '@/features/chat/messages/messages.types';
import type { SessionInfo } from '@/features/chat/chat.types';
import { sessionWireToUiMessages } from '@/features/chat/messages/agent-messages';
import { fetchSessionActiveRun } from '@/features/chat/session/resolve-resume-run-id';
import { listSessions } from '@/features/sessions/session-api';
import { apiFetch } from '@/lib/fetch';
import { apiFetchWithStartupRetry } from '@/lib/gateway-startup-retry';
import { apiUrl } from '@/lib/url';
import { upsertWebchatEmptyShellCache } from '@/features/chat/session/webchat-empty-shell-cache';

/** `GET /api/sessions?channel=…` filters on {@link SessionMetadata.sourceChannel}. */
export const WEB_UI_SESSION_SOURCE_CHANNELS = 'webchat';

type SessionAgentConfig = {
  thinkingLevel: string;
  model: string;
  reasoningLevel: string;
  effectiveWorkspacePath: string;
  workingDirectoryLocked: boolean;
};

const _agentConfigInflight = new Map<string, Promise<SessionAgentConfig>>();

type SessionLoadResult = {
  messages: Message[];
  hasMore: boolean;
  name?: string;
  nextBeforeCursor?: string;
};

const _sessionLoadInflight = new Map<string, Promise<SessionLoadResult>>();
const INITIAL_HISTORY_PAGE_LIMIT = 50;
const INITIAL_HISTORY_MAX_RAW_ROWS = 500;

export type SessionTimelineItem = {
  id: string;
  kind: 'turn' | 'tool' | 'file' | 'command' | 'context' | 'branch' | 'compaction';
  role?: 'user' | 'assistant' | 'system';
  title: string;
  preview?: string;
  timestamp?: number;
  depth: number;
  turn: number;
  displayIndex?: number;
  rowNumber?: number;
  status?: 'running' | 'done' | 'error';
  meta?: { toolName?: string; files?: string[] };
};

const _timelineInflight = new Map<string, Promise<SessionTimelineItem[]>>();

export function parseWebchatSessionKeyForCreate(
  sessionKey: string,
): { agentId: string; channel: string; chatId: string } | null {
  const parts = sessionKey.trim().split(':');
  if (parts.length < 6) return null;
  const [scope, agentId, channel, accountId, peerKind, ...peerParts] = parts;
  const chatId = peerParts.join(':').trim();
  if (scope !== 'agent') return null;
  if (!agentId?.trim()) return null;
  if (channel !== 'webchat') return null;
  if (accountId !== 'default' || peerKind !== 'direct') return null;
  if (!chatId) return null;
  return { agentId: agentId.trim().toLowerCase(), channel, chatId };
}

async function readErrorMessage(res: Response): Promise<string> {
  const body = (await res.json().catch(() => ({}))) as {
    error?: string | { message?: string };
  };
  return typeof body.error === 'string' ? body.error : body.error?.message ?? `HTTP ${res.status}`;
}

/** Session list + history via REST; auth from `apiFetch` (gateway token store). */
export class SessionManager {
  /**
   * All web-console sessions (webchat + legacy gateway source), paginated on the server by
   * `channel` so we are not limited to the first N rows of the global mixed-channel list.
   */
  async loadSessions(): Promise<SessionInfo[]> {
    const pageSize = 100;
    const out: SessionInfo[] = [];
    let offset = 0;
    for (let page = 0; page < 100; page++) {
      const data = await listSessions({
        channel: WEB_UI_SESSION_SOURCE_CHANNELS,
        limit: pageSize,
        offset,
      });
      for (const s of data.items) {
        out.push({
          key: s.key,
          sessionId: s.sessionId,
          name: s.name,
          updatedAt: s.updatedAt,
          messageCount: s.messageCount,
          sourceChannel: s.sourceChannel,
          sourceChatId: s.sourceChatId,
          routing: s.routing,
        });
      }
      if (!data.hasMore) break;
      offset += pageSize;
    }
    const sorted = out.sort(
      (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
    );
    upsertWebchatEmptyShellCache(sorted);
    return sorted;
  }

  async loadSessionAgentConfig(sessionKey: string): Promise<SessionAgentConfig> {
    const existing = _agentConfigInflight.get(sessionKey);
    if (existing) return existing;

    const pending = (async () => {
      const res = await apiFetch(
        apiUrl(`/api/sessions/${encodeURIComponent(sessionKey)}/agent-config`),
      );
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as {
        payload?: {
          thinkingLevel?: string;
          model?: string;
          reasoningLevel?: string;
          effectiveWorkspacePath?: string;
          workingDirectoryLocked?: boolean;
        };
      };
      const thinkingLevel = data.payload?.thinkingLevel ?? 'medium';
      const model = typeof data.payload?.model === 'string' ? data.payload.model : '';
      const reasoningLevel = data.payload?.reasoningLevel ?? 'stream';
      const effectiveWorkspacePath =
        typeof data.payload?.effectiveWorkspacePath === 'string'
          ? data.payload.effectiveWorkspacePath
          : '';
      const workingDirectoryLocked = Boolean(data.payload?.workingDirectoryLocked);
      return {
        thinkingLevel,
        model,
        reasoningLevel,
        effectiveWorkspacePath,
        workingDirectoryLocked,
      };
    })().finally(() => {
      _agentConfigInflight.delete(sessionKey);
    });

    _agentConfigInflight.set(sessionKey, pending);
    return pending;
  }

  async patchSessionAgentConfig(
    sessionKey: string,
    patch: { thinkingLevel?: string; model?: string | null; reasoningLevel?: string; workingDirectory?: string },
  ): Promise<void> {
    const res = await apiFetch(apiUrl(`/api/sessions/${encodeURIComponent(sessionKey)}/agent-config`), {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
    });
    if (!res.ok) {
      const j = (await res.json().catch(() => ({}))) as { error?: string };
      throw new Error(j.error ?? `HTTP ${res.status}`);
    }
  }

  /** Gateway read-only active webchat run (`GET /api/sessions/:key/run`). */
  fetchSessionActiveRun(sessionKey: string) {
    return fetchSessionActiveRun(sessionKey);
  }

  async loadSession(sessionKey: string, offset = 0, beforeCursor?: string | null): Promise<SessionLoadResult> {
    const dedupeKey = `${sessionKey}\0${offset}\0${beforeCursor ?? ''}`;
    const existing = _sessionLoadInflight.get(dedupeKey);
    if (existing) return existing;

    const pending = (async () => {
      const loadPage = async (pageOffset: number, pageBeforeCursor?: string | null) => {
        const params = new URLSearchParams({ limit: String(INITIAL_HISTORY_PAGE_LIMIT) });
        if (pageBeforeCursor) {
          params.set('before', pageBeforeCursor);
        } else {
          params.set('offset', String(pageOffset));
        }
        const res = await apiFetchWithStartupRetry(
          apiUrl(`/api/sessions/${encodeURIComponent(sessionKey)}/history?${params.toString()}`),
        );
        if (!res.ok) throw new Error(`HTTP ${res.status}: ${res.statusText}`);
        return (await res.json()) as {
          session?: { messages?: unknown[]; name?: string };
          pagination?: { hasMore?: boolean; nextBeforeCursor?: string };
        };
      };

      let data = await loadPage(offset, beforeCursor);
      let raw = data.session?.messages || [];
      let messages = sessionWireToUiMessages(raw);
      let hasMore = data.pagination?.hasMore ?? raw.length >= INITIAL_HISTORY_PAGE_LIMIT;
      let nextBeforeCursor = data.pagination?.nextBeforeCursor;
      const loadedName =
        typeof data.session?.name === 'string' && data.session.name.trim()
          ? data.session.name.trim()
          : undefined;
      // The history endpoint pages raw transcript rows, while the UI merges many assistant/tool
      // rows into one visible turn. A long tool-heavy tail can make the first page start with an
      // orphan assistant bubble. For the initial tail load, pull older raw pages until the visible
      // slice starts at a user row or history is exhausted.
      while (
        offset === 0 &&
        !beforeCursor &&
        hasMore &&
        nextBeforeCursor &&
        raw.length < INITIAL_HISTORY_MAX_RAW_ROWS &&
        messages[0]?.role === 'assistant'
      ) {
        data = await loadPage(0, nextBeforeCursor);
        const olderRaw = data.session?.messages || [];
        if (olderRaw.length === 0) break;
        raw = [...olderRaw, ...raw];
        messages = sessionWireToUiMessages(raw);
        hasMore = data.pagination?.hasMore ?? olderRaw.length >= INITIAL_HISTORY_PAGE_LIMIT;
        nextBeforeCursor = data.pagination?.nextBeforeCursor;
      }

      return {
        messages,
        hasMore,
        name: loadedName,
        nextBeforeCursor,
      };
    })().finally(() => {
      _sessionLoadInflight.delete(dedupeKey);
    });

    _sessionLoadInflight.set(dedupeKey, pending);
    return pending;
  }

  async loadTimeline(sessionKey: string): Promise<SessionTimelineItem[]> {
    const existing = _timelineInflight.get(sessionKey);
    if (existing) return existing;

    const pending = (async () => {
      const res = await apiFetchWithStartupRetry(
        apiUrl(`/api/sessions/${encodeURIComponent(sessionKey)}/timeline`),
      );
      if (!res.ok) throw new Error(`HTTP ${res.status}: ${res.statusText}`);
      const data = (await res.json()) as {
        items?: SessionTimelineItem[];
      };
      return Array.isArray(data.items) ? data.items : [];
    })().finally(() => {
      _timelineInflight.delete(sessionKey);
    });

    _timelineInflight.set(sessionKey, pending);
    return pending;
  }

  async createSession(options?: { agentId?: string }): Promise<SessionInfo> {
    const body: Record<string, unknown> = { channel: 'webchat' };
    const raw = options?.agentId?.trim();
    if (raw) body.agentId = raw.toLowerCase();
    const res = await apiFetch(apiUrl('/api/sessions'), {
      method: 'POST',
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = (await res.json()) as { session: SessionInfo };
    return data.session;
  }

  async ensureSessionExists(sessionKey: string): Promise<void> {
    const trimmed = sessionKey.trim();
    if (!trimmed) throw new Error('Session key is required');

    const resolved = await apiFetch(apiUrl('/api/sessions/resolve'), {
      method: 'POST',
      body: JSON.stringify({ sessionKey: trimmed }),
    });
    if (resolved.ok) return;
    if (resolved.status !== 404) {
      throw new Error(await readErrorMessage(resolved));
    }

    const parsed = parseWebchatSessionKeyForCreate(trimmed);
    if (!parsed) {
      throw new Error('Session not found');
    }

    const created = await apiFetch(apiUrl('/api/sessions'), {
      method: 'POST',
      body: JSON.stringify({
        channel: parsed.channel,
        agentId: parsed.agentId,
        chat_id: parsed.chatId,
      }),
    });
    if (!created.ok) {
      throw new Error(await readErrorMessage(created));
    }
  }

  /** Lightweight name read after auto-title (matches `ui` SessionManager). */
  async fetchSessionName(sessionKey: string): Promise<string | undefined> {
    const res = await apiFetchWithStartupRetry(
      apiUrl(`/api/sessions/${encodeURIComponent(sessionKey)}?offset=0&limit=1`),
    );
    if (!res.ok) return undefined;
    const data = (await res.json()) as { session?: { name?: string } };
    const n = data.session?.name;
    return typeof n === 'string' && n.trim() ? n.trim() : undefined;
  }

  updateUrl(sessionKey: string): void {
    const newHash = `#/chat/${encodeURIComponent(sessionKey)}`;
    if (location.hash !== newHash) {
      const s = window.history.state;
      const next =
        s && typeof s === 'object' && !Array.isArray(s) ? { ...(s as Record<string, unknown>) } : s;
      history.replaceState(next, '', newHash);
    }
  }

  parseSessionFromHash(): string | null {
    const hash = location.hash.slice(1);
    const m = hash.match(/^\/chat\/(.+)$/) || hash.match(/^chat\/(.+)$/);
    const key = m ? decodeURIComponent(m[1]) : null;
    return key && key !== 'new' ? key : null;
  }

  /** Delete one user turn (user + assistant/tool rows) or a raw LLM index range. */
  async deleteMessages(
    sessionKey: string,
    opts: { userRoundIndex: number } | { startIndex: number; count: number },
  ): Promise<void> {
    const res = await apiFetch(apiUrl(`/api/sessions/${encodeURIComponent(sessionKey)}/messages`), {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(opts),
    });
    if (!res.ok) {
      const json = (await res.json().catch(() => ({}))) as { error?: string };
      throw new Error(json.error ?? `HTTP ${res.status}`);
    }
  }
}
