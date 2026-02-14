// Session API - HTTP client for session management

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

export class SessionAPIClient {
  private baseUrl: string;
  private token?: string;

  constructor(baseUrl: string, token?: string) {
    // Normalize URL - remove trailing slash
    this.baseUrl = baseUrl.replace(/\/$/, '');
    this.token = token;
  }

  private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    
    if (this.token) {
      headers['Authorization'] = `Bearer ${this.token}`;
    }

    const response = await fetch(`${this.baseUrl}${path}`, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: 'Request failed' }));
      throw new Error(error.error || `HTTP ${response.status}`);
    }

    return response.json();
  }

  // ========== Session API Methods ==========

  async listSessions(query?: SessionListQuery): Promise<PaginatedResult<SessionMetadata>> {
    const params = new URLSearchParams();
    if (query?.status) params.set('status', query.status as string);
    if (query?.search) params.set('search', query.search);
    if (query?.limit) params.set('limit', String(query.limit));
    if (query?.offset) params.set('offset', String(query.offset));
    
    const queryString = params.toString();
    const path = `/api/sessions${queryString ? `?${queryString}` : ''}`;
    return await this.request<PaginatedResult<SessionMetadata>>('GET', path);
  }

  async getSession(key: string): Promise<SessionDetail | null> {
    try {
      const result = await this.request<{ session: SessionDetail }>('GET', `/api/sessions/${key}`);
      return result.session || null;
    } catch (err) {
      if (err instanceof Error && err.message.includes('404')) {
        return null;
      }
      throw err;
    }
  }

  async deleteSession(key: string): Promise<{ deleted: boolean }> {
    return await this.request<{ deleted: boolean }>('DELETE', `/api/sessions/${key}`);
  }

  async archiveSession(key: string): Promise<{ archived: boolean }> {
    return await this.request<{ archived: boolean }>('POST', `/api/sessions/${key}/archive`);
  }

  async unarchiveSession(key: string): Promise<{ unarchived: boolean }> {
    return await this.request<{ unarchived: boolean }>('POST', `/api/sessions/${key}/unarchive`);
  }

  async pinSession(key: string): Promise<{ pinned: boolean }> {
    return await this.request<{ pinned: boolean }>('POST', `/api/sessions/${key}/pin`);
  }

  async unpinSession(key: string): Promise<{ unpinned: boolean }> {
    return await this.request<{ unpinned: boolean }>('POST', `/api/sessions/${key}/unpin`);
  }

  async renameSession(key: string, name: string): Promise<{ renamed: boolean }> {
    return await this.request<{ renamed: boolean }>('POST', `/api/sessions/${key}/rename`, { name });
  }

  async exportSession(key: string, format: ExportFormat = 'json'): Promise<string> {
    const result = await this.request<{ content: string }>('GET', `/api/sessions/${key}/export?format=${format}`);
    return result.content;
  }

  async getStats(): Promise<SessionStats> {
    return await this.request<SessionStats>('GET', '/api/sessions/stats');
  }
}
