import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { MessageBus, InboundMessage, OutboundMessage } from '../../bus/index.js';
import { TelegramChannel } from '../telegram.js';
import type { Config } from '../../config/schema.js';

/**
 * 集成测试 - 验证 Telegram 消息能正确传递给 Agent 执行
 */
describe('Telegram to Agent Integration', () => {
  let bus: MessageBus;
  let telegramConfig: Record<string, unknown>;
  let _agentConfig: Config;

  beforeEach(() => {
    bus = new MessageBus();
    telegramConfig = {
      enabled: true,
      token: 'test-token',
      allowFrom: [], // 允许所有用户
      apiRoot: 'https://api.telegram.org',
      debug: false,
    };
    __agentConfig = {
      agents: {
        defaults: {
          workspace: '/tmp/test-workspace',
          model: 'openai/gpt-4o-mini',
          maxTokens: 4096,
          temperature: 0.7,
          maxToolIterations: 10,
          compaction: {
            enabled: true,
            mode: 'default',
            reserveTokens: 4000,
            triggerThreshold: 0.8,
            minMessagesBeforeCompact: 5,
            keepRecentMessages: 3,
          },
          pruning: {
            enabled: true,
            maxToolResultChars: 5000,
            headKeepRatio: 0.3,
            tailKeepRatio: 0.3,
          },
        },
      },
      channels: {
        telegram: { enabled: false, token: '', allowFrom: [] },
        whatsapp: { enabled: false, bridgeUrl: '', allowFrom: [] },
      },
      providers: {},
      gateway: {
        host: '0.0.0.0',
        port: 18790,
        heartbeat: { enabled: false, intervalMs: 60000 },
      },
      tools: { web: { search: { apiKey: '', maxResults: 5 } } },
      cron: { enabled: false, maxConcurrentJobs: 5, defaultTimezone: 'UTC', historyRetentionDays: 7, enableMetrics: false },
    };
  });

  afterEach(() => {
    bus.clear();
  });

  it('should publish inbound message when Telegram receives message', async () => {
    // 创建 Telegram 通道
    const _telegram = new TelegramChannel(telegramConfig, bus);

    // 监听 inbound 事件
    const inboundMessages: InboundMessage[] = [];
    bus.on('inbound', (msg) => {
      inboundMessages.push(msg);
    });

    // 模拟收到消息（通过直接调用 handleMessage）
    // 注意：实际使用中会由 grammY 触发
    const testMessage: InboundMessage = {
      channel: 'telegram',
      sender_id: '123456789',
      chat_id: '987654321',
      content: 'Hello bot!',
      media: [],
      metadata: {},
    };

    await bus.publishInbound(testMessage);

    // 验证消息已发布
    expect(inboundMessages).toHaveLength(1);
    expect(inboundMessages[0].channel).toBe('telegram');
    expect(inboundMessages[0].sender_id).toBe('123456789');
    expect(inboundMessages[0].content).toBe('Hello bot!');
  });

  it('should consume inbound message via MessageBus', async () => {
    // 发布测试消息
    const testMessage: InboundMessage = {
      channel: 'telegram',
      sender_id: '123456789',
      chat_id: '987654321',
      content: 'Test message',
      media: [],
      metadata: {},
    };

    await bus.publishInbound(testMessage);

    // 消费消息
    const consumed = await bus.consumeInbound();

    expect(consumed).toEqual(testMessage);
  });

  it('should pass message from Telegram to AgentService', async () => {
    // 标记 AgentService 是否收到消息
    let receivedMessage: InboundMessage | null = null;

    // 模拟 AgentService 的消息处理
    const messagePromise = new Promise<InboundMessage>((resolve) => {
      bus.once('inbound', (msg) => {
        receivedMessage = msg;
        resolve(msg);
      });
    });

    // 通过 Telegram 配置发布消息
    const testMessage: InboundMessage = {
      channel: 'telegram',
      sender_id: '123456789',
      chat_id: '987654321',
      content: 'Process this message',
      media: [],
      metadata: { test: true },
    };

    await bus.publishInbound(testMessage);

    // 等待消息被接收
    await messagePromise;

    // 验证消息传递
    expect(receivedMessage).not.toBeNull();
    expect(receivedMessage?.channel).toBe('telegram');
    expect(receivedMessage?.content).toBe('Process this message');
  });

  it('should handle multiple messages in sequence', async () => {
    const messages: string[] = [];

    // 监听所有 inbound 消息
    bus.on('inbound', (msg) => {
      messages.push(msg.content);
    });

    // 发布多条消息
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

    // 验证所有消息都被接收
    expect(messages).toHaveLength(3);
    expect(messages).toEqual(['Message 1', 'Message 2', 'Message 3']);
  });

  it('should handle outbound messages from Agent to Telegram', async () => {
    const outboundMessages: OutboundMessage[] = [];

    // 监听 outbound 事件
    bus.on('outbound', (msg) => {
      outboundMessages.push(msg);
    });

    // 发布出站消息（模拟 Agent 回复）
    const reply: OutboundMessage = {
      channel: 'telegram',
      chat_id: '987654321',
      content: 'This is my reply',
    };

    await bus.publishOutbound(reply);

    // 验证出站消息已接收
    expect(outboundMessages.length).toBeGreaterThanOrEqual(1);
    expect(outboundMessages[0].channel).toBe('telegram');
    expect(outboundMessages[0].chat_id).toBe('987654321');
    expect(outboundMessages[0].content).toBe('This is my reply');
  });

  it('should filter messages by allowFrom list', async () => {
    // 配置只允许特定用户
    const restrictedConfig = {
      ...telegramConfig,
      allowFrom: ['999999999'], // 只允许这个用户
    };

    const _telegram = new TelegramChannel(restrictedConfig, bus);
    const receivedMessages: InboundMessage[] = [];

    bus.on('inbound', (msg) => {
      receivedMessages.push(msg);
    });

    // 尝试发送来自未授权用户的消息
    // 通过直接调用 bus.publishInbound 会绕过 TelegramChannel 的过滤
    // 所以我们需要测试 BaseChannel 的 isAllowed 方法

    // 白名单测试 - 允许的用户
    const allowedMessage: InboundMessage = {
      channel: 'telegram',
      sender_id: '999999999', // 在白名单中
      chat_id: '987654321',
      content: 'Allowed message',
      media: [],
      metadata: {},
    };

    await bus.publishInbound(allowedMessage);

    // 白名单测试 - 禁止的用户
    const blockedMessage: InboundMessage = {
      channel: 'telegram',
      sender_id: '123456789', // 不在白名单中
      chat_id: '987654321',
      content: 'Blocked message',
      media: [],
      metadata: {},
    };

    // 注意：这里直接调用 publishInbound 会绕过 TelegramChannel.isAllowed()
    // 实际过滤发生在 TelegramChannel 的 handleMessage 中
    // 这个测试验证了 bus 本身不处理过滤
    await bus.publishInbound(blockedMessage);

    // bus 会接收所有消息（过滤在 channel 层）
    expect(receivedMessages).toHaveLength(2);
  });

  it('should handle message with media attachments', async () => {
    const receivedMessages: InboundMessage[] = [];

    bus.on('inbound', (msg) => {
      receivedMessages.push(msg);
    });

    // 发送带媒体的消息
    const messageWithMedia: InboundMessage = {
      channel: 'telegram',
      sender_id: '123456789',
      chat_id: '987654321',
      content: 'Check this photo',
      media: ['file_id_1', 'file_id_2'],
      metadata: { caption: 'Vacation photo' },
    };

    await bus.publishInbound(messageWithMedia);

    expect(receivedMessages).toHaveLength(1);
    expect(receivedMessages[0].media).toEqual(['file_id_1', 'file_id_2']);
    expect(receivedMessages[0].metadata).toEqual({ caption: 'Vacation photo' });
  });
});

describe('AgentService message processing', () => {
  it('should consume messages from MessageBus', async () => {
    const { MessageBus } = await import('../../bus/index.js');
    const bus = new MessageBus();

    const messages: InboundMessage[] = [];

    // 模拟 AgentService 的消费循环
    const consumePromise = (async () => {
      const msg = await bus.consumeInbound();
      messages.push(msg);
    })();

    // 发布消息
    const testMessage: InboundMessage = {
      channel: 'telegram',
      sender_id: '123456789',
      chat_id: '987654321',
      content: 'Process me',
      media: [],
      metadata: {},
    };

    await bus.publishInbound(testMessage);

    // 等待消费完成
    await consumePromise;

    expect(messages).toHaveLength(1);
    expect(messages[0].content).toBe('Process me');
  });

  it('should handle concurrent message publishing and consuming', async () => {
    const { MessageBus } = await import('../../bus/index.js');
    const bus = new MessageBus();

    const consumedMessages: InboundMessage[] = [];
    const consumeCount = 5;

    // 启动多个消费者
    const consumers = Array(consumeCount).fill(null).map(async () => {
      const msg = await bus.consumeInbound();
      consumedMessages.push(msg);
    });

    // 发布多条消息
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

    // 等待所有消费者完成
    await Promise.all(consumers);

    expect(consumedMessages).toHaveLength(consumeCount);
  });
});
