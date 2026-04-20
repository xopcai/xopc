import type { Message } from '@/features/chat/messages.types';
import type { SessionInfo } from '@/features/chat/chat.types';
import { sessionWireToUiMessages } from '@/features/chat/agent-messages';
import { listSessions } from '@/features/sessions/session-api';
import { apiFetch } from '@/lib/fetch';
import { apiUrl } from '@/lib/url';

/** Web UI chat sessions use segment `webchat` (same as `ui`). */
export function isWebUiSessionKey(key: string): boolean {
  return key.startsWith('gateway:') || key.includes(':gateway:') || key.includes(':webchat:');
}

/** Session list + history via REST; auth from `apiFetch` (gateway token store). */
export class SessionManager {
  /** Same first page as sidebar (`limit=20&offset=0`) so `listSessions` in-flight dedupe applies. */
  async loadSessions(): Promise<SessionInfo[]> {
    const data = await listSessions({ limit: 20, offset: 0 });
    return data.items
      .filter((s) => isWebUiSessionKey(s.key))
      .map((s) => ({
        key: s.key,
        name: s.name,
        updatedAt: s.updatedAt,
        messageCount: s.messageCount,
      }))
      .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
  }

  async loadSessionAgentConfig(sessionKey: string): Promise<{
    thinkingLevel: string;
    model: string;
    reasoningLevel: string;
    effectiveWorkspacePath: string;
    workingDirectoryLocked: boolean;
  }> {
    const res = await apiFetch(apiUrl(`/api/sessions/${encodeURIComponent(sessionKey)}/agent-config`));
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
    const reasoningLevel = data.payload?.reasoningLevel ?? 'off';
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

  async loadSession(
    sessionKey: string,
    offset = 0,
  ): Promise<{ messages: Message[]; hasMore: boolean; name?: string }> {
    const res = await apiFetch(
      apiUrl(`/api/sessions/${encodeURIComponent(sessionKey)}?offset=${offset}&limit=50`),
    );
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${res.statusText}`);
    const data = (await res.json()) as {
      session?: { messages?: unknown[]; name?: string };
    };
    const raw = data.session?.messages || [];
    const messages = sessionWireToUiMessages(raw);
    const name =
      typeof data.session?.name === 'string' && data.session.name.trim()
        ? data.session.name.trim()
        : undefined;
    return { messages, hasMore: raw.length >= 50, name };
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

  /** Lightweight name read after auto-title (matches `ui` SessionManager). */
  async fetchSessionName(sessionKey: string): Promise<string | undefined> {
    const res = await apiFetch(
      apiUrl(`/api/sessions/${encodeURIComponent(sessionKey)}?offset=0&limit=1`),
    );
    if (!res.ok) return undefined;
    const data = (await res.json()) as { session?: { name?: string } };
    const n = data.session?.name;
    return typeof n === 'string' && n.trim() ? n.trim() : undefined;
  }

  updateUrl(sessionKey: string): void {
    const newHash = `#/chat/${encodeURIComponent(sessionKey)}`;
    if (location.hash !== newHash) history.replaceState(null, '', newHash);
  }

  parseSessionFromHash(): string | null {
    const hash = location.hash.slice(1);
    const m = hash.match(/^\/chat\/(.+)$/) || hash.match(/^chat\/(.+)$/);
    const key = m ? decodeURIComponent(m[1]) : null;
    return key && key !== 'new' ? key : null;
  }
}
