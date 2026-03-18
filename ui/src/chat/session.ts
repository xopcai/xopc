import type { Message, GatewayClientConfig, SessionInfo } from './types.js';
import { apiUrl, authHeaders } from './helpers.js';

export class SessionManager {
  constructor(private _config: GatewayClientConfig) {}

  async loadSessions(): Promise<SessionInfo[]> {
    const res = await fetch(apiUrl('/api/sessions?limit=20'), {
      headers: authHeaders(this._config.token),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    return (data.items || [])
      .filter((s: SessionInfo) => s.key.includes(':gateway:'))
      .sort((a: SessionInfo, b: SessionInfo) =>
        new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
      );
  }

  async loadSession(sessionKey: string, offset = 0): Promise<{ messages: Message[]; hasMore: boolean }> {
    const res = await fetch(
      apiUrl(`/api/sessions/${encodeURIComponent(sessionKey)}?offset=${offset}&limit=50`),
      { headers: authHeaders(this._config.token) },
    );
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${res.status}`);
    const data = await res.json();
    const raw = data.session?.messages || [];
    const messages: Message[] = raw
      .filter((m: any) => m.role === 'user' || m.role === 'assistant')
      .map((m: any) => ({
        role: m.role,
        content: typeof m.content === 'string' ? [{ type: 'text', text: m.content }] : (m.content || []),
        attachments: m.attachments,
        timestamp: m.timestamp ? new Date(m.timestamp).getTime() : Date.now(),
      }));
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
