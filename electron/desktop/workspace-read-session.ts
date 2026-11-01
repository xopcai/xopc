import type { EndpointToolContent } from '@xopcai/endpoint-tools-protocol';

import { DesktopExecutionCatalog } from './execution-catalog.js';
import type { DesktopExecutionWorker } from './operation-supervisor.js';

export type DesktopWorkspaceReadRequest = {
  invocationId: string; toolName: string; descriptorRevision: string; arguments: Record<string, unknown>; deadlineAt: number;
};
export type DesktopWorkspaceReadApproval = DesktopWorkspaceReadRequest & { gatewayId: string; deviceId: string; workspaceId: string };
type Run = { request: DesktopWorkspaceReadRequest; abort: AbortController; worker?: DesktopExecutionWorker; stop?: Promise<{ confirmed: boolean }> };

/** Personal reads require native per-call consent, but do not create a write intent or durable content ledger. */
export class DesktopWorkspaceReadSession {
  private active?: Run;
  private uncertain?: Run;
  private closed = false;
  constructor(private readonly options: {
    gatewayId: string; deviceId: string; workspaceId: string; expiresAt: number;
    catalog: DesktopExecutionCatalog; foreground(): boolean;
    confirm(request: DesktopWorkspaceReadApproval, signal: AbortSignal): Promise<boolean>;
    createWorker(tool: string): DesktopExecutionWorker;
    onExecutorStopped(): void;
  }) {}
  private valid(request: DesktopWorkspaceReadRequest): void {
    const reason = this.closed ? 'closed' : !['desktop.workspace.read', 'desktop.workspace.list'].includes(request.toolName) ? 'tool'
      : request.arguments.workspaceId !== this.options.workspaceId ? 'workspace'
      : this.options.catalog.revision(request.toolName) !== request.descriptorRevision ? 'revision'
      : !this.options.catalog.deadlineAllowed(request.toolName, request.deadlineAt) ? 'deadline'
      : request.deadlineAt > this.options.expiresAt ? 'grant-expiry' : !this.options.foreground() ? 'foreground' : undefined;
    if (reason) throw new Error('WORKSPACE_READ_AUTHORITY_INVALID', { cause: reason });
    this.options.catalog.validateArguments(request.toolName, request.arguments);
  }
  async invoke(input: DesktopWorkspaceReadRequest): Promise<{ content: EndpointToolContent[] }> {
    const request = structuredClone(input); this.valid(request);
    if (this.active || this.uncertain) throw new Error('WORKSPACE_READ_BUSY');
    const run: Run = { request, abort: new AbortController() }; this.active = run;
    const expiry = setTimeout(() => { void this.cancel(request.invocationId); }, Math.max(1, request.deadlineAt - Date.now()));
    let revoked: ReturnType<typeof setInterval> | undefined;
    const aborted = new Promise<never>((_resolve, reject) => run.abort.signal.addEventListener('abort', () => reject(new Error('WORKSPACE_READ_CANCELLED')), { once: true }));
    try {
      const consent = this.options.confirm({ ...structuredClone(request), gatewayId: this.options.gatewayId, deviceId: this.options.deviceId, workspaceId: this.options.workspaceId }, run.abort.signal);
      if (!await Promise.race([consent, aborted])) throw new Error('WORKSPACE_READ_USER_DENIED');
      run.abort.signal.throwIfAborted(); this.valid(request);
      run.worker = this.options.createWorker(request.toolName);
      // Native sheets may temporarily own focus. Recheck after approval, then supervise foreground while reading.
      revoked = setInterval(() => { try { this.valid(request); } catch { void this.cancel(request.invocationId); } }, 250);
      const result = await Promise.race([run.worker.run(structuredClone(request.arguments), run.abort.signal), aborted]);
      run.abort.signal.throwIfAborted(); this.valid(request);
      const parsed = this.options.catalog.validateResult(result.result, request.toolName) as { content: EndpointToolContent[] };
      if (result.status !== 'succeeded') throw new Error('WORKSPACE_READ_FAILED');
      return parsed;
    } finally {
      clearTimeout(expiry); clearInterval(revoked);
      if (this.active === run) this.active = undefined;
    }
  }
  private async stopRun(run: Run): Promise<{ confirmed: boolean }> {
    run.abort.abort();
    if (!run.worker) return { confirmed: true };
    this.uncertain = run;
    run.stop ??= Promise.resolve().then(() => run.worker!.stop()).catch(() => ({ confirmed: false })).then(result => {
      if (!result.confirmed) run.stop = undefined;
      return result;
    });
    let timeout: ReturnType<typeof setTimeout> | undefined;
    try {
      const result = await Promise.race([run.stop, new Promise<{ confirmed: boolean }>(resolve => { timeout = setTimeout(() => resolve({ confirmed: false }), 3000); })]);
      if (result.confirmed && this.uncertain === run) this.uncertain = undefined;
      return result;
    } finally { clearTimeout(timeout); }
  }
  async cancel(invocationId: string): Promise<void> {
    const run = this.active;
    if (!run || run.request.invocationId !== invocationId) return;
    if (run.worker) this.closed = true;
    await this.stopRun(run);
    if (run.worker) this.options.onExecutorStopped();
  }
  async close(): Promise<{ state: 'stopped' | 'unknown' }> {
    this.closed = true;
    const run = this.active ?? this.uncertain;
    if (!run) return { state: 'stopped' };
    return { state: (await this.stopRun(run)).confirmed ? 'stopped' : 'unknown' };
  }
}
