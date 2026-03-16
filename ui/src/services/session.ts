// SessionService - Manages session operations
// Extracted from gateway-chat.ts to reduce component complexity

import { getStore } from '../core/store.js';
import { apiUrl, authHeaders } from '../utils/api.js';
import type { Session } from '../core/store.js';

const store = getStore();

export interface SessionListResponse {
  items: Session[];
  total: number;
}

export interface SessionDetailResponse {
  session: {
    key: string;
    name?: string;
    updatedAt: string;
    messages: Array<{
      role: string;
      content: string | Array<{ type: string; text?: string }>;
      attachments?: unknown[];
      timestamp: string;
    }>;
  };
}

export class SessionService {
  private _token?: string;

  constructor(token?: string) {
    this._token = token;
  }

  setToken(token: string): void {
    this._token = token;
  }

  async loadSessions(limit: number = 20): Promise<Session[]> {
    store.getState().setSessionLoading(true);
    store.getState().setSessionError(null);

    try {
      const url = apiUrl('/api/sessions?limit=' + limit);
      const headers = authHeaders(this._token);
      const res = await fetch(url, { headers });

      if (!res.ok) {
        throw new Error(`HTTP ${res.status}: ${res.statusText}`);
      }

      const data: SessionListResponse = await res.json();
      
      const gatewaySessions = data.items
        .filter((s) => s.key.startsWith('gateway:'))
        .sort((a, b) => 
          new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
        );

      store.getState().setSessionList(gatewaySessions);
      return gatewaySessions;
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to load sessions';
      store.getState().setSessionError(errorMessage);
      console.error('[SessionService] Failed to load sessions:', err);
      throw err;
    } finally {
      store.getState().setSessionLoading(false);
    }
  }

  async loadSession(
    sessionKey: string, 
    offset: number = 0, 
    limit: number = 50
  ): Promise<SessionDetailResponse['session']> {
    store.getState().setSessionLoading(true);
    store.getState().setSessionError(null);

    try {
      const url = apiUrl(
        `/api/sessions/${encodeURIComponent(sessionKey)}?offset=${offset}&limit=${limit}`
      );
      const headers = authHeaders(this._token);
      const res = await fetch(url, { headers });

      if (!res.ok) {
        throw new Error(`HTTP ${res.status}: ${res.statusText}`);
      }

      const data: SessionDetailResponse = await res.json();
      
      const session: Session = {
        key: data.session.key,
        name: data.session.name,
        updatedAt: data.session.updatedAt,
        messageCount: data.session.messages.length,
      };
      store.getState().setCurrentSession(session);

      return data.session;
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to load session';
      store.getState().setSessionError(errorMessage);
      console.error('[SessionService] Failed to load session:', err);
      throw err;
    } finally {
      store.getState().setSessionLoading(false);
    }
  }

  async createSession(channel: string = 'gateway'): Promise<Session> {
    store.getState().setSessionLoading(true);
    store.getState().setSessionError(null);

    try {
      // Refresh sessions list first to check for existing empty sessions
      await this.loadSessions();
      
      // Check if there's already an empty session we can reuse
      const emptySession = this.findEmptySession();
      if (emptySession) {
        store.getState().setCurrentSession(emptySession);
        return emptySession;
      }

      const url = apiUrl('/api/sessions');
      const headers = {
        ...authHeaders(this._token),
        'Content-Type': 'application/json',
      };

      const res = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify({ channel }),
      });

      if (!res.ok) {
        throw new Error(`HTTP ${res.status}: ${res.statusText}`);
      }

      const data = await res.json();
      const session: Session = {
        key: data.session.key,
        name: data.session.name,
        updatedAt: data.session.updatedAt,
        messageCount: 0,
      };

      store.getState().addSession(session);
      store.getState().setCurrentSession(session);
      return session;
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to create session';
      store.getState().setSessionError(errorMessage);
      console.error('[SessionService] Failed to create session:', err);
      throw err;
    } finally {
      store.getState().setSessionLoading(false);
    }
  }

  async archiveSession(sessionKey: string): Promise<void> {
    try {
      const url = apiUrl(`/api/sessions/${encodeURIComponent(sessionKey)}/archive`);
      const headers = authHeaders(this._token);
      
      const res = await fetch(url, { method: 'POST', headers });
      
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}: ${res.statusText}`);
      }

      store.getState().updateSession(sessionKey, { archived: true });
    } catch (err) {
      console.error('[SessionService] Failed to archive session:', err);
      throw err;
    }
  }

  async deleteSession(sessionKey: string): Promise<void> {
    try {
      const url = apiUrl(`/api/sessions/${encodeURIComponent(sessionKey)}`);
      const headers = authHeaders(this._token);
      
      const res = await fetch(url, { method: 'DELETE', headers });
      
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}: ${res.statusText}`);
      }

      store.getState().removeSession(sessionKey);
      
      const current = store.getState().session.current;
      if (current?.key === sessionKey) {
        store.getState().setCurrentSession(null);
      }
    } catch (err) {
      console.error('[SessionService] Failed to delete session:', err);
      throw err;
    }
  }

  getRecentSessionsWithMessages(): Session[] {
    return store.getState().session.list.filter((s) => s.messageCount > 0);
  }

  findEmptySession(): Session | undefined {
    return store.getState().session.list.find((s) => s.messageCount === 0);
  }
}

let sessionServiceInstance: SessionService | null = null;

export function getSessionService(token?: string): SessionService {
  if (!sessionServiceInstance) {
    sessionServiceInstance = new SessionService(token);
  } else if (token) {
    sessionServiceInstance.setToken(token);
  }
  return sessionServiceInstance;
}

export function resetSessionService(): void {
  sessionServiceInstance = null;
}
