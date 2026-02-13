import { EventEmitter } from 'events';
import { InboundMessage, OutboundMessage } from '../types/index.js';

interface MessageBusEvents {
  inbound: (msg: InboundMessage) => void;
  outbound: (msg: OutboundMessage) => void;
}

class MessageBus extends EventEmitter {
  private inboundQueue: InboundMessage[] = [];
  private outboundQueue: OutboundMessage[] = [];
  private inboundConsumer: ((msg: InboundMessage) => void) | null = null;
  private outboundConsumer: ((msg: OutboundMessage) => void) | null = null;

  async publishInbound(msg: InboundMessage): Promise<void> {
    if (this.inboundConsumer) {
      const consumer = this.inboundConsumer;
      this.inboundConsumer = null;
      consumer(msg);
    } else {
      this.inboundQueue.push(msg);
    }
  }

  async publishOutbound(msg: OutboundMessage): Promise<void> {
    if (this.outboundConsumer) {
      const consumer = this.outboundConsumer;
      this.outboundConsumer = null;
      consumer(msg);
    } else {
      this.outboundQueue.push(msg);
    }
  }

  async consumeInbound(): Promise<InboundMessage> {
    return new Promise((resolve) => {
      if (this.inboundQueue.length > 0) {
        return resolve(this.inboundQueue.shift()!);
      }
      this.inboundConsumer = resolve;
    });
  }

  async consumeOutbound(): Promise<OutboundMessage> {
    return new Promise((resolve) => {
      if (this.outboundQueue.length > 0) {
        return resolve(this.outboundQueue.shift()!);
      }
      this.outboundConsumer = resolve;
    });
  }

  // For testing: drain all queues
  clear(): void {
    this.inboundQueue = [];
    this.outboundQueue = [];
    this.inboundConsumer = null;
    this.outboundConsumer = null;
  }
}

export const bus = new MessageBus();
export { MessageBus };
export type { MessageBusEvents };
