import { randomUUID } from 'node:crypto';
import { z } from 'zod';

import { desktopCommandDescriptor, desktopOperationStatusDescriptor, type DesktopOperationIntent } from '@xopcai/endpoint-tools-protocol';

import { DesktopContainerEngine } from './container-engine.js';
import { DesktopContainerResources } from './container-resources.js';
import { DesktopContainerWorker } from './container-worker.js';
import { DesktopExecutionCatalog } from './execution-catalog.js';
import type { DesktopExecutionManager } from './execution-manager.js';
import type { DesktopExecutionWorker } from './operation-supervisor.js';

/** One explicitly authorized isolated volume. No host filesystem is mounted and no closed session is reopened. */
export class DesktopContainerSession {
  readonly workspaceId: string;
  readonly ownerId: string;
  private closed = false;
  private activated = false;
  private workspaceReady = false;
  private readonly workers = new Set<DesktopContainerWorker>();
  constructor(readonly engine: DesktopContainerEngine, readonly imageId: string, private readonly resources: DesktopContainerResources, private readonly current: () => boolean,
    private readonly retained?: { workspaceId: string; ownerId: string; existing: boolean; persist?(): Promise<void> }) {
    this.workspaceId = retained ? z.uuid().parse(retained.workspaceId) : randomUUID(); this.ownerId = retained ? z.uuid().parse(retained.ownerId) : randomUUID();
  }
  catalog() { return new DesktopExecutionCatalog([desktopCommandDescriptor(this.workspaceId, this.imageId), desktopOperationStatusDescriptor()]); }
  retainedData() { return this.retained?.existing === true; }
  /** Called only after native grant consent. Creating an empty owned volume does not start a command. */
  async authorizeWorkspace(signal: AbortSignal) {
    signal.throwIfAborted(); if (this.closed || !this.current()) throw new Error('DESKTOP_CONTAINER_AUTHORITY_INVALID');
    await this.retained?.persist?.();
    signal.throwIfAborted(); if (this.closed || !this.current()) throw new Error('DESKTOP_CONTAINER_AUTHORITY_INVALID');
    if (this.retained?.existing) await this.engine.checkWorkspace(this.ownerId, this.workspaceId);
    else await this.engine.ensureWorkspace(this.ownerId, this.workspaceId);
    signal.throwIfAborted(); if (this.closed || !this.current()) throw new Error('DESKTOP_CONTAINER_AUTHORITY_INVALID');
    this.workspaceReady = true;
  }
  async activate(execution: DesktopExecutionManager, epoch: unknown, id: unknown) {
    if (this.closed || this.activated || !this.current()) throw new Error('DESKTOP_CONTAINER_AUTHORITY_INVALID');
    this.activated = true;
    try { await execution.start(epoch, id, { workspaceId: this.workspaceId, kind: 'container', catalog: this.catalog(), stopResources: () => this.stop() }); }
    catch (error) { if (execution.snapshot()?.state !== 'stop-unconfirmed') await this.stop(); throw error; }
  }
  worker(intent: DesktopOperationIntent): DesktopExecutionWorker {
    if (this.closed || !this.workspaceReady || !this.current() || intent.tool !== 'desktop.command.run' || intent.workspaceId !== this.workspaceId) throw new Error('DESKTOP_CONTAINER_AUTHORITY_INVALID');
    const worker = new DesktopContainerWorker({ engine: this.engine, resources: this.resources, intent: structuredClone(intent), ownerId: this.ownerId, workspaceId: this.workspaceId, imageId: this.imageId });
    this.workers.add(worker);
    return {
      run: async (args, signal) => {
        if (this.closed || !this.current()) throw new Error('DESKTOP_CONTAINER_AUTHORITY_INVALID');
        try { return await worker.run(args, signal); }
        finally { if ((await worker.stop()).confirmed) this.workers.delete(worker); }
      },
      stop: async () => { const result = await worker.stop(); if (result.confirmed) this.workers.delete(worker); return result; },
    };
  }
  async stop() {
    this.closed = true;
    const outcomes = await Promise.all([...this.workers].map(async worker => { const outcome = await worker.stop(); if (outcome.confirmed) this.workers.delete(worker); return outcome; }));
    return { confirmed: outcomes.every(outcome => outcome.confirmed) };
  }
}
