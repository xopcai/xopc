import type { ServerRealtimeMessage } from '@xopcai/realtime-protocol';
import type { WebSocket } from 'ws';

const SOFT_BUFFERED_BYTES = 512 * 1024;
const HARD_BUFFERED_BYTES = 4 * 1024 * 1024;
const MAX_QUEUED_BYTES = 2 * 1024 * 1024;

type QueueItem = { data: string; bytes: number };

export class RealtimeSocketWriter {
  private readonly critical: QueueItem[] = [];
  private readonly normal: QueueItem[] = [];
  private queuedBytes = 0;
  private sending = false;
  private closed = false;
  private retryTimer?: ReturnType<typeof setTimeout>;

  constructor(private readonly socket: WebSocket) {}

  enqueue(message: ServerRealtimeMessage, priority: 'critical' | 'normal' = 'normal'): boolean {
    if (this.closed || this.socket.readyState !== 1) return false;
    let data: string;
    try {
      data = JSON.stringify(message);
    } catch {
      this.socket.close(1011, 'Realtime message serialization failed');
      this.close();
      return false;
    }
    const item = { data, bytes: Buffer.byteLength(data) };
    if (item.bytes > MAX_QUEUED_BYTES) {
      this.socket.close(1009, 'Realtime event exceeds delivery limit');
      this.close();
      return false;
    }
    if (this.queuedBytes + item.bytes > MAX_QUEUED_BYTES) {
      this.socket.close(4413, 'Realtime client is too slow');
      this.close();
      return false;
    }
    this.queuedBytes += item.bytes;
    (priority === 'critical' ? this.critical : this.normal).push(item);
    this.flush();
    return true;
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.retryTimer = undefined;
    this.critical.length = 0;
    this.normal.length = 0;
    this.queuedBytes = 0;
  }

  private flush(): void {
    if (this.closed || this.sending || this.socket.readyState !== 1) return;
    if (this.socket.bufferedAmount > HARD_BUFFERED_BYTES) {
      this.socket.close(4413, 'Realtime client is too slow');
      this.close();
      return;
    }
    if (this.socket.bufferedAmount > SOFT_BUFFERED_BYTES) {
      if (!this.retryTimer) {
        this.retryTimer = setTimeout(() => {
          this.retryTimer = undefined;
          this.flush();
        }, 10);
      }
      return;
    }
    const item = this.critical.shift() ?? this.normal.shift();
    if (!item) return;
    this.sending = true;
    this.socket.send(item.data, (error) => {
      this.sending = false;
      this.queuedBytes -= item.bytes;
      if (error) {
        this.socket.close(1011, 'Realtime delivery failed');
        this.close();
        return;
      }
      this.flush();
    });
  }
}
