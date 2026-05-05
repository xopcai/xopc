/**
 * Durable outbound queue (crash recovery): JSON file under agent internal dir.
 */

import { existsSync, mkdirSync, readFileSync } from 'fs';
import { writeTextAtomicSync } from '../../infra/write-file-atomic.js';
import { join } from 'path';
import { randomUUID } from 'node:crypto';
import type { OutboundMessage } from '../transport-types.js';

export interface PendingOutbound {
  id: string;
  enqueuedAt: number;
  message: OutboundMessage;
}

export class OutboundPersistStore {
  private readonly filePath: string;
  private pending: PendingOutbound[] = [];

  constructor(agentDir: string) {
    mkdirSync(agentDir, { recursive: true });
    this.filePath = join(agentDir, 'outbound-pending.json');
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
    writeTextAtomicSync(this.filePath, JSON.stringify(this.pending));
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
