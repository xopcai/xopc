import { createHash } from 'node:crypto';

import { canonicalJson, type DesktopOperationIntent } from '@xopcai/endpoint-tools-protocol';
import { z } from 'zod';

import { DesktopContainerEngine } from './container-engine.js';
import { DesktopContainerResources } from './container-resources.js';
import type { DesktopExecutionWorker } from './operation-supervisor.js';

/** One intent, one container. The owned volume may retain effects; container removal never resolves those effects. */
export class DesktopContainerWorker implements DesktopExecutionWorker {
  private started = false;
  private cancelled = false;
  private id?: string;
  private creating?: Promise<void>;
  private preparing?: Promise<void>;
  private prepared = false;
  private stopping?: Promise<{ confirmed: boolean }>;
  constructor(private readonly options: {
    engine: DesktopContainerEngine; resources: DesktopContainerResources; intent: DesktopOperationIntent;
    ownerId: string; workspaceId: string; imageId: string;
  }) {}
  private ownership() { return { ownerId: this.options.ownerId, workspaceId: this.options.workspaceId, operationId: this.options.intent.operationId }; }
  async run(input: Record<string, unknown>, signal: AbortSignal) {
    if (this.started || this.cancelled) throw new Error('DESKTOP_CONTAINER_ALREADY_STARTED');
    this.started = true; signal.throwIfAborted();
    const args = z.strictObject({ workspaceId: z.uuid(), argv: z.array(z.string()).min(1).max(128) }).parse(input);
    if (args.workspaceId !== this.options.workspaceId || this.options.intent.workspaceId !== args.workspaceId
      || this.options.intent.argumentHash !== createHash('sha256').update(canonicalJson(args)).digest('hex')) throw new Error('DESKTOP_CONTAINER_ARGUMENT_MISMATCH');
    try {
      this.preparing = this.options.resources.prepare(this.options.intent, { ownerId: this.options.ownerId, workspaceId: this.options.workspaceId,
        socketPath: this.options.engine.socketPath, engineId: this.options.engine.engineId, imageId: this.options.imageId, argv: args.argv });
      await this.preparing; this.prepared = true; signal.throwIfAborted();
      if (this.cancelled) throw new Error('DESKTOP_CONTAINER_CANCELLED');
      this.creating = (async () => {
        this.id = await this.options.engine.create({ ...this.ownership(), imageId: this.options.imageId, argv: args.argv });
        // start is forbidden until this CID has a durable directory entry.
        await this.options.resources.created(this.options.intent, this.id);
      })();
      await this.creating; signal.throwIfAborted();
      if (this.cancelled) throw new Error('DESKTOP_CONTAINER_CANCELLED');
      await this.options.engine.start(this.id!, this.ownership());
      const exitCode = await this.options.engine.wait(this.id!, this.ownership(), signal);
      const output = await this.options.engine.output(this.id!, this.ownership());
      if (!(await this.stop()).confirmed) throw new Error('DESKTOP_CONTAINER_STOP_UNCONFIRMED');
      return { status: 'succeeded' as const, result: { content: [{ type: 'json' as const, value: { exitCode, ...output } }] } };
    } catch (error) { await this.stop(); throw error; }
  }
  stop(): Promise<{ confirmed: boolean }> {
    if (this.stopping) return this.stopping;
    this.cancelled = true;
    this.stopping = (async () => {
      try {
        await this.preparing?.catch(() => {}); await this.creating?.catch(() => {});
        if (this.id && !(await this.options.engine.remove(this.id, this.ownership())).confirmed) return { confirmed: false };
        // A failed create without a CID can only leave an unstarted container. No start was sent.
        if (this.prepared) await this.options.resources.stopped(this.options.intent);
        return { confirmed: true };
      } catch { return { confirmed: false }; }
    })().then(result => { if (!result.confirmed) this.stopping = undefined; return result; });
    return this.stopping;
  }
}

/** Fixed-root lease must also be held by the caller. This verifies resource stop, never the command's filesystem outcome. */
export async function stopRecordedContainer(resources: DesktopContainerResources, intent: DesktopOperationIntent): Promise<boolean> {
  const record = await resources.load(intent);
  const engine = await DesktopContainerEngine.connect(record.socketPath, record.engineId);
  if (record.containerId && !(await engine.remove(record.containerId, { ownerId: record.ownerId, workspaceId: record.workspaceId, operationId: intent.operationId })).confirmed) return false;
  await resources.stopped(intent); return true;
}
