import { randomBytes, randomUUID } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import { record } from './types.js';

interface Waiter { id: string; kind: string; resolve: (id: string) => void; reject: (reason: Error) => void; signal: AbortSignal; cancel: () => void; context: unknown }
/** Shared parent and per-role limits. Active leases never expire into replay. */
export class RequestPool {
  private active = new Map<string, string>();
  private queue: Waiter[] = [];
  private targets: Record<string, number>;
  private closed = false;
  private admitted = 0;
  readonly peaks: Record<string, number> = { total: 0 };
  constructor(readonly limits: Record<string, number> = { generation: 4, judge: 2 }, readonly parent = 6, private changed: (state: unknown) => void = () => {}, private maxRequests = Number.POSITIVE_INFINITY) {
    if (!Number.isInteger(parent) || parent < 1 || Object.values(limits).some(n => !Number.isInteger(n) || n < 1)) throw new Error('Invalid request limits');
    this.targets = { ...limits };
  }
  acquire(kind: string, signal: AbortSignal, context: unknown = null): Promise<string> {
    if (!(kind in this.limits) || signal.aborted || this.closed || this.admitted >= this.maxRequests) return Promise.reject(new Error('Invalid, exhausted or cancelled lease request'));
    return new Promise((resolve, reject) => {
      const id = randomUUID();
      const cancel = () => { const index = this.queue.findIndex(w => w.id === id); if (index >= 0) this.queue.splice(index, 1); reject(new Error('Lease cancelled')); this.pump(); };
      this.queue.push({ id, kind, resolve, reject, signal, cancel, context });
      this.changed({ ...this.snapshot(), event: { type: 'queued', lease: id, role: kind, context } });
      signal.addEventListener('abort', cancel, { once: true });
      this.pump();
    });
  }
  release(id: string, overloaded = false, reason?: string): void {
    const kind = this.active.get(id);
    if (!kind) throw new Error('Unknown or already released lease');
    this.active.delete(id);
    if (overloaded) this.targets[kind] = Math.max(1, Math.floor(this.targets[kind]! / 2));
    this.changed({ ...this.snapshot(), event: { type: 'released', lease: id, role: kind, overloaded, reason } });
    this.pump();
  }
  private pump(): void {
    for (let i = 0; i < this.queue.length && this.active.size < this.parent;) {
      const item = this.queue[i]!;
      if (this.admitted >= this.maxRequests) {
        this.queue.splice(i, 1); item.signal.removeEventListener('abort', item.cancel); item.reject(new Error('Request budget exhausted')); continue;
      }
      if ([...this.active.values()].filter(k => k === item.kind).length >= this.targets[item.kind]!) { i++; continue; }
      this.queue.splice(i, 1); item.signal.removeEventListener('abort', item.cancel);
      this.active.set(item.id, item.kind);
      this.admitted++;
      this.changed({ ...this.snapshot(), event: { type: 'acquired', lease: item.id, role: item.kind, context: item.context } });
      this.peaks.total = Math.max(this.peaks.total!, this.active.size);
      this.peaks[item.kind] = Math.max(this.peaks[item.kind] ?? 0, [...this.active.values()].filter(k => k === item.kind).length);
      item.resolve(item.id);
    }
    this.changed(this.snapshot());
  }
  close(): void {
    this.closed = true;
    for (const item of this.queue.splice(0)) { item.signal.removeEventListener('abort', item.cancel); item.reject(new Error('Pool closed')); }
    this.changed(this.snapshot());
  }
  snapshot() {
    return { parent: this.parent, limits: this.limits, targets: this.targets, active: this.active.size, queued: this.queue.length,
      admitted: this.admitted, maxRequests: Number.isFinite(this.maxRequests) ? this.maxRequests : null,
      byRole: Object.fromEntries(Object.keys(this.limits).map(k => [k, [...this.active.values()].filter(v => v === k).length])), peaks: this.peaks, closed: this.closed };
  }
}

export interface PoolEndpoint { url: string; token: string }
export async function startPool(pool: RequestPool, upstream?: PoolEndpoint): Promise<{ server: Server; url: string; token: string }> {
  const token = randomBytes(24).toString('hex');
  const remoteLeases = new Map<string, string>();
  const owners = new Map<string, number>();
  const reclaiming = new Set<string>();
  const remote = async (path: string, body: unknown, signal?: AbortSignal) => {
    const response = await fetch(upstream!.url + path, { method: 'POST', headers: { Authorization: `Bearer ${upstream!.token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body), ...(signal ? { signal } : {}) });
    if (!response.ok) throw new Error('Shared request pool unavailable');
    return record(await response.json());
  };
  const release = async (id: string, overloaded = false, reason?: string) => {
    if (upstream && remoteLeases.has(id)) {
      await remote('/release', { lease: remoteLeases.get(id), overloaded }); remoteLeases.delete(id);
    }
    pool.release(id, overloaded, reason); owners.delete(id);
  };
  // A lease has no timeout. Only an OS-confirmed dead local owner can be reclaimed.
  const reaper = setInterval(() => {
    for (const [id, pid] of owners) {
      if (reclaiming.has(id)) continue;
      try { process.kill(pid, 0); continue; }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ESRCH') continue; }
      reclaiming.add(id);
      void release(id, false, 'os_confirmed_owner_dead_usage_unknown').catch(() => {}).finally(() => reclaiming.delete(id));
    }
  }, 250);
  reaper.unref();
  const server = createServer(async (req, res) => {
    if (req.headers.authorization !== `Bearer ${token}`) { res.writeHead(401).end(); return; }
    const controller = new AbortController();
    res.on('close', () => { if (!res.writableEnded) controller.abort(); });
    let lease: string | undefined;
    try {
      const buffers: Buffer[] = []; let bytes = 0;
      for await (const chunk of req) { bytes += Buffer.byteLength(chunk); if (bytes > 4096) throw new Error('Body too large'); buffers.push(Buffer.from(chunk)); }
      const body = record(JSON.parse(Buffer.concat(buffers).toString() || '{}'));
      let result: unknown;
      if (req.url === '/status') result = pool.snapshot();
      else if (req.method === 'POST' && req.url === '/acquire') {
        const context = record(body.context);
        lease = await pool.acquire(String(body.pool), controller.signal, { pid: context.pid, origin: context.origin, requestId: context.requestId });
        if (upstream) {
          try {
            const global = await remote('/acquire', { pool: body.pool, context: { ...context, pid: process.pid } }, controller.signal);
            remoteLeases.set(lease, String(global.lease));
          } catch (error) { pool.release(lease); lease = undefined; throw error; }
        }
        if (Number.isInteger(context.pid) && Number(context.pid) > 0) owners.set(lease, Number(context.pid));
        result = { lease };
      }
      else if (req.method === 'POST' && req.url === '/release') {
        const id = String(body.lease);
        await release(id, body.overloaded === true); result = pool.snapshot();
      }
      else { res.writeHead(404).end(); return; }
      if (controller.signal.aborted) {
        if (lease) {
          await release(lease);
        }
        return;
      }
      res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }).end(JSON.stringify(result));
    } catch (error) {
      if (!res.destroyed) res.writeHead(400, { 'Content-Type': 'application/json' }).end(JSON.stringify({ error: error instanceof Error ? error.message : String(error) }));
    }
  });
  server.once('close', () => clearInterval(reaper));
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Pool did not bind');
  return { server, url: `http://127.0.0.1:${address.port}`, token };
}
