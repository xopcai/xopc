// Cron API - HTTP client for cron job management

export interface CronDelivery {
  mode: 'none' | 'announce' | 'direct';
  channel?: string;
  to?: string;
  bestEffort?: boolean;
}

export interface CronPayload {
  kind: 'systemEvent' | 'agentTurn';
  text?: string;
  message?: string;
  model?: string;
  timeoutSeconds?: number;
}

export interface CronJob {
  id: string;
  name?: string;
  schedule: string;
  message: string;
  enabled: boolean;
  timezone?: string;
  maxRetries: number;
  timeout: number;
  next_run?: string;
  created_at: string;
  updated_at: string;
  // New fields
  sessionTarget?: 'main' | 'isolated';
  payload?: CronPayload;
  delivery?: CronDelivery;
  model?: string;
}

export interface AddJobOptions {
  name?: string;
  timezone?: string;
  sessionTarget?: 'main' | 'isolated';
  model?: string;
  delivery?: CronDelivery;
}

export interface ModelInfo {
  id: string;
  name: string;
  provider: string;
}

export interface ConfigInfo {
  model?: string;
}

export interface ChannelStatus {
  name: string;
  enabled: boolean;
  connected: boolean;
}

export interface CronJobExecution {
  id: string;
  jobId: string;
  status: 'running' | 'success' | 'failed' | 'cancelled';
  startedAt: string;
  endedAt?: string;
  duration?: number;
  error?: string;
  output?: string;
  retryCount: number;
}

export interface CronMetrics {
  totalJobs: number;
  runningJobs: number;
  enabledJobs: number;
  failedLastHour: number;
  avgExecutionTime: number;
  nextScheduledJob?: {
    id: string;
    name?: string;
    runAt: Date;
  };
}

export interface CronJobUpdate {
  name?: string;
  schedule?: string;
  message?: string;
  enabled?: boolean;
  timezone?: string;
  maxRetries?: number;
  timeout?: number;
  sessionTarget?: 'main' | 'isolated';
  model?: string;
  delivery?: CronDelivery;
}

export class CronAPIClient {
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

  // ========== Cron API Methods ==========

  async listJobs(): Promise<CronJob[]> {
    const result = await this.request<{ jobs: CronJob[] }>('GET', '/api/cron');
    return result.jobs || [];
  }

  async getJob(id: string): Promise<CronJob | null> {
    try {
      const result = await this.request<{ job: CronJob }>('GET', `/api/cron/${id}`);
      return result.job || null;
    } catch (err) {
      if (err instanceof Error && err.message.includes('404')) {
        return null;
      }
      throw err;
    }
  }

  async addJob(schedule: string, message: string, options?: AddJobOptions): Promise<{ id: string; schedule: string }> {
    return await this.request<{ id: string; schedule: string }>('POST', '/api/cron', {
      schedule,
      message,
      ...options,
    });
  }

  async updateJob(id: string, updates: CronJobUpdate): Promise<boolean> {
    const result = await this.request<{ updated: boolean }>('PATCH', `/api/cron/${id}`, updates);
    return result.updated;
  }

  async removeJob(id: string): Promise<boolean> {
    const result = await this.request<{ removed: boolean }>('DELETE', `/api/cron/${id}`);
    return result.removed;
  }

  async toggleJob(id: string, enabled: boolean): Promise<boolean> {
    const result = await this.request<{ toggled: boolean }>('POST', `/api/cron/${id}/toggle`, { enabled });
    return result.toggled;
  }

  async runJob(id: string): Promise<void> {
    await this.request<{ triggered: boolean }>('POST', `/api/cron/${id}/run`);
  }

  async getHistory(id: string, limit = 10): Promise<CronJobExecution[]> {
    const result = await this.request<{ history: CronJobExecution[] }>('GET', `/api/cron/${id}/history?limit=${limit}`);
    return result.history || [];
  }

  async getMetrics(): Promise<CronMetrics> {
    return await this.request<CronMetrics>('GET', '/api/cron/metrics');
  }

  async getChannels(): Promise<ChannelStatus[]> {
    const result = await this.request<{ ok: boolean; payload: { channels: ChannelStatus[] } }>('GET', '/api/channels/status');
    return result.payload?.channels || [];
  }

  async getModels(): Promise<ModelInfo[]> {
    const result = await this.request<{ ok: boolean; payload: { models: ModelInfo[] } }>('GET', '/api/models');
    return result.payload?.models || [];
  }

  async getConfig(): Promise<ConfigInfo> {
    const result = await this.request<{ config: ConfigInfo }>('GET', '/api/config');
    // Extract model from nested config structure
    const config = result.config || {};
    return {
      model: (config as any).agents?.defaults?.model || '',
    };
  }
}
