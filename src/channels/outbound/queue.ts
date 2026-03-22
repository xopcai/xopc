/**
 * In-memory pre-send queue (best-effort ordering before delivery).
 */

export interface QueuedDelivery<T> {
  id: string;
  item: T;
  enqueuedAt: number;
}

let seq = 0;

export function createDeliveryQueue<T>() {
  const pending: QueuedDelivery<T>[] = [];

  return {
    enqueue(item: T): string {
      const id = `q:${Date.now()}:${++seq}`;
      pending.push({ id, item, enqueuedAt: Date.now() });
      return id;
    },
    dequeue(): QueuedDelivery<T> | undefined {
      return pending.shift();
    },
    size(): number {
      return pending.length;
    },
  };
}
