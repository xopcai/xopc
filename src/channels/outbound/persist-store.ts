/**
 * Durable outbound queue (crash recovery): JSON file under agent internal dir.
 */

import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'fs';
import { join } from 'path';
import { randomUUID } from 'node:crypto';
import type { OutboundMessage } from '../transport-types.js';
import { migrateFileIfMissing } from '../../config/migrate-internal-state.js';

export interface PendingOutbound {
  id: string;
  enqueuedAt: number;
  message: OutboundMessage;
}

export class OutboundPersistStore {
  private readonly filePath: string;
  private pending: PendingOutbound[] = [];

  constructor(
    agentDir: string,
    options?: {
      /** When set, copy `outbound-pending.json` from legacy workspace `.xopcbot/` once. */
      migrateFromWorkspace?: string;
    },
  ) {
    mkdirSync(agentDir, { recursive: true });
    this.filePath = join(agentDir, 'outbound-pending.json');
    if (options?.migrateFromWorkspace) {
      const legacy = join(options.migrateFromWorkspace, '.xopcbot', 'outbound-pending.json');
      migrateFileIfMissing(this.filePath, legacy);
    }
    this.load();
  }

  private load(): void {
    if (!existsSync(this.filePath)) return;
    try {
      const raw = readFileSync(this.filePath, 'utf-8');
      const data = JSON.parse(raw) as PendingOutbound[];
      if (Array.isArray(data)) {
        this.pending = data;
      }
    } catch {
      this.pending = [];
    }
  }

  private flush(): void {
    const tmp = `${this.filePath}.tmp`;
    writeFileSync(tmp, JSON.stringify(this.pending), 'utf-8');
    renameSync(tmp, this.filePath);
  }

  enqueue(message: OutboundMessage): string {
    const id = randomUUID();
    this.pending.push({ id, enqueuedAt: Date.now(), message });
    this.flush();
    return id;
  }

  ack(id: string): void {
    const i = this.pending.findIndex((p) => p.id === id);
    if (i >= 0) {
      this.pending.splice(i, 1);
      this.flush();
    }
  }

  peek(): readonly PendingOutbound[] {
    return this.pending;
  }
}
