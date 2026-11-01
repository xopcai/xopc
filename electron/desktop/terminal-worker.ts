import { createHash } from 'node:crypto';

import { canonicalJson, desktopTerminalBindingSchema, type DesktopOperationIntent, type DesktopTerminalBinding, type DesktopTerminalOutput } from '@xopcai/endpoint-tools-protocol';
import { z } from 'zod';

import type { DesktopContainerEngine } from './container-engine.js';
import type { DesktopContainerResources } from './container-resources.js';
import type { DesktopExecutionWorker } from './operation-supervisor.js';
import { DesktopTerminalBytes, type DesktopTerminalInputLedger } from './terminal-bytes.js';

/** A running root operation, not an ordinary tool that finishes when its terminal opens. Not exposed without a dedicated broker. */
export class DesktopTerminalWorker implements DesktopExecutionWorker {
  private readonly binding: DesktopTerminalBinding;
  private started = false;
  private cancelled = false;
  private prepared = false;
  private id?: string;
  private preparing?: Promise<void>;
  private creating?: Promise<void>;
  private opening?: Promise<void>;
  private stopping?: Promise<{ confirmed: boolean }>;
  private stream?: DesktopTerminalBytes;
  private readonly lifetime = new AbortController();
  private readonly watchdog: ReturnType<typeof setInterval>;
  private resolveReady!: (binding: DesktopTerminalBinding) => void;
  private rejectReady!: (error: unknown) => void;
  readonly ready: Promise<DesktopTerminalBinding>;
  constructor(private readonly options: {
    engine: DesktopContainerEngine; resources: DesktopContainerResources; intent: DesktopOperationIntent;
    ownerId: string; workspaceId: string; imageId: string; binding: DesktopTerminalBinding;
    ledger: DesktopTerminalInputLedger; current(): boolean; emit(frame: DesktopTerminalOutput): void;
  }) {
    this.binding = desktopTerminalBindingSchema.parse(options.binding);
    if (options.intent.tool !== 'desktop.terminal.open' || options.intent.workspaceId !== options.workspaceId) throw new Error('DESKTOP_TERMINAL_INTENT_INVALID');
    this.ready = new Promise((resolve, reject) => { this.resolveReady = resolve; this.rejectReady = reject; });
    void this.ready.catch(() => {});
    // A revoked scope never becomes current again; the owner supplies a monotonic generation fence.
    this.watchdog = setInterval(() => { if (!this.options.current() || Date.now() >= this.options.intent.expiresAt) void this.stop(); }, 250);
    this.watchdog.unref();
  }
  private ownership() { return { ownerId: this.options.ownerId, workspaceId: this.options.workspaceId, operationId: this.options.intent.operationId }; }
  private current() {
    if (this.cancelled || !this.options.current() || Date.now() >= this.options.intent.expiresAt) throw new Error('DESKTOP_TERMINAL_AUTHORITY_INVALID');
  }
  /** Caller must commit the root journal's running state before invoking this method. It resolves only after verified removal. */
  async run(input: Record<string, unknown>, signal: AbortSignal) {
    if (this.started || this.cancelled) throw new Error('DESKTOP_TERMINAL_ALREADY_STARTED');
    this.started = true;
    const abort = () => { void this.stop(); };
    signal.addEventListener('abort', abort, { once: true });
    try {
      this.current(); signal.throwIfAborted();
      const args = z.strictObject({ workspaceId: z.uuid(), argv: z.array(z.string().max(4000).refine(value => !value.includes('\0'))).min(1).max(32) }).parse(input);
      if (!args.argv[0] || args.workspaceId !== this.options.workspaceId || Buffer.byteLength(JSON.stringify(args.argv)) > 4000
        || createHash('sha256').update(canonicalJson(args)).digest('hex') !== this.options.intent.argumentHash) throw new Error('DESKTOP_TERMINAL_ARGUMENT_MISMATCH');
      this.preparing = this.options.resources.prepare(this.options.intent, { ownerId: this.options.ownerId, workspaceId: this.options.workspaceId,
        socketPath: this.options.engine.socketPath, engineId: this.options.engine.engineId, imageId: this.options.imageId, argv: args.argv });
      await this.preparing; this.prepared = true; this.current(); signal.throwIfAborted();
      this.creating = (async () => {
        this.id = await this.options.engine.create({ ...this.ownership(), imageId: this.options.imageId, argv: args.argv, tty: true });
        await this.options.resources.created(this.options.intent, this.id);
      })();
      await this.creating; this.current(); signal.throwIfAborted();
      this.opening = (async () => {
        const socket = await this.options.engine.attachTerminal(this.id!, this.ownership());
        if (this.cancelled) { socket.destroy(); throw new Error('DESKTOP_TERMINAL_AUTHORITY_INVALID'); }
        this.stream = new DesktopTerminalBytes({ binding: this.binding, socket, ledger: this.options.ledger, lastInputSequence: 0,
          current: () => !this.cancelled && this.options.current() && Date.now() < this.options.intent.expiresAt,
          emit: this.options.emit, onUnknown: () => { void this.stop(); }, onStreamClosed: () => { void this.stop(); } });
      })();
      await this.opening; this.current(); signal.throwIfAborted();
      await this.options.engine.start(this.id!, this.ownership());
      this.current(); signal.throwIfAborted(); this.stream!.startOutput(); this.resolveReady({ ...this.binding });
      const exitCode = await this.options.engine.wait(this.id!, this.ownership(), this.lifetime.signal);
      if (!(await this.stop()).confirmed) throw new Error('DESKTOP_TERMINAL_STOP_UNCONFIRMED');
      return { status: 'succeeded' as const, result: { content: [{ type: 'json' as const, value: { exitCode } }] } };
    } catch (error) { this.rejectReady(error); await this.stop(); throw error; }
    finally { signal.removeEventListener('abort', abort); }
  }
  async input(value: unknown, signal: AbortSignal) { this.current(); if (!this.stream) throw new Error('DESKTOP_TERMINAL_NOT_READY'); return this.stream.input(value, signal); }
  acknowledge(value: unknown) { this.current(); if (!this.stream) throw new Error('DESKTOP_TERMINAL_NOT_READY'); this.stream.acknowledge(value); }
  async resize(binding: DesktopTerminalBinding, columns: number, rows: number) {
    this.current();
    if (canonicalJson(desktopTerminalBindingSchema.parse(binding)) !== canonicalJson(this.binding) || !this.stream || !this.id) throw new Error('DESKTOP_TERMINAL_BINDING_INVALID');
    await this.options.engine.resizeTerminal(this.id, this.ownership(), columns, rows); this.current();
  }
  stop(): Promise<{ confirmed: boolean }> {
    if (this.stopping) return this.stopping;
    this.cancelled = true; clearInterval(this.watchdog); this.lifetime.abort();
    this.rejectReady(new Error('DESKTOP_TERMINAL_STOPPED')); this.stream?.close();
    this.stopping = (async () => {
      try {
        await this.preparing?.catch(() => {}); await this.creating?.catch(() => {}); await this.opening?.catch(() => {});
        this.stream?.close();
        if (this.id && !(await this.options.engine.remove(this.id, this.ownership())).confirmed) return { confirmed: false };
        if (this.prepared) await this.options.resources.stopped(this.options.intent);
        return { confirmed: true };
      } catch { return { confirmed: false }; }
    })().then(result => { if (!result.confirmed) this.stopping = undefined; return result; });
    return this.stopping;
  }
}
