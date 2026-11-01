import { spawn, type ChildProcess } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

import type { RemoteBrowserCommand } from '@xopcai/browser-control-contract/remote';
import type { DesktopOperationIntent } from '@xopcai/endpoint-tools-protocol';

import type { DesktopBrowserBroker } from './browser-session.js';
import type { DesktopBrowserResources } from './browser-resources.js';

const groupExists = (group: number) => { try { process.kill(-group, 0); return true; } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ESRCH') return false; throw error; } };

/** Inert until prepare, with a private OS IPC pipe and detached process group. No network debugging port or public IPC. */
export class DesktopBrowserProcess implements DesktopBrowserBroker {
  private child?: ChildProcess;
  private directory?: string;
  private readonly generation = randomUUID();
  private sequence = 0;
  private closed = false;
  private stopping?: Promise<{ confirmed: boolean }>;
  private readonly pending = new Map<number, { resolve(value: unknown): void; reject(error: Error): void; timer: ReturnType<typeof setTimeout> }>();
  constructor(private readonly options: {
    executable: string; appPath?: string; expiresAt: number; resources: DesktopBrowserResources; current(): boolean;
    approve(command: RemoteBrowserCommand, tabs: Array<{ id: string; url: string; title: string; active: boolean }>, signal: AbortSignal): Promise<boolean>;
  }) {}
  async prepare(intent: DesktopOperationIntent, signal: AbortSignal): Promise<void> {
    signal.throwIfAborted(); if (this.closed || !this.options.current()) throw new Error('DESKTOP_BROWSER_AUTHORITY_INVALID');
    if (process.platform !== 'darwin') throw new Error('DESKTOP_BROWSER_PLATFORM_UNSUPPORTED');
    await this.options.resources.begin(intent);
    if (!this.child) {
      this.directory = await mkdtemp(join(tmpdir(), 'xopc-device-browser-'));
      signal.throwIfAborted(); if (this.closed || !this.options.current()) throw new Error('DESKTOP_BROWSER_AUTHORITY_INVALID');
      const environment: NodeJS.ProcessEnv = {};
      for (const key of ['PATH', 'HOME', 'TMPDIR', 'LANG', 'LC_ALL']) if (process.env[key]) environment[key] = process.env[key];
      Object.assign(environment, { XOPC_PRIVATE_BROWSER_GENERATION: this.generation, XOPC_PRIVATE_BROWSER_PARENT: String(process.pid),
        XOPC_PRIVATE_BROWSER_USER_DATA: this.directory, XOPC_PRIVATE_BROWSER_EXPIRES_AT: String(this.options.expiresAt) });
      this.child = spawn(this.options.executable, [...(this.options.appPath ? [this.options.appPath] : []), '--xopc-private-browser-worker'], {
        env: environment, detached: true, stdio: ['ignore', 'ignore', 'ignore', 'ipc'], serialization: 'json',
      });
      this.child.on('message', (message: any) => {
        if (message?.generation !== this.generation || !Number.isSafeInteger(message.id)) return;
        const pending = this.pending.get(message.id); if (!pending) { message?.value?.frame?.bytes?.fill?.(0); return; }
        this.pending.delete(message.id); clearTimeout(pending.timer);
        if (message.ok === true) pending.resolve(message.value); else pending.reject(new Error('DESKTOP_BROWSER_WORKER_FAILED'));
      });
      const failed = () => { for (const pending of this.pending.values()) { clearTimeout(pending.timer); pending.reject(new Error('DESKTOP_BROWSER_WORKER_EXITED')); } this.pending.clear(); };
      this.child.once('error', failed); this.child.once('exit', failed);
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => { this.pending.delete(0); reject(new Error('DESKTOP_BROWSER_WORKER_TIMEOUT')); void this.dispose(); }, 30000);
        this.pending.set(0, { resolve: () => resolve(), reject, timer });
      });
      const identity = await this.rpc('initialize') as { workerGroup?: number; generation?: string };
      if (identity.workerGroup !== this.child.pid || identity.generation !== this.generation) throw new Error('DESKTOP_BROWSER_WORKER_IDENTITY_INVALID');
    }
    signal.throwIfAborted(); if (this.closed || !this.options.current() || !this.child.pid) throw new Error('DESKTOP_BROWSER_AUTHORITY_INVALID');
    await this.options.resources.ready(intent, { workerGroup: this.child.pid, generation: this.generation });
  }
  private rpc(command: string, input?: RemoteBrowserCommand): Promise<unknown> {
    const child = this.child; if (!child?.connected || this.closed && command !== 'stop') return Promise.reject(new Error('DESKTOP_BROWSER_WORKER_UNAVAILABLE'));
    if (this.pending.size >= 2) return Promise.reject(new Error('DESKTOP_BROWSER_BUSY'));
    const id = ++this.sequence;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error('DESKTOP_BROWSER_WORKER_TIMEOUT')); void this.dispose(); }, 30000);
      this.pending.set(id, { resolve, reject, timer });
      child.send({ id, generation: this.generation, command, ...(input ? { input } : {}) }, error => {
        if (!error) return; const pending = this.pending.get(id); this.pending.delete(id); clearTimeout(timer); pending?.reject(new Error('DESKTOP_BROWSER_WORKER_UNAVAILABLE'));
      });
    });
  }
  async execute(command: RemoteBrowserCommand, signal: AbortSignal): ReturnType<DesktopBrowserBroker['execute']> {
    signal.throwIfAborted();
    if (this.closed || !this.options.current()) throw new Error('DESKTOP_BROWSER_AUTHORITY_INVALID');
    const abort = () => { void this.dispose(); }; signal.addEventListener('abort', abort, { once: true });
    try {
      // Stops never wait for another consent prompt.
      if (command.input.action !== 'close') {
        const tabs = await this.rpc('metadata') as Parameters<typeof this.options.approve>[1];
        if (!await this.options.approve(structuredClone(command), structuredClone(tabs), signal)) {
          return { dispatch: 'notStarted', result: { ok: false, error: { code: 'ABORTED', message: 'Local native Browser approval was denied.' } } };
        }
      }
      signal.throwIfAborted(); if (this.closed || !this.options.current()) throw new Error('DESKTOP_BROWSER_AUTHORITY_INVALID');
      const value = await this.rpc('execute', command) as { result: Awaited<ReturnType<DesktopBrowserBroker['execute']>>['result']; dispatch: 'completed' | 'notStarted' | 'unknown'; frame?: { bytesBase64: string; mimeType: 'image/png' | 'image/jpeg' } };
      let frame: Awaited<ReturnType<DesktopBrowserBroker['execute']>>['frame'];
      if (value.frame) {
        const encoded = value.frame.bytesBase64;
        if (typeof encoded !== 'string' || encoded.length > 7 * 1024 * 1024 || encoded.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(encoded)
          || !['image/png', 'image/jpeg'].includes(value.frame.mimeType)) throw new Error('DESKTOP_BROWSER_FRAME_INVALID');
        const bytes = Buffer.from(encoded, 'base64');
        if (!bytes.byteLength || bytes.byteLength > 5 * 1024 * 1024) { bytes.fill(0); throw new Error('DESKTOP_BROWSER_FRAME_INVALID'); }
        frame = { bytes, mimeType: value.frame.mimeType };
      }
      const reply = { result: value.result, dispatch: value.dispatch, ...(frame ? { frame } : {}) };
      if (signal.aborted || this.closed || !this.options.current()) { reply?.frame?.bytes?.fill(0); signal.throwIfAborted(); throw new Error('DESKTOP_BROWSER_AUTHORITY_INVALID'); }
      return reply;
    } finally { signal.removeEventListener('abort', abort); }
  }
  dispose(): Promise<{ confirmed: boolean }> {
    this.closed = true;
    this.stopping ??= (async () => {
      const child = this.child, group = child?.pid;
      // Only signal the group created by this live child handle. Recovery only observes liveness and never kills persisted PIDs.
      if (group && child.exitCode === null && child.signalCode === null) { try { process.kill(-group, 'SIGKILL'); } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ESRCH') return { confirmed: false }; } }
      const until = performance.now() + 2800;
      while (group && groupExists(group)) { if (performance.now() >= until) return { confirmed: false }; await delay(20); }
      for (const pending of this.pending.values()) { clearTimeout(pending.timer); pending.reject(new Error('DESKTOP_BROWSER_STOPPED')); } this.pending.clear();
      if (this.directory) await rm(this.directory, { recursive: true, force: true });
      return { confirmed: true };
    })().catch(() => ({ confirmed: false })).then(result => { if (!result.confirmed) this.stopping = undefined; return result; });
    return this.stopping;
  }
}
