import type { ServerRealtimeMessage } from '@xopcai/realtime-protocol';
import type { WebSocket } from 'ws';

import { createLogger } from '../utils/logger.js';

const log = createLogger('RealtimeSocketWriter');
const SOFT_BUFFERED_BYTES = 512 * 1024;
const MAX_EVENT_BYTES = 2 * 1024 * 1024;
const MAX_QUEUED_BYTES = 16 * 1024 * 1024;
const DELIVERY_STALL_MS = 15_000;

type QueueItem = { data: string; bytes: number };
type ReplayItem = { iterator: Iterator<ServerRealtimeMessage> };

export class RealtimeSocketWriter {
  private readonly critical: QueueItem[] = [];
  private readonly normal: Array<QueueItem | ReplayItem> = [];
  private queuedBytes = 0;
  private sending = false;
  private closed = false;
  private retryTimer?: ReturnType<typeof setTimeout>;
  private stallTimer?: ReturnType<typeof setTimeout>;

  constructor(private readonly socket: WebSocket) {}

  enqueue(message: ServerRealtimeMessage, priority: 'critical' | 'normal' = 'normal'): boolean {
    if (this.closed || this.socket.readyState !== 1) return false;
    const item = this.serialize(message);
    if (!item) return false;
    if (this.queuedBytes + item.bytes > MAX_QUEUED_BYTES) {
      this.fail(4413, 'Realtime delivery queue limit exceeded', {
        eventBytes: item.bytes,
        ...(message.kind === 'realtime.event' ? { topic: message.payload.topic, event: message.payload.event } : {}),
      });
      return false;
    }
    this.queuedBytes += item.bytes;
    (priority === 'critical' ? this.critical : this.normal).push(item);
    this.flush();
    return !this.closed;
  }

  /** Serialize replay only as the socket drains; live messages stay behind the replay. */
  enqueueReplay(messages: Iterable<ServerRealtimeMessage>): () => void {
    if (this.closed || this.socket.readyState !== 1) return () => {};
    const item: ReplayItem = { iterator: messages[Symbol.iterator]() };
    this.normal.push(item);
    this.flush();
    return () => {
      const index = this.normal.indexOf(item);
      if (index >= 0) this.normal.splice(index, 1);
      item.iterator.return?.();
    };
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    if (this.retryTimer) clearTimeout(this.retryTimer);
    if (this.stallTimer) clearTimeout(this.stallTimer);
    this.retryTimer = undefined;
    this.stallTimer = undefined;
    for (const item of this.normal) if ('iterator' in item) item.iterator.return?.();
    this.critical.length = 0;
    this.normal.length = 0;
    this.queuedBytes = 0;
  }

  private fail(code: number, reason: string, fields: Record<string, unknown> = {}): void {
    log.warn({ ...fields, code, queuedBytes: this.queuedBytes, bufferedBytes: this.socket.bufferedAmount,
      pendingItems: this.normal.length + this.critical.length }, reason);
    this.close();
    this.socket.close(code, reason);
  }

  private serialize(message: ServerRealtimeMessage): QueueItem | undefined {
    let data: string;
    try {
      data = JSON.stringify(message);
    } catch {
      this.fail(1011, 'Realtime message serialization failed');
      return;
    }
    const bytes = Buffer.byteLength(data);
    if (bytes > MAX_EVENT_BYTES) {
      this.fail(1009, 'Realtime event exceeds delivery limit', { eventBytes: bytes,
        ...(message.kind === 'realtime.event' ? { topic: message.payload.topic, event: message.payload.event } : {}) });
      return;
    }
    return { data, bytes };
  }

  private watchForStall(): void {
    if (!this.stallTimer) {
      this.stallTimer = setTimeout(() => this.fail(4413, 'Realtime delivery stalled'), DELIVERY_STALL_MS);
    }
  }

  private next(): QueueItem | undefined {
    const critical = this.critical.shift();
    if (critical) return critical;
    while (this.normal.length) {
      const head = this.normal[0];
      if (!('iterator' in head)) return this.normal.shift() as QueueItem;
      const next = head.iterator.next();
      if (next.done) {
        this.normal.shift();
        continue;
      }
      const item = this.serialize(next.value);
      if (item) this.queuedBytes += item.bytes;
      return item;
    }
  }

  private flush(): void {
    if (this.closed || this.sending || this.socket.readyState !== 1) return;
    if (this.socket.bufferedAmount > MAX_QUEUED_BYTES) {
      this.fail(4413, 'Realtime socket buffer limit exceeded');
      return;
    }
    if (this.socket.bufferedAmount > SOFT_BUFFERED_BYTES) {
      this.watchForStall();
      if (!this.retryTimer) {
        this.retryTimer = setTimeout(() => {
          this.retryTimer = undefined;
          this.flush();
        }, 10);
      }
      return;
    }
    const item = this.next();
    if (!item) return;
    this.sending = true;
    this.watchForStall();
    try {
      this.socket.send(item.data, (error) => {
        if (this.closed) return;
        this.sending = false;
        this.queuedBytes -= item.bytes;
        if (this.stallTimer) clearTimeout(this.stallTimer);
        this.stallTimer = undefined;
        if (error) {
          this.fail(1011, 'Realtime delivery failed');
          return;
        }
        this.flush();
      });
    } catch {
      this.sending = false;
      this.fail(1011, 'Realtime delivery failed');
    }
  }
}
