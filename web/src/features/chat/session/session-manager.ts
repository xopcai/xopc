import type { Message } from '@/features/chat/messages/messages.types';
import type { SessionInfo } from '@/features/chat/chat.types';
import { sessionWireToUiMessages } from '@/features/chat/messages/agent-messages';
import { fetchSessionActiveRun } from '@/features/chat/session/resolve-resume-run-id';
import { listSessions } from '@/features/sessions/session-api';
import { apiFetch } from '@/lib/fetch';
import { apiFetchWithStartupRetry } from '@/lib/gateway-startup-retry';
import { apiUrl } from '@/lib/url';
import { buildWebchatSessionKey, generateNewChatId, normalizeAgentId } from '@/lib/webchat-session-key';

/** Web UI chat sessions use segment `webchat` (same as `ui`). */
export function isWebUiSessionKey(key: string): boolean {
  return (
    key.startsWith('gateway:') ||
    key.includes(':gateway:') ||
    key.includes(':webchat:') ||
    key.includes(':ui:')
  );
}

/**
 * `GET /api/sessions?channel=…` filters on {@link SessionMetadata.sourceChannel}. Web console uses
 * `webchat`; older installs may still have `gateway` in the session key.
 */
export const WEB_UI_SESSION_SOURCE_CHANNELS = 'webchat,gateway';

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
        if (!isWebUiSessionKey(s.key)) continue;
        out.push({
          key: s.key,
          name: s.name,
          updatedAt: s.updatedAt,
          messageCount: s.messageCount,
        });
      }
      if (!data.hasMore) break;
      offset += pageSize;
    }
    return out.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
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
      const params = new URLSearchParams({ limit: '50' });
      if (beforeCursor) {
        params.set('before', beforeCursor);
      } else {
        params.set('offset', String(offset));
      }
      const res = await apiFetchWithStartupRetry(
        apiUrl(`/api/sessions/${encodeURIComponent(sessionKey)}/history?${params.toString()}`),
      );
      if (!res.ok) throw new Error(`HTTP ${res.status}: ${res.statusText}`);
      const data = (await res.json()) as {
        session?: { messages?: unknown[]; name?: string };
        pagination?: { hasMore?: boolean; nextBeforeCursor?: string };
      };
      const raw = data.session?.messages || [];
      const messages = sessionWireToUiMessages(raw);
      const name =
        typeof data.session?.name === 'string' && data.session.name.trim()
          ? data.session.name.trim()
          : undefined;
      return {
        messages,
        hasMore: data.pagination?.hasMore ?? raw.length >= 50,
        name,
        nextBeforeCursor: data.pagination?.nextBeforeCursor,
      };
    })().finally(() => {
      _sessionLoadInflight.delete(dedupeKey);
    });

    _sessionLoadInflight.set(dedupeKey, pending);
    return pending;
  }

  async createSession(options?: { agentId?: string; chatId?: string }): Promise<SessionInfo> {
    const body: Record<string, unknown> = { channel: 'webchat' };
    const raw = options?.agentId?.trim();
    if (raw) body.agentId = raw.toLowerCase();
    if (options?.chatId?.trim()) body.chat_id = options.chatId.trim();
    const res = await apiFetch(apiUrl('/api/sessions'), {
      method: 'POST',
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = (await res.json()) as { session: SessionInfo };
    return data.session;
  }

  /** Background registration for client-generated optimistic session keys. */
  registerSessionWithChatId(agentId: string, chatId: string): Promise<SessionInfo> {
    return this.createSession({ agentId, chatId });
  }

  /** Instant new-chat key + async POST — matches mobile optimistic session flow. */
  openOptimisticNewSession(agentId?: string): { sessionKey: string; register: Promise<SessionInfo> } {
    const id = normalizeAgentId(agentId);
    const chatId = generateNewChatId();
    const sessionKey = buildWebchatSessionKey(id, chatId);
    return {
      sessionKey,
      register: this.registerSessionWithChatId(id, chatId),
    };
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
