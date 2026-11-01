import { createHash } from 'node:crypto';

import { canonicalJson } from '@xopcai/endpoint-tools-protocol';

import { DesktopOperationJournal, type DesktopOperationIntent, type DesktopOperationReceipt } from './operation-journal.js';

export interface DesktopExecutionAuthority {
  gatewayId: string;
  deviceId: string;
  authorizationRevision: number;
  toolRevision: string;
  workspaceId?: string;
  expiresAt: number;
  active: boolean;
}
export interface DesktopExecutionWorker {
  /** Resolves only after the executor has stopped; not merely after sending an action. */
  run(args: Record<string, unknown>, signal: AbortSignal): Promise<{ status: 'succeeded' | 'failed'; result: unknown }>;
  /** Confirmation must come from the executor, independently of network cancellation. */
  stop(): Promise<{ confirmed: boolean }>;
}
type Outcome = { state: 'succeeded' | 'failed'; result: unknown } | { state: 'stopped' | 'unknown' };
type Active = {
  operationId: string; controller: AbortController; intent: DesktopOperationIntent;
  stop: Promise<Outcome>; resolveStop(outcome: Outcome): void;
  worker: DesktopExecutionWorker; stopRequested: boolean; terminal: boolean; stopping?: Promise<void>;
};

/** Internal supervisor. Transport approval and native capability grants remain separate. */
export class DesktopOperationSupervisor {
  private active?: Active;
  private uncertain?: Active;
  private blocked = false;
  constructor(private readonly options: {
    journal: DesktopOperationJournal;
    authority(tool: string): DesktopExecutionAuthority;
    createWorker(tool: string, intent?: DesktopOperationIntent): DesktopExecutionWorker;
    validateResult?(result: unknown, tool: string): unknown;
    stopTimeoutMs?: number;
  }) {
    options.journal.attachSupervisor();
    this.blocked = options.journal.hasUnknown() || options.journal.hasUnconfirmedStops();
  }
  status(): { activeOperationId?: string; blocked: boolean; stopRequested: boolean; stopUnconfirmed: boolean } {
    return { ...(this.active ? { activeOperationId: this.active.operationId } : {}), blocked: this.blocked, stopRequested: this.active?.stopRequested ?? false, stopUnconfirmed: Boolean(this.uncertain) || this.options.journal.hasUnconfirmedStops() };
  }
  inspect(intent: DesktopOperationIntent): DesktopOperationReceipt | undefined {
    const authority = this.options.authority(intent.tool);
    if (!authority.active || authority.gatewayId !== intent.gatewayId || authority.deviceId !== intent.deviceId || Date.now() >= authority.expiresAt) {
      throw new Error('DESKTOP_EXECUTION_AUTHORITY_INVALID');
    }
    return this.options.journal.inspect(intent);
  }
  private authorize(intent: DesktopOperationIntent): void {
    const authority = this.options.authority(intent.tool);
    if (!authority.active || authority.gatewayId !== intent.gatewayId || authority.deviceId !== intent.deviceId
      || authority.authorizationRevision !== intent.authorizationRevision || authority.toolRevision !== intent.toolRevision
      || authority.workspaceId !== intent.workspaceId
      || Date.now() >= Math.min(authority.expiresAt, intent.expiresAt)
      || intent.expiresAt > authority.expiresAt || intent.expiresAt - Date.now() > 300000) throw new Error('DESKTOP_EXECUTION_AUTHORITY_INVALID');
  }
  async execute(input: {
    intent: DesktopOperationIntent; invocationId: string; connectionInstanceId: string;
    arguments: Record<string, unknown>; signal: AbortSignal;
  }): Promise<{ receipt: DesktopOperationReceipt; result?: unknown; repeated: boolean }> {
    input.signal.throwIfAborted();
    this.authorize(input.intent);
    const encoded = canonicalJson(input.arguments);
    if (Buffer.byteLength(encoded) > 65536 || createHash('sha256').update(encoded).digest('hex') !== input.intent.argumentHash) throw new Error('DESKTOP_EXECUTION_ARGUMENT_MISMATCH');
    const existing = this.options.journal.inspect(input.intent);
    if (existing) return { receipt: existing, repeated: true };
    if (this.blocked) throw new Error(this.status().stopUnconfirmed ? 'DESKTOP_EXECUTION_STOP_UNCONFIRMED' : 'DESKTOP_OPERATION_RECONCILIATION_REQUIRED');
    if (this.active) throw new Error('DESKTOP_EXECUTION_BUSY');
    // Worker construction must have no external side effect. Execution begins only after start commits.
    const worker = this.options.createWorker(input.intent.tool, structuredClone(input.intent));
    let resolveStop!: (outcome: Outcome) => void;
    const stop = new Promise<Outcome>(resolve => { resolveStop = resolve; });
    const run: Active = { operationId: input.intent.operationId, intent: { ...input.intent }, controller: new AbortController(),
      stop, resolveStop, worker, stopRequested: false, terminal: false };
    this.active = run;
    let deadline: ReturnType<typeof setTimeout> | undefined, authorityCheck: ReturnType<typeof setInterval> | undefined;
    const cancel = () => { void this.stopRun(run); };
    try {
      this.authorize(run.intent); input.signal.throwIfAborted();
      this.options.journal.record(run.intent);
      this.options.journal.start(run.intent, { invocationId: input.invocationId, connectionInstanceId: input.connectionInstanceId });
      input.signal.addEventListener('abort', cancel, { once: true });
      // A monotonic timer still terminates work if the system wall clock moves backwards.
      deadline = setTimeout(cancel, Math.max(1, run.intent.expiresAt - Date.now()));
      authorityCheck = setInterval(() => { try { this.authorize(run.intent); } catch { cancel(); } }, 250);
      const execution: Promise<Outcome> = Promise.resolve().then(() => {
        run.controller.signal.throwIfAborted(); this.authorize(run.intent);
        return worker.run(JSON.parse(encoded), run.controller.signal);
      }).then(value => {
        // Once stop was requested, only an executor stop acknowledgement can resolve cancellation.
        if (run.stopRequested) return run.stop;
        return { state: value.status, result: value.result };
      }, () => run.stopRequested ? run.stop : this.unknown(run));
      const outcome = await Promise.race([execution, run.stop]);
      run.terminal = true;
      let resultHash: string | undefined;
      if ('result' in outcome) {
        try {
          if (this.options.validateResult) outcome.result = this.options.validateResult(outcome.result, run.intent.tool);
          const result = canonicalJson(outcome.result);
          if (Buffer.byteLength(result) > 65536) throw new Error('DESKTOP_EXECUTION_RESULT_LIMIT');
          resultHash = createHash('sha256').update(result).digest('hex');
        } catch { this.blocked = true; this.uncertain = run; return { receipt: this.options.journal.finish(run.intent, 'unknown'), repeated: false }; }
      }
      if (outcome.state === 'stopped') this.blocked = true;
      if (outcome.state === 'unknown') { this.blocked = true; this.uncertain = run; }
      const receipt = this.options.journal.finish(run.intent, outcome.state, resultHash);
      return { receipt, ...('result' in outcome ? { result: outcome.result } : {}), repeated: false };
    } catch (error) {
      // Storage or authority failures may occur after start. Always try to stop independently.
      this.blocked = true; this.uncertain = run; await this.stopRun(run); throw error;
    } finally {
      clearTimeout(deadline); clearInterval(authorityCheck); input.signal.removeEventListener('abort', cancel);
      if (this.active === run) this.active = undefined;
    }
  }
  private unknown(run: Active): Outcome { this.blocked = true; void this.stopRun(run); return { state: 'unknown' }; }
  private stopRun(run: Active): Promise<void> {
    if (run.stopping) return run.stopping;
    if (run.terminal) return Promise.resolve();
    run.stopRequested = true; run.controller.abort();
    run.stopping = (async () => {
      let recorded = false;
      try { this.options.journal.requestStop(run.intent); recorded = true; } catch { this.blocked = true; }
      let timeout: ReturnType<typeof setTimeout> | undefined;
      try {
        const stopped = await Promise.race([Promise.resolve().then(() => run.worker.stop()), new Promise<{ confirmed: false }>(resolve => {
          timeout = setTimeout(() => resolve({ confirmed: false }), Math.min(3000, Math.max(1, this.options.stopTimeoutMs ?? 3000)));
        })]);
        const confirmed = recorded && stopped.confirmed;
        if (!confirmed) this.blocked = true;
        run.resolveStop({ state: confirmed ? 'stopped' : 'unknown' });
      } catch { this.blocked = true; run.resolveStop({ state: 'unknown' }); }
      finally { clearTimeout(timeout); }
    })();
    return run.stopping;
  }
  async stop(): Promise<{ state: 'idle' | 'stopped' | 'unknown'; resultUnknown?: true }> {
    const run = this.active;
    if (!run && this.uncertain) {
      const uncertain = this.uncertain;
      await uncertain.stopping;
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        const stopped = await Promise.race([uncertain.worker.stop(), new Promise<{ confirmed: false }>(resolve => {
          timer = setTimeout(() => resolve({ confirmed: false }), Math.min(3000, Math.max(1, this.options.stopTimeoutMs ?? 3000)));
        })]);
        if (stopped.confirmed) {
          this.options.journal.confirmUnknownStopped(uncertain.intent);
          this.uncertain = undefined;
          return { state: 'stopped', resultUnknown: true };
        }
      } catch { /* A failed stop does not resolve the unknown operation. */ }
      finally { clearTimeout(timer); }
      return { state: 'unknown' };
    }
    if (!run) return this.blocked ? this.options.journal.hasUnconfirmedStops() ? { state: 'unknown' } : { state: 'stopped', resultUnknown: true } : { state: 'idle' };
    await this.stopRun(run);
    const outcome = await run.stop;
    return outcome.state === 'stopped' ? { state: 'stopped', resultUnknown: true } : { state: 'unknown' };
  }
}
