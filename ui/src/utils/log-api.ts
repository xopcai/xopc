// Log API - HTTP client for log management

export interface LogEntry {
  timestamp: string;
  level: 'trace' | 'debug' | 'info' | 'warn' | 'error' | 'fatal';
  message: string;
  module?: string;
  prefix?: string;
  service?: string;
  plugin?: string;
  requestId?: string;
  sessionId?: string;
  userId?: string;
  meta?: Record<string, unknown>;
  [key: string]: unknown;
}

export interface LogQuery {
  level?: string[];
  from?: string;
  to?: string;
  q?: string;
  module?: string;
  limit?: number;
  offset?: number;
}

export interface LogFile {
  name: string;
  size: number;
  modified: string;
}

export interface LogStats {
  byLevel: Record<string, number>;
}

export type LogLevel = 'trace' | 'debug' | 'info' | 'warn' | 'error' | 'fatal';

export const LOG_LEVELS: LogLevel[] = ['trace', 'debug', 'info', 'warn', 'error', 'fatal'];

export const LOG_LEVEL_COLORS: Record<LogLevel, string> = {
  trace: '#9ca3af',
  debug: '#6b7280',
  info: '#3b82f6',
  warn: '#f59e0b',
  error: '#ef4444',
  fatal: '#dc2626',
};

export class LogAPIClient {
  private baseUrl: string;
  private token?: string;

  constructor(baseUrl: string, token?: string) {
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

  // ========== Log API Methods ==========

  async queryLogs(query?: LogQuery): Promise<{ logs: LogEntry[]; count: number }> {
    const params = new URLSearchParams();
    if (query?.level?.length) params.set('level', query.level.join(','));
    if (query?.from) params.set('from', query.from);
    if (query?.to) params.set('to', query.to);
    if (query?.q) params.set('q', query.q);
    if (query?.module) params.set('module', query.module);
    if (query?.limit) params.set('limit', String(query.limit));
    if (query?.offset) params.set('offset', String(query.offset));

    const queryString = params.toString();
    const path = `/api/logs${queryString ? `?${queryString}` : ''}`;
    return await this.request<{ logs: LogEntry[]; count: number }>('GET', path);
  }

  async getLogFiles(): Promise<LogFile[]> {
    const result = await this.request<{ files: LogFile[] }>('GET', '/api/logs/files');
    return result.files || [];
  }

  async getLogStats(): Promise<LogStats> {
    return await this.request<LogStats>('GET', '/api/logs/stats');
  }

  async getLogLevels(): Promise<LogLevel[]> {
    const result = await this.request<{ levels: LogLevel[] }>('GET', '/api/logs/levels');
    return result.levels || [];
  }

  async getLogModules(): Promise<string[]> {
    const result = await this.request<{ modules: string[] }>('GET', '/api/logs/modules');
    return result.modules || [];
  }

  async getLogDir(): Promise<string> {
    const result = await this.request<{ dir: string }>('GET', '/api/logs/dir');
    return result.dir;
  }
}
