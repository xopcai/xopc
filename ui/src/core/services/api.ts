/**
 * API Service - HTTP API calls
 */

import { createLogger } from '../../utils/logger.js';

const log = createLogger('APIService');

export interface ApiConfig {
  baseUrl: string;
  token?: string;
}

export interface SendMessageRequest {
  content: string;
  attachments?: Array<{
    type: string;
    mimeType?: string;
    data?: string;
    name?: string;
    size?: number;
  }>;
  sessionKey?: string;
  model?: string;
}

export interface ApiError {
  code: string;
  message: string;
}

class ApiService {
  private _config: ApiConfig;

  constructor(config: ApiConfig) {
    this._config = config;
  }

  private _headers(): Record<string, string> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    if (this._config.token) {
      headers['Authorization'] = `Bearer ${this._config.token}`;
    }
    return headers;
  }

  async sendMessage(request: SendMessageRequest): Promise<void> {
    const response = await fetch(`${this._config.baseUrl}/api/chat`, {
      method: 'POST',
      headers: this._headers(),
      body: JSON.stringify(request),
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({ message: 'Unknown error' }));
      log.error({ error }, 'Failed to send message');
      throw new Error(error.message || 'Failed to send message');
    }
  }

  async abort(): Promise<void> {
    await fetch(`${this._config.baseUrl}/api/abort`, {
      method: 'POST',
      headers: this._headers(),
    });
  }

  async getSessions(): Promise<Array<{ id: string; name: string; updatedAt: number }>> {
    const response = await fetch(`${this._config.baseUrl}/api/sessions`, {
      headers: this._headers(),
    });

    if (!response.ok) {
      throw new Error('Failed to fetch sessions');
    }

    return response.json();
  }

  async getSessionMessages(sessionId: string): Promise<unknown[]> {
    const response = await fetch(`${this._config.baseUrl}/api/sessions/${sessionId}/messages`, {
      headers: this._headers(),
    });

    if (!response.ok) {
      throw new Error('Failed to fetch session messages');
    }

    return response.json();
  }

  async deleteSession(sessionId: string): Promise<void> {
    const response = await fetch(`${this._config.baseUrl}/api/sessions/${sessionId}`, {
      method: 'DELETE',
      headers: this._headers(),
    });

    if (!response.ok) {
      throw new Error('Failed to delete session');
    }
  }

  async checkHealth(): Promise<{ status: string }> {
    const response = await fetch(`${this._config.baseUrl}/api/health`, {
      headers: this._headers(),
    });

    if (!response.ok) {
      throw new Error('Health check failed');
    }

    return response.json();
  }
}

export function createApiService(config: ApiConfig): ApiService {
  return new ApiService(config);
}

export type { ApiService };
