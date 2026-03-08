import { EventEmitter } from 'events';
import { InboundMessage, OutboundMessage } from '../types/index.js';

interface MessageBusEvents {
  inbound: (msg: InboundMessage) => void;
  outbound: (msg: OutboundMessage) => void;
}

/**
 * Error thrown when MessageBus is shut down
 */
class MessageBusShutdownError extends Error {
  constructor() {
    super('MessageBus has been shut down');
    this.name = 'MessageBusShutdownError';
  }
}

class MessageBus extends EventEmitter {
  private inboundQueue: InboundMessage[] = [];
  private outboundQueue: OutboundMessage[] = [];
  private inboundConsumers: ((msg: InboundMessage | Error) => void)[] = [];
  private outboundConsumers: ((msg: OutboundMessage | Error) => void)[] = [];
  private isShutdown = false;

  async publishInbound(msg: InboundMessage): Promise<void> {
    if (this.isShutdown) return; // Ignore if shut down

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
    if (this.isShutdown) return; // Ignore if shut down

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
    if (this.isShutdown) {
      throw new MessageBusShutdownError();
    }

    return new Promise((resolve, reject) => {
      if (this.inboundQueue.length > 0) {
        return resolve(this.inboundQueue.shift()!);
      }

      // Store both resolve and reject for shutdown handling
      const consumer = (msg: InboundMessage | Error) => {
        if (msg instanceof Error) {
          reject(msg);
        } else {
          resolve(msg);
        }
      };

      this.inboundConsumers.push(consumer);
    });
  }

  async consumeOutbound(): Promise<OutboundMessage> {
    if (this.isShutdown) {
      throw new MessageBusShutdownError();
    }

    return new Promise((resolve, reject) => {
      if (this.outboundQueue.length > 0) {
        return resolve(this.outboundQueue.shift()!);
      }

      // Store both resolve and reject for shutdown handling
      const consumer = (msg: OutboundMessage | Error) => {
        if (msg instanceof Error) {
          reject(msg);
        } else {
          resolve(msg);
        }
      };

      this.outboundConsumers.push(consumer);
    });
  }

  /**
   * Shutdown the message bus and cancel all pending consumers
   */
  shutdown(): void {
    if (this.isShutdown) return;

    this.isShutdown = true;

    // Reject all pending consumers
    const error = new MessageBusShutdownError();

    for (const consumer of this.inboundConsumers) {
      consumer(error);
    }
    for (const consumer of this.outboundConsumers) {
      consumer(error);
    }

    this.clear();
  }

  /**
   * Check if the bus has been shut down
   */
  getShutdownState(): boolean {
    return this.isShutdown;
  }

  /**
   * Reset the bus state (for testing only)
   */
  reset(): void {
    this.isShutdown = false;
    this.clear();
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
export { MessageBus, MessageBusShutdownError };
export type { MessageBusEvents };
