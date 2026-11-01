import { randomUUID } from 'node:crypto';

import { canonicalJson, type DesktopExecutionBinding, type DesktopOperationIntent, type DesktopTerminalBinding, type DesktopTerminalCommand,
  type DesktopTerminalEvent, type DesktopTerminalInput, type DesktopTerminalOutput, type ServerEndpointMessage } from '@xopcai/endpoint-tools-protocol';

import { DesktopTerminalBroker, type DesktopTerminalScope } from './terminal-broker.js';
import type { DesktopTerminalWorker } from './terminal-worker.js';
import type { DesktopExecutionSession } from './execution-session.js';
import type { DesktopOperationSupervisor } from './operation-supervisor.js';

type Request = Extract<ServerEndpointMessage, { type: 'tool.invoke' }>['payload'];
type Outcome = Awaited<ReturnType<DesktopOperationSupervisor['execute']>>;
type Root = { scope: DesktopTerminalScope; intent: DesktopOperationIntent; invocationId: string; broker: DesktopTerminalBroker;
  worker?: DesktopTerminalWorker; outcome?: Promise<Outcome>; opened: boolean; done: boolean; queued: DesktopTerminalOutput[] };

/** Dedicated signed terminal channel; ordinary tool receipts still own the root's durable outcome. */
export class DesktopTerminalHostController {
  private root?: Root;
  private closed = false;
  constructor(private readonly options: {
    binding: DesktopExecutionBinding; session: DesktopExecutionSession; current(): boolean;
    createWorker(intent: DesktopOperationIntent, binding: DesktopTerminalBinding, emit: (frame: DesktopTerminalOutput) => void): DesktopTerminalWorker;
    confirmInput(scope: DesktopTerminalScope, input: DesktopTerminalInput, signal: AbortSignal): Promise<boolean>;
    emit(invocationId: string, event: DesktopTerminalEvent): void;
    confirmRootStopped(intent: DesktopOperationIntent): Promise<boolean>;
  }) {}
  workerFor(intent?: DesktopOperationIntent) {
    if (!intent || !this.root?.worker || this.root.intent.operationId !== intent.operationId || canonicalJson(this.root.intent) !== canonicalJson(intent)) throw new Error('DESKTOP_TERMINAL_BINDING_INVALID');
    return this.root.worker;
  }
  async run(request: Request): Promise<Outcome> {
    const intent = request.execution;
    if (this.closed || !intent?.workspaceId || intent.tool !== 'desktop.terminal.open' || !this.options.current() || this.root && !this.root.done) throw new Error('DESKTOP_TERMINAL_BUSY');
    const scope: DesktopTerminalScope = { sessionId: intent.operationId, generation: randomUUID(), connectionInstanceId: this.options.binding.connectionInstanceId,
      gatewayId: intent.gatewayId, deviceId: intent.deviceId, workspaceId: intent.workspaceId, authorizationRevision: intent.authorizationRevision };
    if (intent.gatewayId !== this.options.binding.gatewayId || intent.deviceId !== this.options.binding.deviceId || intent.authorizationRevision !== this.options.binding.authorizationRevision) throw new Error('DESKTOP_TERMINAL_BINDING_INVALID');
    let root!: Root;
    const emit = (frame: DesktopTerminalOutput) => {
      if (root.opened) this.options.emit(root.invocationId, { ...frame, event: 'output' });
      else { if (root.queued.length >= 16) throw new Error('DESKTOP_TERMINAL_OUTPUT_LIMIT'); root.queued.push(frame); }
    };
    const broker = new DesktopTerminalBroker({ current: () => !this.closed && this.options.current(),
      // Session.invoke below owns native open consent and commits the root before worker.run.
      confirmOpen: async () => true, confirmInput: this.options.confirmInput, emit, confirmRootStopped: this.options.confirmRootStopped,
      create: (_scope, operation, output) => {
        root.worker = this.options.createWorker(operation, { sessionId: scope.sessionId, generation: scope.generation, connectionInstanceId: scope.connectionInstanceId }, output);
        return { worker: root.worker, supervisor: { execute: params => {
          const abort = () => { void this.options.session.cancel(request.invocationId); };
          root.outcome = this.options.session.invoke(request, { beforeStart: () => {
            if (this.closed || !this.options.current()) throw new Error('DESKTOP_EXECUTION_NOT_FOREGROUND');
          } });
          params.signal.addEventListener('abort', abort, { once: true }); if (params.signal.aborted) abort();
          void root.outcome.finally(() => params.signal.removeEventListener('abort', abort)).catch(() => {});
          return root.outcome;
        } } };
      } });
    root = { scope, intent, invocationId: request.invocationId, broker, opened: false, done: false, queued: [] }; this.root = root;
    try {
      const opened = await broker.open({ scope, intent, args: request.arguments, invocationId: request.invocationId, signal: new AbortController().signal });
      this.options.emit(request.invocationId, { ...scopeBinding(scope), event: 'opened', operationId: intent.operationId, state: 'running', executionStopped: false });
      root.opened = true;
      for (const frame of root.queued.splice(0)) this.options.emit(request.invocationId, { ...frame, event: 'output' });
      if (!root.outcome) throw new Error('DESKTOP_TERMINAL_ROOT_UNAVAILABLE');
      return await root.outcome;
    } catch (error) { await broker.stop(); throw error; }
    finally { root.done = true; }
  }
  async command(invocationId: string, command: DesktopTerminalCommand) {
    const root = this.root;
    if (this.closed || !root || root.done || invocationId !== root.invocationId || !this.options.current()
      || canonicalJson(scopeBinding(command)) !== canonicalJson(scopeBinding(root.scope))) throw new Error('DESKTOP_TERMINAL_BINDING_INVALID');
    const { action, ...payload } = command;
    if (action === 'input') {
      const result = await root.broker.input(root.scope, payload, AbortSignal.timeout(Math.max(1, Math.min(60000, root.intent.expiresAt - Date.now()))));
      this.options.emit(invocationId, { ...scopeBinding(root.scope), event: 'input-ack', ...result });
    } else if (action === 'ack') root.broker.acknowledge(root.scope, payload);
    else if (command.action === 'resize') {
      await root.broker.resize(root.scope, command.columns, command.rows);
      this.options.emit(invocationId, { ...scopeBinding(root.scope), event: 'resize-ack', requestId: command.requestId, columns: command.columns, rows: command.rows });
    } else if (!(await root.broker.closeTerminal(root.scope)).confirmed) throw new Error('DESKTOP_TERMINAL_STOP_UNCONFIRMED');
  }
  async close() { this.closed = true; return await this.root?.broker.stop() ?? { confirmed: true }; }
}
function scopeBinding(value: DesktopTerminalBinding): DesktopTerminalBinding {
  return { sessionId: value.sessionId, generation: value.generation, connectionInstanceId: value.connectionInstanceId };
}
