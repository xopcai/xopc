import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { Worker } from 'node:worker_threads';

import { resolveStateDir } from '../config/paths-state.js';
import { createLogger } from '../utils/logger.js';
import { redactString } from './sanitize.js';
import { traceStoreWorkerSource } from './storeWorker.js';
import type { TracingConfig } from './config.js';
import type { TraceRecord } from './types.js';

const log = createLogger('Observability:Store');

export class LocalTraceStore {
  private worker?: Worker;
  private sequence = 0;
  private requests = new Map<number, { resolve: (value: any) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout>; bytes: number }>();
  private pendingBytes = 0;
  private epoch = 0;
  private epochReady: Promise<unknown> = Promise.resolve();
  private readonly owner = randomUUID();
  private stopped?: Promise<unknown>;
  private retryAfter = 0;
  private closed = false;
  dropped = 0;
  lastError?: string;
  constructor(private config: TracingConfig, private readonly file = join(resolveStateDir(), 'traces', 'traces.db')) {
    this.startWorker();
  }
  private startWorker() {
    try {
      const worker = new Worker(traceStoreWorkerSource, { eval: true, execArgv: process.execArgv.filter((arg, index, args) => !arg.startsWith('--input-type') && args[index - 1] !== '--input-type'), workerData: { path: this.file, config: this.config, owner: this.owner } });
      this.worker = worker;
      worker.on('message', ({ id, value, error }) => {
        if (this.worker !== worker) return;
        const request = this.requests.get(id); if (!request) return;
        clearTimeout(request.timer); this.requests.delete(id); this.pendingBytes -= request.bytes;
        if (error) { this.lastError = error; request.reject(new Error(error)); } else { request.resolve(value); }
        if (!this.requests.size) worker.unref();
      });
      worker.on('error', error => this.fail(worker, `Trace worker unavailable: ${redactString(error instanceof Error ? error.message : 'Worker startup failed').slice(0, 200)}`));
      worker.on('exit', code => this.fail(worker, `Trace worker stopped (exit ${code})`));
      worker.unref();
      this.epochReady = this.dispatch(worker, 'status').then(s => {
        this.epoch = s.epoch;
        if (this.retryAfter) log.info({ phase: 'local_trace_worker_recovery' }, 'Local trace worker recovered');
        this.lastError = undefined;
      }, error => {
        this.fail(worker, error instanceof Error ? error.message : 'Trace worker startup failed');
        throw error;
      });
      // Startup may fail before the next caller arrives; keep the failure observable without an unhandled rejection.
      void this.epochReady.catch(() => {});
    } catch { this.lastError = 'Trace worker unavailable'; this.retryAfter = Date.now() + 1000; this.epochReady = Promise.resolve(); }
  }
  private fail(worker: Worker, message: string) {
    if (this.worker !== worker) return;
    this.lastError = message;
    if (!this.closed) log.warn({ phase: 'local_trace_worker', errorMessage: message, pendingRequests: this.requests.size, pendingBytes: this.pendingBytes }, 'Local trace worker stopped; a later request can recover recording');
    this.worker = undefined;
    this.retryAfter = Date.now() + 1000;
    for (const r of this.requests.values()) { clearTimeout(r.timer); r.reject(new Error(message)); }
    this.requests.clear(); this.pendingBytes = 0;
    this.stopped = worker.terminate().catch(() => {});
  }
  async request(op: string, data?: unknown): Promise<any> {
    if (op === 'configure') this.config = data as TracingConfig;
    return this.dispatch(await this.readyWorker(), op, data);
  }
  private async readyWorker(): Promise<Worker> {
    if (this.closed) throw new Error('Trace store closed');
    if (!this.worker) {
      if (Date.now() < this.retryAfter) throw new Error(this.lastError ?? 'Trace storage unavailable');
      await this.stopped;
      if (this.closed) throw new Error('Trace store closed');
      // Concurrent readers and writers share one replacement, without replaying ambiguous timed-out writes.
      if (!this.worker) this.startWorker();
    }
    await this.epochReady;
    if (!this.worker) throw new Error(this.lastError ?? 'Trace storage unavailable');
    return this.worker;
  }
  private dispatch(worker: Worker, op: string, data?: unknown): Promise<any> {
    if (this.closed || this.worker !== worker) return Promise.reject(new Error(this.lastError ?? 'Trace storage unavailable'));
    const bytes = Buffer.byteLength(JSON.stringify(data ?? null));
    if (this.requests.size >= 2000 || this.pendingBytes + bytes > 8 * 1048576) { this.dropped++; throw new Error('Trace queue full'); }
    const id = ++this.sequence;
    this.pendingBytes += bytes;
    worker.ref();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        // Terminate a blocked worker: timed-out messages must not remain in its queue.
        this.dropped++;
        this.fail(worker, 'Trace storage timeout');
      }, 5000);
      this.requests.set(id, { resolve, reject, timer, bytes });
      try { worker.postMessage({ id, op, data }); }
      catch { this.fail(worker, 'Trace worker unavailable'); }
    });
  }
  async begin(record: TraceRecord): Promise<number> {
    return this.request('put', { records: [record], epoch: null });
  }
  async write(record: TraceRecord, epoch?: number): Promise<void> {
    try {
      const worker = await this.readyWorker();
      await this.dispatch(worker, 'put', { records: [record], epoch: epoch ?? this.epoch });
      this.lastError = undefined;
    }
    catch (error) { this.dropped++; this.lastError = error instanceof Error ? error.message : 'Trace write failed'; }
  }
  async clear(): Promise<void> { this.epoch = await this.request('clear'); }
  async flush(): Promise<void> { await this.request('status'); }
  async close(): Promise<void> { this.closed = true; if (this.worker) this.fail(this.worker, 'Trace store closed'); await this.stopped; }
}
