import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { Worker } from 'node:worker_threads';

import { resolveStateDir } from '../config/paths-state.js';
import { redactString } from './sanitize.js';
import { traceStoreWorkerSource } from './storeWorker.js';
import type { TracingConfig } from './config.js';
import type { TraceRecord } from './types.js';

export class LocalTraceStore {
  private worker?: Worker;
  private sequence = 0;
  private requests = new Map<number, { resolve: (value: any) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout>; bytes: number }>();
  private pendingBytes = 0;
  private epoch = 0;
  private epochReady: Promise<unknown>;
  dropped = 0;
  lastError?: string;
  constructor(config: TracingConfig, file = join(resolveStateDir(), 'traces', 'traces.db')) {
    try {
      this.worker = new Worker(traceStoreWorkerSource, { eval: true, execArgv: process.execArgv.filter((arg, index, args) => !arg.startsWith('--input-type') && args[index - 1] !== '--input-type'), workerData: { path: file, config, owner: randomUUID() } });
      this.worker.on('message', ({ id, value, error }) => {
        const request = this.requests.get(id); if (!request) return;
        clearTimeout(request.timer); this.requests.delete(id); this.pendingBytes -= request.bytes;
        if (error) { this.lastError = error; request.reject(new Error(error)); } else { request.resolve(value); }
        if (!this.requests.size) this.worker?.unref();
      });
      this.worker.on('error', error => this.fail(`Trace worker unavailable: ${redactString(error instanceof Error ? error.message : 'Worker startup failed').slice(0, 200)}`));
      this.worker.on('exit', () => { if (this.worker) this.fail('Trace worker stopped'); });
      this.worker.unref();
      this.epochReady = this.request('status').then(s => { this.epoch = s.epoch; }).catch(() => {});
    } catch { this.lastError = 'Trace worker unavailable'; this.epochReady = Promise.resolve(); }
  }
  private fail(message: string) {
    this.lastError = message;
    for (const r of this.requests.values()) { clearTimeout(r.timer); r.reject(new Error(message)); }
    this.requests.clear(); this.pendingBytes = 0; this.worker = undefined;
  }
  async request(op: string, data?: unknown): Promise<any> {
    if (!this.worker) throw new Error(this.lastError ?? 'Trace storage unavailable');
    const bytes = Buffer.byteLength(JSON.stringify(data ?? null));
    if (this.requests.size >= 2000 || this.pendingBytes + bytes > 8 * 1048576) { this.dropped++; throw new Error('Trace queue full'); }
    const id = ++this.sequence;
    this.pendingBytes += bytes;
    this.worker.ref();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.requests.delete(id); this.pendingBytes -= bytes; this.dropped++;
        reject(new Error('Trace storage timeout'));
        // Terminate a blocked worker: timed-out messages must not remain in its queue.
        void this.worker?.terminate();
      }, 5000);
      this.requests.set(id, { resolve, reject, timer, bytes });
      this.worker!.postMessage({ id, op, data });
    });
  }
  async begin(record: TraceRecord): Promise<number> {
    await this.epochReady;
    return this.request('put', { records: [record], epoch: null });
  }
  async write(record: TraceRecord, epoch?: number): Promise<void> {
    await this.epochReady;
    try { await this.request('put', { records: [record], epoch: epoch ?? this.epoch }); this.lastError = undefined; }
    catch (error) { this.dropped++; this.lastError = error instanceof Error ? error.message : 'Trace write failed'; }
  }
  async clear(): Promise<void> { this.epoch = await this.request('clear'); }
  async flush(): Promise<void> { await this.request('status'); }
  async close(): Promise<void> { const worker = this.worker; this.fail('Trace store closed'); await worker?.terminate(); }
}
