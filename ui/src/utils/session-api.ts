// Session API - WebSocket client for session management (独立版)

// Types
export interface SessionMetadata {
  key: string;
  name?: string;
  status: 'active' | 'idle' | 'archived' | 'pinned';
  tags: string[];
  createdAt: string;
  updatedAt: string;
  lastAccessedAt: string;
  messageCount: number;
  estimatedTokens: number;
  compactedCount: number;
  sourceChannel: string;
  sourceChatId: string;
}

export interface SessionDetail extends SessionMetadata {
  messages: Array<{
    role: string;
    content: string;
    timestamp?: string;
  }>;
}

export interface SessionListQuery {
  status?: 'active' | 'idle' | 'archived' | 'pinned' | ('active' | 'idle' | 'archived' | 'pinned')[];
  channel?: string;
  tags?: string[];
  search?: string;
  sortBy?: 'updatedAt' | 'createdAt' | 'messageCount' | 'lastAccessedAt';
  sortOrder?: 'asc' | 'desc';
  limit?: number;
  offset?: number;
}

export interface PaginatedResult<T> {
  items: T[];
  total: number;
  limit: number;
  offset: number;
  hasMore: boolean;
}

export interface SessionStats {
  totalSessions: number;
  activeSessions: number;
  archivedSessions: number;
  pinnedSessions: number;
  totalMessages: number;
  totalTokens: number;
  oldestSession?: string;
  newestSession?: string;
  byChannel: Record<string, number>;
}

export type ExportFormat = 'json' | 'markdown';

// Gateway Response/Event types
interface GatewayResponse<T = unknown> {
  type: 'res';
  id: string;
  ok: boolean;
  payload?: T;
  error?: {
    code: string;
    message: string;
  };
}

interface GatewayRequest {
  type: 'req';
  id: string;
  method: string;
  params: Record<string, unknown>;
}

// WebSocket client
export class SessionAPIClient {
  private ws: WebSocket | null = null;
  private url: string;
  private token?: string;
  private pendingRequests = new Map<string, {
    resolve: (value: unknown) => void;
    reject: (reason: Error) => void;
    timeout: ReturnType<typeof setTimeout>;
  }>();
  private connected = false;
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 3;

  constructor(url: string, token?: string) {
    this.url = url;
    this.token = token;
  }

  async connect(): Promise<void> {
    if (this.connected || this.ws?.readyState === WebSocket.CONNECTING) {
      return;
    }

    return new Promise((resolve, reject) => {
      try {
        const url = new URL(this.url);
        if (this.token) {
          url.searchParams.set('token', this.token);
        }

        this.ws = new WebSocket(url.toString());

        const timeout = setTimeout(() => {
          reject(new Error('Connection timeout'));
        }, 10000);

        this.ws.onopen = () => {
          clearTimeout(timeout);
          this.connected = true;
          this.reconnectAttempts = 0;
          resolve();
        };

        this.ws.onclose = () => {
          this.connected = false;
          this._handleReconnect();
        };

        this.ws.onerror = (err) => {
          clearTimeout(timeout);
          reject(new Error('WebSocket error'));
        };

        this.ws.onmessage = (e) => {
          try {
            const frame = JSON.parse(e.data) as GatewayResponse;
            if (frame.type === 'res') {
              const pending = this.pendingRequests.get(frame.id);
              if (pending) {
                clearTimeout(pending.timeout);
                this.pendingRequests.delete(frame.id);
                if (frame.ok) {
                  pending.resolve(frame.payload);
                } else {
                  pending.reject(new Error(frame.error?.message || 'Request failed'));
                }
              }
            }
          } catch {
            // Ignore invalid frames
          }
        };
      } catch (err) {
        reject(err);
      }
    });
  }

  disconnect(): void {
    this.ws?.close();
    this.connected = false;
  }

  private _handleReconnect(): void {
    if (this.reconnectAttempts < this.maxReconnectAttempts) {
      this.reconnectAttempts++;
      setTimeout(() => this.connect().catch(() => {}), 1000 * this.reconnectAttempts);
    }
  }

  async request<T>(method: string, params: Record<string, unknown> = {}): Promise<T> {
    if (!this.connected) {
      await this.connect();
    }

    return new Promise((resolve, reject) => {
      const id = crypto.randomUUID();
      const request: GatewayRequest = { type: 'req', id, method, params };

      const timeout = setTimeout(() => {
        this.pendingRequests.delete(id);
        reject(new Error('Request timeout'));
      }, 30000);

      this.pendingRequests.set(id, { resolve: resolve as (value: unknown) => void, reject, timeout });
      this.ws?.send(JSON.stringify(request));
    });
  }

  // ========== Session API Methods ==========

  async listSessions(query?: SessionListQuery): Promise<PaginatedResult<SessionMetadata>> {
    return this.request('session.list', { query });
  }

  async getSession(key: string): Promise<SessionDetail> {
    const result = await this.request<{ session: SessionDetail }>('session.get', { key });
    return result.session;
  }

  async searchSessions(query: string): Promise<SessionMetadata[]> {
    const result = await this.request<{ sessions: SessionMetadata[] }>('session.search', { query });
    return result.sessions;
  }

  async renameSession(key: string, name: string): Promise<void> {
    await this.request('session.rename', { key, name });
  }

  async tagSession(key: string, tags: string[]): Promise<void> {
    await this.request('session.tag', { key, tags });
  }

  async untagSession(key: string, tags: string[]): Promise<void> {
    await this.request('session.untag', { key, tags });
  }

  async archiveSession(key: string): Promise<void> {
    await this.request('session.archive', { key });
  }

  async unarchiveSession(key: string): Promise<void> {
    await this.request('session.unarchive', { key });
  }

  async pinSession(key: string): Promise<void> {
    await this.request('session.pin', { key });
  }

  async unpinSession(key: string): Promise<void> {
    await this.request('session.unpin', { key });
  }

  async deleteSession(key: string): Promise<void> {
    await this.request('session.delete', { key });
  }

  async deleteSessions(keys: string[]): Promise<{ success: string[]; failed: string[] }> {
    return this.request('session.deleteMany', { keys });
  }

  async exportSession(key: string, format: ExportFormat): Promise<string> {
    const result = await this.request<{ content: string }>('session.export', { key, format });
    return result.content;
  }

  async getStats(): Promise<SessionStats> {
    return this.request('session.stats', {});
  }

  async searchInSession(key: string, keyword: string): Promise<Array<{ role: string; content: string }>> {
    const result = await this.request<{ messages: Array<{ role: string; content: string }> }>('session.searchIn', { key, keyword });
    return result.messages;
  }
}

// Legacy compatibility
export type RequestFn = <T>(method: string, params?: Record<string, unknown>) => Promise<T>;

export class SessionAPI {
  constructor(private requestFn: RequestFn) {}

  async listSessions(query?: SessionListQuery): Promise<PaginatedResult<SessionMetadata>> {
    return this.requestFn('session.list', { query });
  }

  async getSession(key: string): Promise<SessionDetail> {
    const result = await this.requestFn<{ session: SessionDetail }>('session.get', { key });
    return result.session;
  }

  async searchSessions(query: string): Promise<SessionMetadata[]> {
    const result = await this.requestFn<{ sessions: SessionMetadata[] }>('session.search', { query });
    return result.sessions;
  }

  async renameSession(key: string, name: string): Promise<void> {
    await this.requestFn('session.rename', { key, name });
  }

  async tagSession(key: string, tags: string[]): Promise<void> {
    await this.requestFn('session.tag', { key, tags });
  }

  async untagSession(key: string, tags: string[]): Promise<void> {
    await this.requestFn('session.untag', { key, tags });
  }

  async archiveSession(key: string): Promise<void> {
    await this.requestFn('session.archive', { key });
  }

  async unarchiveSession(key: string): Promise<void> {
    await this.requestFn('session.unarchive', { key });
  }

  async pinSession(key: string): Promise<void> {
    await this.requestFn('session.pin', { key });
  }

  async unpinSession(key: string): Promise<void> {
    await this.requestFn('session.unpin', { key });
  }

  async deleteSession(key: string): Promise<void> {
    await this.requestFn('session.delete', { key });
  }

  async deleteSessions(keys: string[]): Promise<{ success: string[]; failed: string[] }> {
    return this.requestFn('session.deleteMany', { keys });
  }

  async exportSession(key: string, format: ExportFormat): Promise<string> {
    const result = await this.requestFn<{ content: string }>('session.export', { key, format });
    return result.content;
  }

  async getStats(): Promise<SessionStats> {
    return this.requestFn('session.stats', {});
  }

  async searchInSession(key: string, keyword: string): Promise<Array<{ role: string; content: string }>> {
    const result = await this.requestFn<{ messages: Array<{ role: string; content: string }> }>('session.searchIn', { key, keyword });
    return result.messages;
  }
}

export function createSessionAPI(requestFn: RequestFn): SessionAPI {
  return new SessionAPI(requestFn);
}

export { SessionAPIClient as default };
