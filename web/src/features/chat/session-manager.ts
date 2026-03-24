import type { Message } from '@/features/chat/messages.types';
import type { SessionInfo } from '@/features/chat/chat.types';
import { sessionWireToUiMessages } from '@/features/chat/agent-messages';
import { apiFetch } from '@/lib/fetch';
import { apiUrl } from '@/lib/url';

/** Web UI chat sessions use segment `webchat` (same as `ui`). */
export function isWebUiSessionKey(key: string): boolean {
  return key.startsWith('gateway:') || key.includes(':gateway:') || key.includes(':webchat:');
}

/** Session list + history via REST; auth from `apiFetch` (gateway token store). */
export class SessionManager {
  async loadSessions(): Promise<SessionInfo[]> {
    const res = await apiFetch(apiUrl('/api/sessions?limit=20'));
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = (await res.json()) as { items?: SessionInfo[] };
    return (data.items || [])
      .filter((s) => isWebUiSessionKey(s.key))
      .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
  }

  async loadSessionAgentConfig(sessionKey: string): Promise<{ thinkingLevel: string; model: string }> {
    const res = await apiFetch(apiUrl(`/api/sessions/${encodeURIComponent(sessionKey)}/agent-config`));
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = (await res.json()) as { payload?: { thinkingLevel?: string; model?: string } };
    const thinkingLevel = data.payload?.thinkingLevel ?? 'medium';
    const model = typeof data.payload?.model === 'string' ? data.payload.model : '';
    return { thinkingLevel, model };
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

  async createSession(): Promise<SessionInfo> {
    const res = await apiFetch(apiUrl('/api/sessions'), {
      method: 'POST',
      body: JSON.stringify({ channel: 'webchat' }),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = (await res.json()) as { session: SessionInfo };
    return data.session;
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
