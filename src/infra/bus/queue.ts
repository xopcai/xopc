import { EventEmitter } from 'events';
import { persistInboundAttachments } from '../../channels/attachments/inbound-persist.js';
import { ChannelMessageJournal } from '../../channels/message-journal.js';
import { createLogger } from '../../utils/logger.js';
import type { InboundMessage, OutboundMessage } from '../../channels/transport-types.js';

const log = createLogger('ChannelInbox');

export type InboundDelivery = { scope: string; id: string };
type InboundJournal = ChannelMessageJournal<InboundMessage, never>;

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
  private readonly durableInboundJournals = new Map<string, InboundJournal>();
  private readonly inboundReceipts = new WeakMap<InboundMessage, InboundDelivery & { journal: InboundJournal }>();
  private persistOutboundReply?: (msg: OutboundMessage, delivery: InboundDelivery) => boolean;

  async publishInbound(msg: InboundMessage, delivery?: InboundDelivery, verify?: (msg: InboundMessage) => void): Promise<void> {
    if (!delivery) {
      if (!this.isShutdown) this.enqueueInbound(msg);
      return;
    }

    const journal = this.durableInboundJournal(msg.channel, delivery.scope);
    const attachments = await persistInboundAttachments(msg.attachments);
    const payload: InboundMessage = attachments ? { ...msg, attachments } : msg;
    if (!journal.accept([{ id: delivery.id, payload }]).length) return;
    verify?.(payload);
    this.inboundReceipts.set(payload, { journal, ...delivery });
    if (!this.isShutdown) this.enqueueInbound(payload);
  }

  restoreDurableInbound(channel: string, scope: string, verify?: (msg: InboundMessage, acceptedAt: number) => void): void {
    const key = JSON.stringify([channel, scope]);
    if (this.durableInboundJournals.has(key)) return;
    const journal = this.durableInboundJournal(channel, scope);
    const interrupted = journal.recoverInterrupted();
    if (interrupted) log.warn({ channel, interrupted }, 'Channel inputs interrupted during execution');
    for (const { id, payload, enqueuedAt } of journal.pending(500)) {
      verify?.(payload, enqueuedAt);
      this.inboundReceipts.set(payload, { journal, id, scope });
      if (!this.isShutdown) this.enqueueInbound(payload);
    }
  }

  beginInboundProcessing(msg: InboundMessage): boolean {
    const receipt = this.inboundReceipts.get(msg);
    return !receipt || receipt.journal.begin(receipt.id);
  }

  finishInboundProcessing(msg: InboundMessage, completed: boolean): void {
    const receipt = this.inboundReceipts.get(msg);
    receipt?.journal.finish(receipt.id, completed ? 'completed' : 'interrupted');
  }

  private durableInboundJournal(channel: string, scope: string): InboundJournal {
    const key = JSON.stringify([channel, scope]);
    const existing = this.durableInboundJournals.get(key);
    if (existing) return existing;
    const journal = new ChannelMessageJournal<InboundMessage, never>(`${channel}:agent`, scope);
    this.durableInboundJournals.set(key, journal);
    return journal;
  }

  private enqueueInbound(msg: InboundMessage): void {
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

  setOutboundReplyPersistence(persist: (msg: OutboundMessage, delivery: InboundDelivery) => boolean): void {
    this.persistOutboundReply = persist;
  }

  async publishOutbound(msg: OutboundMessage, replyingTo?: InboundMessage): Promise<void> {
    const receipt = replyingTo && this.inboundReceipts.get(replyingTo);
    if (receipt && this.persistOutboundReply && !this.persistOutboundReply(msg, receipt)) return;
    if (this.isShutdown) return;

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
    this.durableInboundJournals.clear();
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
