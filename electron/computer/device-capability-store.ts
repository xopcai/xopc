import { readFile } from 'node:fs/promises';

import { desktopCapabilitySnapshotSchema, type DesktopCapabilitySnapshot, type DesktopDeviceChatTool } from '@xopcai/endpoint-tools-protocol';

import { writeTextAtomic } from '../../src/infra/write-file-atomic.js';

export class DesktopCapabilityStore {
  private updates = Promise.resolve();

  constructor(private readonly path: string) {}

  async snapshot(): Promise<DesktopCapabilitySnapshot> {
    try { return desktopCapabilitySnapshotSchema.parse(JSON.parse(await readFile(this.path, 'utf8'))); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      return { revision: 0, allowed: [] };
    }
  }

  async allows(tool: string): Promise<boolean> {
    return (await this.snapshot()).allowed.some(name => name === tool);
  }

  update(change: (allowed: readonly DesktopDeviceChatTool[]) => DesktopDeviceChatTool[],
    publish: (snapshot: DesktopCapabilitySnapshot) => Promise<void>): Promise<DesktopCapabilitySnapshot> {
    const task = this.updates.then(async () => {
      const previous = await this.snapshot();
      const allowed = [...new Set(change(previous.allowed))].sort();
      const changed = allowed.length !== previous.allowed.length || allowed.some((name, index) => name !== previous.allowed[index]);
      const snapshot = changed ? { revision: previous.revision + 1, allowed } : previous;
      if (changed) await writeTextAtomic(this.path, JSON.stringify(snapshot), { mode: 0o600, ensureDirMode: 0o700 });
      await publish(snapshot);
      return snapshot;
    });
    this.updates = task.then(() => undefined, () => undefined);
    return task;
  }
}
