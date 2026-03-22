import type { Message, GatewayClientConfig, SessionInfo } from './types.js';
import { sessionWireToUiMessages } from '../messages/agent-messages.js';
import { apiUrl, authHeaders } from './helpers.js';

/** Web UI chat sessions use source segment `webchat` (API) or legacy `gateway`. */
export function isWebUiSessionKey(key: string): boolean {
  return key.startsWith('gateway:') || key.includes(':gateway:') || key.includes(':webchat:');
}

export class SessionManager {
  constructor(private _config: GatewayClientConfig) {}

  async loadSessions(): Promise<SessionInfo[]> {
    const res = await fetch(apiUrl('/api/sessions?limit=20'), {
      headers: authHeaders(this._config.token),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    return (data.items || [])
      .filter((s: SessionInfo) => isWebUiSessionKey(s.key))
      .sort(
        (a: SessionInfo, b: SessionInfo) =>
          new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
      );
  }

  async loadSessionAgentConfig(sessionKey: string): Promise<{ thinkingLevel: string }> {
    const res = await fetch(
      apiUrl(`/api/sessions/${encodeURIComponent(sessionKey)}/agent-config`),
      { headers: authHeaders(this._config.token) },
    );
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    const thinkingLevel = data.payload?.thinkingLevel ?? 'medium';
    return { thinkingLevel };
  }

  async loadSession(sessionKey: string, offset = 0): Promise<{ messages: Message[]; hasMore: boolean }> {
    const res = await fetch(
      apiUrl(`/api/sessions/${encodeURIComponent(sessionKey)}?offset=${offset}&limit=50`),
      { headers: authHeaders(this._config.token) },
    );
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${res.status}`);
    const data = await res.json();
    const raw = data.session?.messages || [];
    const messages = sessionWireToUiMessages(raw);
    return { messages, hasMore: raw.length >= 50 };
  }

  async createSession(): Promise<SessionInfo> {
    const res = await fetch(apiUrl('/api/sessions'), {
      method: 'POST',
      headers: authHeaders(this._config.token),
      body: JSON.stringify({ channel: 'webchat' }),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    return data.session as SessionInfo;
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
