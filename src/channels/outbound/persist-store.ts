import { randomUUID } from 'node:crypto';
import { DurableQueue } from '../../storage/sqlite/durable-queue.js';
import type { OutboundMessage } from '../transport-types.js';

export interface PendingOutbound {
  id: string;
  enqueuedAt: number;
  message: OutboundMessage;
}

export class OutboundPersistStore {
  private readonly queue: DurableQueue<PendingOutbound>;
  constructor(scope: string) { this.queue = new DurableQueue('outbound', scope); }
  enqueue(message: OutboundMessage): string {
    const entry = { id: randomUUID(), enqueuedAt: Date.now(), message };
    this.queue.enqueue(entry.id, entry, entry.enqueuedAt);
    return entry.id;
  }
  ack(id: string): void { this.queue.delete(id); }
  peek(): readonly PendingOutbound[] { return this.queue.pending(); }
}
