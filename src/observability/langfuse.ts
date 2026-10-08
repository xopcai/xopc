import { createLogger } from '../utils/logger.js';
import type { TraceRecord } from './types.js';

const log = createLogger('Observability:Langfuse');

function otlp(record: TraceRecord) {
  const attributes = Object.entries(record.attributes).map(([key, value]) => ({ key, value: typeof value === 'number' ? { doubleValue: value } : typeof value === 'boolean' ? { boolValue: value } : { stringValue: value } }));
  return {
    traceId: record.traceId, spanId: record.spanId, parentSpanId: record.parentSpanId,
    name: record.name, kind: 1,
    startTimeUnixNano: String(BigInt(Math.floor(record.startedAt * 1000)) * 1000n),
    endTimeUnixNano: String(BigInt(Math.floor((record.endedAt ?? record.startedAt) * 1000)) * 1000n),
    attributes, status: { code: record.status === 'error' ? 2 : 1 },
  };
}

/** Bounded OTLP/HTTP JSON exporter. No hidden SDK queue or durable replay. */
export class LangfuseTarget {
  private queue: { record: TraceRecord; bytes: number }[] = [];
  private bytes = 0;
  private timer?: ReturnType<typeof setTimeout>;
  private sending?: Promise<void>;
  private controller?: AbortController;
  private closed = false;
  private lastWarning = 0;
  dropped = 0;
  lastSuccess?: number;
  lastFailure?: number;
  lastError?: string;
  constructor(private baseUrl: string, private publicKey: string, private secretKey: string) {}
  status() { return { state: this.lastError ? 'degraded' : 'ready', pending: this.queue.length, dropped: this.dropped, lastSuccess: this.lastSuccess, lastFailure: this.lastFailure, lastError: this.lastError }; }
  enqueue(record: TraceRecord): void {
    if (this.closed) return;
    const bytes = Buffer.byteLength(JSON.stringify(record));
    if (this.queue.length >= 2000 || this.bytes + bytes > 8 * 1048576) { this.dropped++; this.lastError = 'Export queue full'; return; }
    this.queue.push({ record, bytes }); this.bytes += bytes;
    if (this.queue.length >= 100) void this.flush();
    else if (!this.timer) { this.timer = setTimeout(() => { this.timer = undefined; void this.flush(); }, 5000); this.timer.unref(); }
  }
  async flush(): Promise<void> {
    if (this.sending) { await this.sending; if (this.queue.length && !this.closed) await this.flush(); return; }
    if (this.timer) { clearTimeout(this.timer); this.timer = undefined; }
    if (this.closed || !this.queue.length) return;
    const batch = this.queue.splice(0, 100);
    this.bytes -= batch.reduce((n, row) => n + row.bytes, 0);
    this.sending = this.send(batch.map(row => row.record)).finally(() => { this.sending = undefined; });
    await this.sending;
    if (this.queue.length && !this.closed && !this.timer) { this.timer = setTimeout(() => { this.timer = undefined; void this.flush(); }, 5000); this.timer.unref(); }
  }
  private async send(records: TraceRecord[]): Promise<void> {
    for (let attempt = 0; attempt < 3 && !this.closed; attempt++) {
      this.controller = new AbortController();
      const timeout = setTimeout(() => this.controller?.abort(), 5000);
      try {
        const response = await fetch(this.baseUrl.replace(/\/$/, '') + '/api/public/otel/v1/traces', {
          method: 'POST', redirect: 'error', signal: this.controller.signal,
          headers: { 'Content-Type': 'application/json', Authorization: `Basic ${Buffer.from(`${this.publicKey}:${this.secretKey}`).toString('base64')}`, 'x-langfuse-ingestion-version': '4' },
          body: JSON.stringify({ resourceSpans: [{ resource: { attributes: [{ key: 'service.name', value: { stringValue: 'xopc' } }] }, scopeSpans: [{ scope: { name: 'xopc.observability' }, spans: records.map(otlp) }] }] }),
        });
        if (!response.ok) { await response.body?.cancel(); throw new Error(`Langfuse returned HTTP ${response.status}`); }
        if (response.body) {
          const reader = response.body.getReader(); const chunks: Uint8Array[] = []; let size = 0;
          try {
            while (true) {
              const chunk = await reader.read(); if (chunk.done) break;
              size += chunk.value.length;
              if (size > 16384) { await reader.cancel(); throw new Error('Oversized ingestion response'); }
              chunks.push(chunk.value);
            }
            const text = Buffer.concat(chunks).toString('utf8');
            if (text && Number(JSON.parse(text).partialSuccess?.rejectedSpans ?? 0) > 0) throw new Error('Ingestion rejected spans');
          } finally { reader.releaseLock(); }
        }
        this.lastSuccess = Date.now(); this.lastError = undefined; return;
      } catch (error) {
        this.lastFailure = Date.now();
        if (Date.now() - this.lastWarning > 60000) { this.lastWarning = Date.now(); log.warn({ phase: 'langfuse_export', attempt: attempt + 1 }, 'Langfuse trace export failed; local recording continues'); }
        this.lastError = error instanceof Error && /^Langfuse returned HTTP \d+$/.test(error.message) ? error.message : 'Langfuse export failed';
      } finally { clearTimeout(timeout); }
      if (attempt < 2 && !this.closed) await new Promise(resolve => { const t = setTimeout(resolve, 250 * 2 ** attempt); t.unref(); });
    }
    this.dropped += records.length;
  }
  close(): void { this.closed = true; this.controller?.abort(); if (this.timer) clearTimeout(this.timer); this.dropped += this.queue.length; this.queue = []; this.bytes = 0; }
}
