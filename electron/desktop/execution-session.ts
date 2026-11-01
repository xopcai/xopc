import { desktopExecutionBindingSchema, desktopExecutionRequestSchema,
  type DesktopExecutionBinding, type DesktopExecutionRequest } from '@xopcai/endpoint-tools-protocol';

import { DesktopOperationSupervisor } from './operation-supervisor.js';

type ExecutionOutcome = Awaited<ReturnType<DesktopOperationSupervisor['execute']>>;
type Pending = { request: DesktopExecutionRequest; controller: AbortController; outcome: Promise<ExecutionOutcome> };

/** An explicitly authorized connection adapter; it does not register tools or grant capabilities. */
export class DesktopExecutionSession {
  private readonly binding: DesktopExecutionBinding;
  private pending?: Pending;
  private closed = false;
  constructor(private readonly options: {
    binding: DesktopExecutionBinding;
    supervisor: DesktopOperationSupervisor;
    confirm(request: DesktopExecutionRequest, signal: AbortSignal): Promise<boolean>;
  }) {
    this.binding = desktopExecutionBindingSchema.parse(options.binding);
  }
  invoke(input: unknown): Promise<ExecutionOutcome> {
    if (this.closed) return Promise.reject(new Error('DESKTOP_EXECUTION_SESSION_CLOSED'));
    let request: DesktopExecutionRequest;
    try {
      // Clone before native approval; caller changes cannot change the approved intent.
      const json = JSON.stringify(input);
      if (Buffer.byteLength(json) > 70 * 1024) throw new Error('DESKTOP_EXECUTION_REQUEST_LIMIT');
      request = desktopExecutionRequestSchema.parse(JSON.parse(json));
      if (request.execution.gatewayId !== this.binding.gatewayId || request.execution.deviceId !== this.binding.deviceId
        || request.execution.authorizationRevision !== this.binding.authorizationRevision) throw new Error('DESKTOP_EXECUTION_BINDING_MISMATCH');
      if (Date.now() >= request.deadlineAt) throw new Error('DESKTOP_OPERATION_EXPIRED');
      // A receipt query never starts a worker or renews an expired execution intent.
      const receipt = this.options.supervisor.inspect(request.execution);
      if (receipt) return Promise.resolve({ receipt, repeated: true });
      if (this.pending) throw new Error('DESKTOP_EXECUTION_BUSY');
    } catch (error) { return Promise.reject(error); }
    const controller = new AbortController();
    const outcome = Promise.resolve().then(() => this.run(request, controller));
    const pending = { request, controller, outcome };
    this.pending = pending;
    // Both handlers are installed immediately, including when callers abandon a disconnected request.
    void outcome.then(() => { if (this.pending === pending) this.pending = undefined; },
      () => { if (this.pending === pending) this.pending = undefined; });
    return outcome;
  }
  private async run(request: DesktopExecutionRequest, controller: AbortController): Promise<ExecutionOutcome> {
    let deadline: ReturnType<typeof setTimeout> | undefined;
    try {
      controller.signal.throwIfAborted();
      deadline = setTimeout(() => controller.abort(), Math.min(300000, Math.max(1, request.deadlineAt - Date.now())));
      // Approval cancellation must not depend on a native dialog resolving its promise.
      const aborted = new Promise<never>((_, reject) => controller.signal.addEventListener('abort', () => {
        reject(new Error('DESKTOP_EXECUTION_CANCELLED_BEFORE_START'));
      }, { once: true }));
      const allowed = await Promise.race([this.options.confirm(structuredClone(request), controller.signal), aborted]);
      controller.signal.throwIfAborted();
      if (!allowed) throw new Error('DESKTOP_EXECUTION_USER_DENIED');
      if (this.closed) throw new Error('DESKTOP_EXECUTION_SESSION_CLOSED');
      return await this.options.supervisor.execute({ intent: request.execution, arguments: request.arguments,
        invocationId: request.invocationId, connectionInstanceId: this.binding.connectionInstanceId, signal: controller.signal });
    } finally { clearTimeout(deadline); }
  }
  async cancel(invocationId: string): Promise<ExecutionOutcome | undefined> {
    const pending = this.pending;
    if (!pending || pending.request.invocationId !== invocationId) return;
    pending.controller.abort();
    // The result resolves only after the supervisor has persisted confirmed stop or unknown.
    return pending.outcome;
  }
  async close(): Promise<Awaited<ReturnType<DesktopOperationSupervisor['stop']>>> {
    this.closed = true;
    const pending = this.pending;
    pending?.controller.abort();
    try { return await this.options.supervisor.stop(); }
    finally {
      // The owner may close its journal after this returns; wait for terminal persistence too.
      await pending?.outcome.catch(() => {});
    }
  }
}
