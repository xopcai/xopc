/**
 * Log Exporters
 * 
 * Support for external log aggregation platforms:
 * - Loki (Grafana)
 * - ELK Stack (Elasticsearch)
 * - Datadog
 * - Custom HTTP endpoints
 */

import type { LogEntry, LogLevel } from '../logger.types.js';

// ============================================
// Types
// ============================================

export interface LogExporter {
  name: string;
  enabled: boolean;
  export(entry: LogEntry): Promise<void>;
  flush(): Promise<void>;
}

export interface LokiConfig {
  type: 'loki';
  url: string;
  labels?: Record<string, string>;
  batchSize?: number;
  batchTimeoutMs?: number;
}

export interface ElkConfig {
  type: 'elk';
  url: string;
  index?: string;
  apiKey?: string;
  batchSize?: number;
}

export interface DatadogConfig {
  type: 'datadog';
  apiKey: string;
  site?: string; // datadoghq.com or datadoghq.eu
  service?: string;
  batchSize?: number;
}

export interface WebhookConfig {
  type: 'webhook';
  url: string;
  headers?: Record<string, string>;
  filter?: LogLevel[];
}

export type ExporterConfig = LokiConfig | ElkConfig | DatadogConfig | WebhookConfig;

// ============================================
// Loki Exporter
// ============================================

class LokiExporter implements LogExporter {
  name = 'loki';
  enabled = true;
  private url: string;
  private labels: Record<string, string>;
  private batch: LogEntry[] = [];
  private batchSize: number;
  private batchTimeoutMs: number;
  private flushTimer: NodeJS.Timeout | null = null;

  constructor(cfg: LokiConfig) {
    this.url = cfg.url;
    this.labels = cfg.labels || { service: 'xopcbot' };
    this.batchSize = cfg.batchSize || 100;
    this.batchTimeoutMs = cfg.batchTimeoutMs || 5000;
  }

  async export(entry: LogEntry): Promise<void> {
    this.batch.push(entry);
    
    if (this.batch.length >= this.batchSize) {
      await this.flush();
    } else if (!this.flushTimer) {
      this.flushTimer = setTimeout(() => this.flush(), this.batchTimeoutMs);
    }
  }

  async flush(): Promise<void> {
    if (this.batch.length === 0) return;
    
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }

    const streams = this.batch.map(entry => ({
      stream: {
        ...this.labels,
        level: entry.level,
      },
      values: [
        [String(new Date(entry.timestamp).getTime() * 1000000), JSON.stringify(entry)],
      ],
    }));

    const payload = { streams };
    const batchToSend = this.batch;
    this.batch = [];

    try {
      const response = await fetch(`${this.url}/loki/api/v1/push`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        console.error(`[LokiExporter] Failed to send logs: ${response.status}`);
        // Re-queue failed logs (optional)
        this.batch.unshift(...batchToSend);
      }
    } catch (err) {
      console.error(`[LokiExporter] Error sending logs: ${err}`);
    }
  }
}

// ============================================
// ELK Exporter
// ============================================

class ElkExporter implements LogExporter {
  name = 'elk';
  enabled = true;
  private url: string;
  private index: string;
  private apiKey?: string;
  private batch: LogEntry[] = [];
  private batchSize: number;

  constructor(cfg: ElkConfig) {
    this.url = cfg.url;
    this.index = cfg.index || 'xopcbot-logs';
    this.apiKey = cfg.apiKey;
    this.batchSize = cfg.batchSize || 100;
  }

  async export(entry: LogEntry): Promise<void> {
    this.batch.push(entry);
    if (this.batch.length >= this.batchSize) {
      await this.flush();
    }
  }

  async flush(): Promise<void> {
    if (this.batch.length === 0) return;

    const bulkBody = this.batch.flatMap(entry => [
      JSON.stringify({ index: { _index: this.index } }),
      JSON.stringify(entry),
    ]);

    const batchToSend = this.batch;
    this.batch = [];

    try {
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
      };
      if (this.apiKey) {
        headers['Authorization'] = `ApiKey ${this.apiKey}`;
      }

      const response = await fetch(`${this.url}/_bulk`, {
        method: 'POST',
        headers,
        body: bulkBody.join('\n') + '\n',
      });

      if (!response.ok) {
        console.error(`[ElkExporter] Failed to send logs: ${response.status}`);
        this.batch.unshift(...batchToSend);
      }
    } catch (err) {
      console.error(`[ElkExporter] Error sending logs: ${err}`);
    }
  }
}

// ============================================
// Datadog Exporter
// ============================================

class DatadogExporter implements LogExporter {
  name = 'datadog';
  enabled = true;
  private apiKey: string;
  private site: string;
  private service: string;
  private batch: LogEntry[] = [];
  private batchSize: number;

  constructor(cfg: DatadogConfig) {
    this.apiKey = cfg.apiKey;
    this.site = cfg.site || 'datadoghq.com';
    this.service = cfg.service || 'xopcbot';
    this.batchSize = cfg.batchSize || 100;
  }

  async export(entry: LogEntry): Promise<void> {
    this.batch.push({
      ...entry,
      service: this.service,
    });
    if (this.batch.length >= this.batchSize) {
      await this.flush();
    }
  }

  async flush(): Promise<void> {
    if (this.batch.length === 0) return;

    const batchToSend = this.batch;
    this.batch = [];

    try {
      const response = await fetch(`https://http-intake.logs.${this.site}/v1/input`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'DD-API-KEY': this.apiKey,
        },
        body: JSON.stringify(batchToSend),
      });

      if (!response.ok) {
        console.error(`[DatadogExporter] Failed to send logs: ${response.status}`);
      }
    } catch (err) {
      console.error(`[DatadogExporter] Error sending logs: ${err}`);
    }
  }
}

// ============================================
// Webhook Exporter
// ============================================

class WebhookExporter implements LogExporter {
  name = 'webhook';
  enabled = true;
  private url: string;
  private headers: Record<string, string>;
  private filter?: LogLevel[];

  constructor(cfg: WebhookConfig) {
    this.url = cfg.url;
    this.headers = cfg.headers || { 'Content-Type': 'application/json' };
    this.filter = cfg.filter;
  }

  async export(entry: LogEntry): Promise<void> {
    if (this.filter && !this.filter.includes(entry.level as LogLevel)) {
      return;
    }

    try {
      await fetch(this.url, {
        method: 'POST',
        headers: this.headers,
        body: JSON.stringify(entry),
      });
    } catch (err) {
      console.error(`[WebhookExporter] Error sending log: ${err}`);
    }
  }

  async flush(): Promise<void> {
    // Webhook sends immediately, no batching
  }
}

// ============================================
// Exporter Manager
// ============================================

const exporters: LogExporter[] = [];

export function initializeExporters(configs: ExporterConfig[]): void {
  for (const cfg of configs) {
    switch (cfg.type) {
      case 'loki':
        exporters.push(new LokiExporter(cfg));
        break;
      case 'elk':
        exporters.push(new ElkExporter(cfg));
        break;
      case 'datadog':
        exporters.push(new DatadogExporter(cfg));
        break;
      case 'webhook':
        exporters.push(new WebhookExporter(cfg));
        break;
    }
  }
}

export async function exportLog(entry: LogEntry): Promise<void> {
  for (const exporter of exporters) {
    if (exporter.enabled) {
      try {
        await exporter.export(entry);
      } catch (err) {
        console.error(`[Exporter:${exporter.name}] Failed to export:`, err);
      }
    }
  }
}

export async function flushExporters(): Promise<void> {
  await Promise.all(exporters.map(e => e.flush()));
}

export function getExporters(): LogExporter[] {
  return [...exporters];
}
