import { BaseChannel } from './base.js';
import { OutboundMessage } from '../types/index.js';
import { MessageBus } from '../bus/index.js';
import { createLogger } from '../utils/logger.js';

const log = createLogger('WhatsAppChannel');

export class WhatsAppChannel extends BaseChannel {
  name = 'whatsapp';
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 5;
  private reconnectTimeout: ReturnType<typeof setTimeout> | null = null;

  constructor(config: Record<string, unknown>, bus: MessageBus) {
    super(config, bus);
  }

  async start(): Promise<void> {
    if (this.running) return;

    log.warn('WhatsApp channel requires @whiskeysockets/baileys setup');
    log.warn('Install: npm install @whiskeysockets/baileys');
    log.warn('See: https://github.com/WhiskeySockets/Baileys');
    
    this.running = true;
    log.info('WhatsApp channel initialized (placeholder)');
  }

  async stop(): Promise<void> {
    this.running = false;
    
    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout);
      this.reconnectTimeout = null;
    }

    log.info('WhatsApp channel stopped');
  }

  async send(msg: OutboundMessage): Promise<void> {
    log.info(`Would send to ${msg.chat_id}: ${msg.content.substring(0, 50)}...`);
  }
}
