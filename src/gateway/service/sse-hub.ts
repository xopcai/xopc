import { createLogger } from '../../utils/logger.js';

import type { ServiceEvent } from './types.js';

const log = createLogger('Gateway:Service');

const EVENT_BUFFER_SIZE = 200;

export type GatewaySseListener = (event: ServiceEvent) => Promise<void> | void;

export class GatewaySseHub {
  private eventCounter = 0;
  private subscribers = new Map<string, GatewaySseListener>();
  private eventBuffers = new Map<string, ServiceEvent[]>();

  subscribe(sessionId: string, listener: GatewaySseListener): () => void {
    this.subscribers.set(sessionId, listener);
    if (!this.eventBuffers.has(sessionId)) {
      this.eventBuffers.set(sessionId, []);
    }
    log.debug({ sessionId }, 'Event subscriber added');

    return () => {
      this.subscribers.delete(sessionId);
      setTimeout(() => {
        if (!this.subscribers.has(sessionId)) {
          this.eventBuffers.delete(sessionId);
        }
      }, 5 * 60_000);
      log.debug({ sessionId }, 'Event subscriber removed');
    };
  }

  emit(type: string, payload: unknown): void {
    const id = String(++this.eventCounter);
    const event: ServiceEvent = { id, type, payload };

    for (const [sessionId, listener] of this.subscribers) {
      const buf = this.eventBuffers.get(sessionId) || [];
      buf.push(event);
      if (buf.length > EVENT_BUFFER_SIZE) buf.shift();
      this.eventBuffers.set(sessionId, buf);

      try {
        listener(event);
      } catch (err) {
        log.warn({ sessionId, err }, 'Failed to deliver event to subscriber');
      }
    }
  }

  getEventsSince(sessionId: string, lastEventId: string): ServiceEvent[] {
    const buf = this.eventBuffers.get(sessionId);
    if (!buf) return [];

    const idx = buf.findIndex((e) => e.id === lastEventId);
    if (idx === -1) return buf;
    return buf.slice(idx + 1);
  }
}
