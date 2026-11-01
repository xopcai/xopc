import { randomUUID } from 'node:crypto';

import { DESKTOP_WORKSPACE_ACTIONS, desktopOperationStatusDescriptor, desktopWorkspaceDescriptor, type DesktopWorkspaceAction } from '@xopcai/endpoint-tools-protocol';

import { DesktopExecutionCatalog } from './execution-catalog.js';
import type { DesktopExecutionWorker } from './operation-supervisor.js';
import { DesktopWorkspaceHelper } from './workspace-helper.js';
import type { DesktopExecutionManager } from './execution-manager.js';

/** Main-owned, one grant lifetime. Neither paths nor a way to reopen the executor are accepted from the renderer or Agent. */
export class DesktopWorkspaceSession {
  readonly workspaceId = randomUUID();
  private closed = false;
  private activated = false;
  constructor(private readonly options: { helper: DesktopWorkspaceHelper; current(): boolean }) {}
  identity() { return this.options.helper.identity(); }
  catalog() { return new DesktopExecutionCatalog([...DESKTOP_WORKSPACE_ACTIONS.map(action => desktopWorkspaceDescriptor(action, this.workspaceId)), desktopOperationStatusDescriptor()]); }
  async activate(execution: DesktopExecutionManager, epoch: unknown, id: unknown): Promise<void> {
    if (this.activated || this.closed) throw new Error('WORKSPACE_ALREADY_ACTIVATED');
    this.activated = true;
    let accepted = false;
    try {
      if (!this.options.current()) throw new Error('WORKSPACE_AUTHORITY_INVALID');
      await execution.start(epoch, id, { workspaceId: this.workspaceId, catalog: this.catalog(), stopResources: () => this.stop() });
      // The coordinator owns the resources while its endpoint handshake is still connecting.
      accepted = true;
    } finally {
      if (!accepted && execution.snapshot()?.state !== 'stop-unconfirmed') await this.stop();
    }
  }
  worker(tool: string): DesktopExecutionWorker {
    const action = tool.replace(/^desktop\.workspace\./, '') as DesktopWorkspaceAction;
    if (!DESKTOP_WORKSPACE_ACTIONS.includes(action)) throw new Error('WORKSPACE_TOOL_DENIED');
    const worker = this.options.helper.worker(action);
    return {
      run: async (args, signal) => {
        if (this.closed || !this.options.current() || args.workspaceId !== this.workspaceId) throw new Error('WORKSPACE_AUTHORITY_INVALID');
        const { workspaceId: _workspaceId, ...request } = args;
        return worker.run(request, signal);
      },
      stop: () => this.stop(),
    };
  }
  async stop() { this.closed = true; return this.options.helper.stop(); }
}
