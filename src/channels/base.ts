import { OutboundMessage, InboundMessage } from '../types/index.js';
import { MessageBus } from '../bus/index.js';

export abstract class BaseChannel {
  name: string = 'base';

  constructor(
    protected config: Record<string, unknown>,
    protected bus: MessageBus
  ) {}

  abstract start(): Promise<void>;
  abstract stop(): Promise<void>;
  abstract send(msg: OutboundMessage): Promise<void>;

  protected isAllowed(senderId: string): boolean {
    const allowList = (this.config.allowFrom as string[]) || [];
    
    // If no allow list, allow everyone
    if (allowList.length === 0) {
      return true;
    }

    const senderStr = String(senderId);
    if (allowList.includes(senderStr)) {
      return true;
    }
    
    // Check for pipe-separated values
    if (senderStr.includes('|')) {
      for (const part of senderStr.split('|')) {
        if (part && allowList.includes(part)) {
          return true;
        }
      }
    }
    
    return false;
  }

  protected async handleMessage(
    senderId: string,
    chatId: string,
    content: string,
    media?: string[],
    metadata?: Record<string, unknown>
  ): Promise<void> {
    if (!this.isAllowed(senderId)) {
      return;
    }

    const msg: InboundMessage = {
      channel: this.name,
      sender_id: String(senderId),
      chat_id: String(chatId),
      content,
      media: media || [],
      metadata: metadata || {},
    };

    await this.bus.publishInbound(msg);
  }

  protected running = false;

  get isRunning(): boolean {
    return this.running;
  }
}
