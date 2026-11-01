import { Worker } from 'node:worker_threads';

import { z } from 'zod';

import type { DesktopExecutionWorker } from './operation-supervisor.js';

const version = z.string().regex(/^[a-f0-9]{64}$/);
const text = z.string().refine(value => Buffer.byteLength(value, 'utf8') <= 32768);
const requestSchema = z.discriminatedUnion('action', [
  z.strictObject({ action: z.literal('read'), relativePath: z.string().max(4096) }),
  z.strictObject({ action: z.literal('list'), relativePath: z.string().max(4096) }),
  z.strictObject({ action: z.literal('write'), relativePath: z.string().max(4096), text, expectedVersion: version.nullable() }),
]);
const responseSchema = z.discriminatedUnion('ok', [
  z.strictObject({ ok: z.literal(false), error: z.string().regex(/^WORKSPACE_[A-Z_]+$/).max(100) }),
  z.strictObject({ ok: z.literal(true), result: z.union([
    z.strictObject({ text, version, bytes: z.number().int().min(0).max(32768) }),
    z.strictObject({ version, bytes: z.number().int().min(0).max(32768) }),
    z.strictObject({ entries: z.array(z.strictObject({ name: z.string().max(255), kind: z.enum(['file', 'directory']) })).max(100), truncated: z.boolean() }),
  ]) }),
]);
type Request = z.infer<typeof requestSchema>;
type Response = z.infer<typeof responseSchema>;
const identitySchema = z.strictObject({ path: z.string().max(32768), device: z.string().regex(/^\d+$/), inode: z.string().regex(/^\d+$/) });

/** Directory FD operations share the Electron process lifetime, but never block its UI thread. */
export class DesktopWorkspaceHelper {
  private readonly thread: Worker;
  private readonly exited: Promise<void>;
  private pending?: { resolve(value: Response): void; reject(error: Error): void };
  private ready = false;
  private closed = false;
  private rootIdentity?: z.infer<typeof identitySchema>;
  private constructor(addonPath: string, root: string, workerPath: string | URL, resolveReady: () => void, rejectReady: (error: Error) => void) {
    this.thread = new Worker(workerPath, { workerData: { addonPath, root }, resourceLimits: { maxOldGenerationSizeMb: 32 }, env: {} });
    this.exited = new Promise(resolve => this.thread.once('exit', () => {
      this.closed = true;
      const error = new Error('WORKSPACE_EXECUTOR_STOPPED');
      if (!this.ready) rejectReady(error);
      this.pending?.reject(error); this.pending = undefined; resolve();
    }));
    this.thread.on('error', () => { rejectReady(new Error('WORKSPACE_EXECUTOR_UNAVAILABLE')); this.fail(); });
    this.thread.on('message', input => {
      try {
        if (this.closed) return;
        if (!this.ready) {
          const value = z.strictObject({ ready: z.literal(true), identity: identitySchema }).parse(input);
          this.rootIdentity = value.identity; this.ready = true; resolveReady();
        } else {
          const pending = this.pending;
          if (!pending) throw new Error('WORKSPACE_UNEXPECTED_REPLY');
          const response = responseSchema.parse(input); this.pending = undefined; pending.resolve(response);
        }
      } catch { rejectReady(new Error('WORKSPACE_PROTOCOL_ERROR')); this.fail(); }
    });
  }
  static async open(addonPath: string, approvedRoot: string, workerPath: string | URL = new URL('./workspace-worker.cjs', import.meta.url)): Promise<DesktopWorkspaceHelper> {
    if (process.platform !== 'darwin') throw new Error('WORKSPACE_PLATFORM_UNSUPPORTED');
    let resolveReady!: () => void, rejectReady!: (error: Error) => void;
    const ready = new Promise<void>((resolve, reject) => { resolveReady = resolve; rejectReady = reject; });
    const executor = new DesktopWorkspaceHelper(addonPath, approvedRoot, workerPath, resolveReady, rejectReady);
    const deadline = setTimeout(() => { rejectReady(new Error('WORKSPACE_EXECUTOR_TIMEOUT')); executor.fail(); }, 5000);
    try { await ready; return executor; }
    catch (error) { executor.fail(); throw error; }
    finally { clearTimeout(deadline); }
  }
  private fail(): void {
    this.closed = true; void this.thread.terminate().catch(() => {});
    this.pending?.reject(new Error('WORKSPACE_OUTCOME_UNKNOWN')); this.pending = undefined;
  }
  identity(): z.infer<typeof identitySchema> {
    if (!this.rootIdentity || this.closed) throw new Error('WORKSPACE_EXECUTOR_STOPPED');
    return structuredClone(this.rootIdentity);
  }
  async request(input: Request): Promise<Response> {
    const parsed = requestSchema.parse(input);
    if (!this.ready || this.closed) throw new Error('WORKSPACE_EXECUTOR_STOPPED');
    if (this.pending) throw new Error('WORKSPACE_EXECUTOR_BUSY');
    return new Promise<Response>((resolve, reject) => {
      this.pending = { resolve, reject };
      try { this.thread.postMessage(parsed); } catch { this.fail(); }
    });
  }
  async stop(): Promise<{ confirmed: boolean }> {
    this.closed = true;
    void this.thread.terminate().catch(() => {});
    // A blocked native syscall may delay termination. The supervisor's existing timeout keeps the OS lease in that case.
    await this.exited;
    return { confirmed: true };
  }
  worker(action: Request['action']): DesktopExecutionWorker {
    let used = false;
    return {
      run: async (args, signal) => {
        signal.throwIfAborted();
        if (used || Object.hasOwn(args, 'action')) throw new Error('WORKSPACE_ARGUMENT_INVALID');
        used = true;
        const response = await this.request({ ...args, action } as Request);
        if (response.ok === false && response.error === 'WORKSPACE_OUTCOME_UNKNOWN') throw new Error('WORKSPACE_OUTCOME_UNKNOWN');
        return { status: response.ok ? 'succeeded' : 'failed', result: { content: [{ type: 'json', value: response }] } };
      },
      stop: () => this.stop(),
    };
  }
}
