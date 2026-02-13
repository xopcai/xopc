import { EventEmitter } from 'events';
import { InboundMessage, OutboundMessage } from '../types/index.js';

interface MessageBusEvents {
  inbound: (msg: InboundMessage) => void;
  outbound: (msg: OutboundMessage) => void;
}

class MessageBus extends EventEmitter {
  private inboundQueue: InboundMessage[] = [];
  private outboundQueue: OutboundMessage[] = [];
  private inboundConsumers: ((msg: InboundMessage) => void)[] = [];
  private outboundConsumers: ((msg: OutboundMessage) => void)[] = [];

  async publishInbound(msg: InboundMessage): Promise<void> {
    // Emit event for listeners
    this.emit('inbound', msg);

    // Handle waiting consumers
    if (this.inboundConsumers.length > 0) {
      const consumer = this.inboundConsumers.shift()!;
      consumer(msg);
    } else {
      this.inboundQueue.push(msg);
    }
  }

  async publishOutbound(msg: OutboundMessage): Promise<void> {
    // Emit event for listeners
    this.emit('outbound', msg);

    // Handle waiting consumers
    if (this.outboundConsumers.length > 0) {
      const consumer = this.outboundConsumers.shift()!;
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
      this.inboundConsumers.push(resolve);
    });
  }

  async consumeOutbound(): Promise<OutboundMessage> {
    return new Promise((resolve) => {
      if (this.outboundQueue.length > 0) {
        return resolve(this.outboundQueue.shift()!);
      }
      this.outboundConsumers.push(resolve);
    });
  }

  // For testing: drain all queues
  clear(): void {
    this.inboundQueue = [];
    this.outboundQueue = [];
    this.inboundConsumers = [];
    this.outboundConsumers = [];
  }
}

export const bus = new MessageBus();
export { MessageBus };
export type { MessageBusEvents };
