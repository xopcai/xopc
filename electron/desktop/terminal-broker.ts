import { canonicalJson, desktopOperationIntentSchema, desktopTerminalBindingSchema, desktopTerminalInputSchema,
  type DesktopOperationIntent, type DesktopTerminalBinding, type DesktopTerminalInput, type DesktopTerminalOutput } from '@xopcai/endpoint-tools-protocol';

import type { DesktopOperationSupervisor } from './operation-supervisor.js';
import type { DesktopTerminalWorker } from './terminal-worker.js';

export type DesktopTerminalScope = DesktopTerminalBinding & {
  gatewayId: string; deviceId: string; workspaceId: string; authorizationRevision: number;
};
type Session = { scope: DesktopTerminalScope; intent: DesktopOperationIntent; worker: DesktopTerminalWorker;
  controller: AbortController; execution?: ReturnType<DesktopOperationSupervisor['execute']>; inputBusy: boolean; stopped: boolean };

/** Main-owned control boundary. A caller's remote payload can never opt out of native input approval. */
export class DesktopTerminalBroker {
  private session?: Session;
  private opening = false;
  private blocked = false;
  private closed = false;
  private pendingOpen?: AbortController;
  constructor(private readonly options: {
    current(scope: DesktopTerminalScope): boolean;
    confirmOpen(scope: DesktopTerminalScope, intent: DesktopOperationIntent, args: Record<string, unknown>, signal: AbortSignal): Promise<boolean>;
    confirmInput(scope: DesktopTerminalScope, input: DesktopTerminalInput, signal: AbortSignal): Promise<boolean>;
    create(scope: DesktopTerminalScope, intent: DesktopOperationIntent, emit: (frame: DesktopTerminalOutput) => void): {
      worker: DesktopTerminalWorker; supervisor: Pick<DesktopOperationSupervisor, 'execute'>;
    };
    emit(frame: DesktopTerminalOutput): void;
    confirmRootStopped?(intent: DesktopOperationIntent): Promise<boolean>;
  }) {}
  private same(a: DesktopTerminalScope, b: DesktopTerminalScope) { return canonicalJson(a) === canonicalJson(b); }
  private require(scope: DesktopTerminalScope): Session {
    const session = this.session;
    if (!session || session.stopped || this.blocked || !this.same(session.scope, scope) || !this.options.current(session.scope)
      || Date.now() >= session.intent.expiresAt) throw new Error('DESKTOP_TERMINAL_AUTHORITY_INVALID');
    return session;
  }
  async open(input: { scope: DesktopTerminalScope; intent: DesktopOperationIntent; args: Record<string, unknown>; invocationId: string; signal: AbortSignal }) {
    if (this.closed || this.blocked || this.session || this.opening) throw new Error('DESKTOP_TERMINAL_BUSY');
    const binding = desktopTerminalBindingSchema.parse({ sessionId: input.scope.sessionId, generation: input.scope.generation, connectionInstanceId: input.scope.connectionInstanceId });
    const intent = desktopOperationIntentSchema.parse(input.intent), scope = structuredClone(input.scope), args = structuredClone(input.args);
    if (intent.tool !== 'desktop.terminal.open' || intent.gatewayId !== scope.gatewayId || intent.deviceId !== scope.deviceId
      || intent.workspaceId !== scope.workspaceId || intent.authorizationRevision !== scope.authorizationRevision
      || !this.options.current(scope) || intent.expiresAt <= Date.now()) throw new Error('DESKTOP_TERMINAL_AUTHORITY_INVALID');
    this.opening = true;
    const pendingOpen = new AbortController(); this.pendingOpen = pendingOpen;
    try {
      const approvalSignal = AbortSignal.any([input.signal, pendingOpen.signal, AbortSignal.timeout(Math.max(1, Math.min(120000, intent.expiresAt - Date.now())))]);
      approvalSignal.throwIfAborted();
      if (!await this.options.confirmOpen(structuredClone(scope), structuredClone(intent), args, approvalSignal)) throw new Error('DESKTOP_TERMINAL_USER_DENIED');
      approvalSignal.throwIfAborted();
      if (!this.options.current(scope) || intent.expiresAt <= Date.now()) throw new Error('DESKTOP_TERMINAL_AUTHORITY_INVALID');
      const controller = new AbortController();
      let session!: Session;
      const root = this.options.create(scope, intent, frame => {
        this.require(scope);
        if (canonicalJson(desktopTerminalBindingSchema.parse({ sessionId: frame.sessionId, generation: frame.generation, connectionInstanceId: frame.connectionInstanceId })) !== canonicalJson(binding)) throw new Error('DESKTOP_TERMINAL_BINDING_INVALID');
        this.options.emit(frame);
      });
      session = { scope, intent, worker: root.worker, controller, inputBusy: false, stopped: false }; this.session = session;
      const abort = () => { controller.abort(); void this.stop(); };
      input.signal.addEventListener('abort', abort, { once: true });
      try {
        session.execution = root.supervisor.execute({ intent, arguments: args, invocationId: input.invocationId,
          connectionInstanceId: scope.connectionInstanceId, signal: controller.signal });
        void session.execution.then(outcome => { session.stopped = true; if (!outcome.receipt.executionStopped) this.blocked = true; }, () => { session.stopped = true; this.blocked = true; });
        await Promise.race([root.worker.ready, session.execution.then(() => { throw new Error('DESKTOP_TERMINAL_CLOSED_BEFORE_READY'); })]);
        input.signal.throwIfAborted(); this.require(scope);
        // Startup caller cancellation no longer owns the established session; its independently bounded grant still does.
        return { ...binding, operationId: intent.operationId, state: 'running' as const, executionStopped: false as const };
      } catch (error) { await this.stop(); throw error; }
      finally { input.signal.removeEventListener('abort', abort); }
    } finally { this.opening = false; if (this.pendingOpen === pendingOpen) this.pendingOpen = undefined; }
  }
  async input(scope: DesktopTerminalScope, value: unknown, signal: AbortSignal) {
    const session = this.require(scope), input = desktopTerminalInputSchema.parse(value);
    if (input.sessionId !== scope.sessionId || input.generation !== scope.generation || input.connectionInstanceId !== scope.connectionInstanceId) throw new Error('DESKTOP_TERMINAL_BINDING_INVALID');
    if (session.inputBusy) throw new Error('DESKTOP_TERMINAL_INPUT_BUSY');
    session.inputBusy = true;
    try {
      const approvalSignal = AbortSignal.any([signal, session.controller.signal, AbortSignal.timeout(Math.max(1, Math.min(120000, session.intent.expiresAt - Date.now())))]);
      approvalSignal.throwIfAborted();
      if (!await this.options.confirmInput(structuredClone(scope), structuredClone(input), approvalSignal)) {
        approvalSignal.throwIfAborted(); this.require(scope); return await session.worker.rejectInput(input, approvalSignal);
      }
      approvalSignal.throwIfAborted(); this.require(scope);
      return await session.worker.input(input, approvalSignal);
    } finally { session.inputBusy = false; }
  }
  acknowledge(scope: DesktopTerminalScope, value: unknown) { this.require(scope).worker.acknowledge(value); }
  async resize(scope: DesktopTerminalScope, columns: number, rows: number) {
    const session = this.require(scope);
    await session.worker.resize({ sessionId: scope.sessionId, generation: scope.generation, connectionInstanceId: scope.connectionInstanceId }, columns, rows);
    this.require(scope);
  }
  async closeTerminal(scope: DesktopTerminalScope) {
    const session = this.require(scope);
    if (session.inputBusy) throw new Error('DESKTOP_TERMINAL_INPUT_BUSY');
    session.inputBusy = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([(async () => {
        await session.worker.closeTerminal();
        const outcome = await session.execution;
        if (!outcome?.receipt.executionStopped || outcome.receipt.state !== 'succeeded') throw new Error('DESKTOP_TERMINAL_STOP_UNCONFIRMED');
      })(), new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('DESKTOP_TERMINAL_STOP_UNCONFIRMED')), 3000); })]);
      this.closed = true; return { confirmed: true };
    } catch (error) { this.closed = true; this.blocked = true; void this.stop(); throw error; }
    finally { clearTimeout(timer); session.inputBusy = false; }
  }
  /** The caller retains the fixed-root executor lease until this returns confirmed and root terminal persistence settles. */
  async stop() {
    this.closed = true; this.pendingOpen?.abort();
    const session = this.session;
    if (!session) return { confirmed: !this.blocked };
    session.stopped = true; session.controller.abort();
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const confirmed = await Promise.race([(async () => {
        if (!(await session.worker.stop()).confirmed) return false;
        const outcome = await session.execution;
        return !outcome || outcome.receipt.executionStopped || await this.options.confirmRootStopped?.(session.intent) === true;
      })(), new Promise<false>(resolve => { timer = setTimeout(() => resolve(false), 3000); })]);
      this.blocked = !confirmed;
      // Keep the closed session identity. Reopening always requires a new broker/generation, never implicit reconnect.
      return { confirmed };
    } catch { this.blocked = true; return { confirmed: false }; }
    finally { clearTimeout(timer); }
  }
}
