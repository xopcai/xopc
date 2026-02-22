/**
 * Channel Integration Tests
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { MessageBus, InboundMessage, OutboundMessage } from '../../../bus/index.js';

/**
 * 集成测试 - 验证消息能正确传递给 Agent 执行
 */
describe('Message Bus Integration', () => {
  let bus: MessageBus;

  beforeEach(() => {
    bus = new MessageBus();
  });

  afterEach(() => {
    bus.clear();
  });

  it('should publish inbound message', async () => {
    const inboundMessages: InboundMessage[] = [];
    bus.on('inbound', (msg) => {
      inboundMessages.push(msg);
    });

    const testMessage: InboundMessage = {
      channel: 'telegram',
      sender_id: '123456789',
      chat_id: '987654321',
      content: 'Hello bot!',
      media: [],
      metadata: {},
    };

    await bus.publishInbound(testMessage);

    expect(inboundMessages).toHaveLength(1);
    expect(inboundMessages[0].channel).toBe('telegram');
    expect(inboundMessages[0].sender_id).toBe('123456789');
    expect(inboundMessages[0].content).toBe('Hello bot!');
  });

  it('should consume inbound message via MessageBus', async () => {
    const testMessage: InboundMessage = {
      channel: 'telegram',
      sender_id: '123456789',
      chat_id: '987654321',
      content: 'Test message',
      media: [],
      metadata: {},
    };

    await bus.publishInbound(testMessage);

    const consumed = await bus.consumeInbound();

    expect(consumed).toEqual(testMessage);
  });

  it('should pass message from channel to AgentService', async () => {
    let receivedMessage: InboundMessage | null = null;

    const messagePromise = new Promise<InboundMessage>((resolve) => {
      bus.once('inbound', (msg) => {
        receivedMessage = msg;
        resolve(msg);
      });
    });

    const testMessage: InboundMessage = {
      channel: 'telegram',
      sender_id: '123456789',
      chat_id: '987654321',
      content: 'Process this message',
      media: [],
      metadata: { test: true },
    };

    await bus.publishInbound(testMessage);
    await messagePromise;

    expect(receivedMessage).not.toBeNull();
    expect(receivedMessage?.channel).toBe('telegram');
    expect(receivedMessage?.content).toBe('Process this message');
  });

  it('should handle multiple messages in sequence', async () => {
    const messages: string[] = [];

    bus.on('inbound', (msg) => {
      messages.push(msg.content);
    });

    for (let i = 0; i < 3; i++) {
      await bus.publishInbound({
        channel: 'telegram',
        sender_id: '123456789',
        chat_id: '987654321',
        content: `Message ${i + 1}`,
        media: [],
        metadata: {},
      });
    }

    expect(messages).toHaveLength(3);
    expect(messages).toEqual(['Message 1', 'Message 2', 'Message 3']);
  });

  it('should handle outbound messages', async () => {
    const outboundMessages: OutboundMessage[] = [];

    bus.on('outbound', (msg) => {
      outboundMessages.push(msg);
    });

    const reply: OutboundMessage = {
      channel: 'telegram',
      chat_id: '987654321',
      content: 'This is my reply',
    };

    await bus.publishOutbound(reply);

    expect(outboundMessages.length).toBeGreaterThanOrEqual(1);
    expect(outboundMessages[0].channel).toBe('telegram');
    expect(outboundMessages[0].chat_id).toBe('987654321');
    expect(outboundMessages[0].content).toBe('This is my reply');
  });

  it('should handle message with media attachments', async () => {
    const receivedMessages: InboundMessage[] = [];

    bus.on('inbound', (msg) => {
      receivedMessages.push(msg);
    });

    const messageWithMedia: InboundMessage = {
      channel: 'telegram',
      sender_id: '123456789',
      chat_id: '987654321',
      content: 'Check this photo',
      media: [
        { type: 'photo', fileId: 'file_id_1' },
        { type: 'photo', fileId: 'file_id_2' },
      ],
      metadata: { caption: 'Vacation photo' },
    };

    await bus.publishInbound(messageWithMedia);

    expect(receivedMessages).toHaveLength(1);
    expect(receivedMessages[0].media).toEqual([
      { type: 'photo', fileId: 'file_id_1' },
      { type: 'photo', fileId: 'file_id_2' },
    ]);
    expect(receivedMessages[0].metadata).toEqual({ caption: 'Vacation photo' });
  });
});

describe('MessageBus concurrency', () => {
  it('should handle concurrent message publishing and consuming', async () => {
    const bus = new MessageBus();

    const consumedMessages: InboundMessage[] = [];
    const consumeCount = 5;

    const consumers = Array(consumeCount).fill(null).map(async () => {
      const msg = await bus.consumeInbound();
      consumedMessages.push(msg);
    });

    for (let i = 0; i < consumeCount; i++) {
      await bus.publishInbound({
        channel: 'telegram',
        sender_id: `user${i}`,
        chat_id: 'chat123',
        content: `Message ${i}`,
        media: [],
        metadata: {},
      });
    }

    await Promise.all(consumers);

    expect(consumedMessages).toHaveLength(consumeCount);
  });
});
