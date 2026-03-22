import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createOutboundSender } from '../outbound-sender.js';
import { TelegramAccountManager } from '../account-manager.js';
import type { Config, ChannelSendOptions } from '@xopcai/xopcbot/channels/channel-domain.js';
import type { Bot } from 'grammy';

// Mock dependencies
vi.mock('../send-options.js', () => ({
  buildSendOptions: vi.fn((params) => ({
    parse_mode: params.parseMode ?? 'HTML',
    ...(params.threadId && { message_thread_id: parseInt(params.threadId, 10) }),
    ...(params.replyToMessageId && { reply_to_message_id: parseInt(params.replyToMessageId, 10) }),
    ...(params.silent && { disable_notification: true }),
    ...(params.caption && { caption: params.caption }),
  })),
  parseDataUrl: vi.fn((url) => {
    const match = url.match(/^data:([^;]+);base64,(.+)$/);
    if (!match) return null;
    return { mimeType: match[1], buffer: Buffer.from(match[2], 'base64') };
  }),
  resolveMediaMethod: vi.fn((mimeType) => {
    if (mimeType.startsWith('image/')) return 'sendPhoto';
    if (mimeType.startsWith('video/')) return 'sendVideo';
    if (mimeType.startsWith('audio/')) return 'sendAudio';
    return 'sendDocument';
  }),
}));

vi.mock('../caption.js', () => ({
  splitTelegramCaption: vi.fn((content) => {
    if (!content || content.length <= 1024) {
      return { caption: content, followUpText: undefined };
    }
    return { caption: content.slice(0, 1024), followUpText: content.slice(1024) };
  }),
}));

vi.mock('../format.js', () => ({
  renderTelegramHtmlText: vi.fn((text) => `<b>${text}</b>`),
  markdownToTelegramChunks: vi.fn((content) => [{ html: `<p>${content}</p>`, text: content }]),
}));

vi.mock('../sent-cache.js', () => ({
  sentMessageCache: {
    record: vi.fn(),
  },
}));

vi.mock('../../../infra/retry.js', () => ({
  createRetryRunner: vi.fn(() => vi.fn((fn) => fn())),
  isRecoverableNetworkError: vi.fn(() => false),
}));

describe('outbound-sender', () => {
  let accountManager: TelegramAccountManager;
  let mockBot: Bot;
  let sender: ReturnType<typeof createOutboundSender>;
  const mockConfig: Config = {};

  beforeEach(() => {
    vi.clearAllMocks();
    
    accountManager = new TelegramAccountManager();
    mockBot = {
      api: {
        sendChatAction: vi.fn().mockResolvedValue(undefined),
        sendMessage: vi.fn().mockResolvedValue({ message_id: 123 }),
        sendPhoto: vi.fn().mockResolvedValue({ message_id: 456, ok: true }),
        sendVideo: vi.fn().mockResolvedValue({ message_id: 457, ok: true }),
        sendAudio: vi.fn().mockResolvedValue({ message_id: 458, ok: true }),
        sendDocument: vi.fn().mockResolvedValue({ message_id: 459, ok: true }),
      },
    } as unknown as Bot;

    accountManager.registerBot('default', mockBot);
    
    sender = createOutboundSender({
      accountManager,
      config: mockConfig,
    });
  });

  describe('typing indicators', () => {
    it('should send typing_on action', async () => {
      const options: ChannelSendOptions = {
        chatId: '12345',
        type: 'typing_on',
        accountId: 'default',
      };

      const result = await sender.send(options);

      expect(mockBot.api.sendChatAction).toHaveBeenCalledWith('12345', 'typing');
      expect(result.success).toBe(true);
    });

    it('should handle typing_off', async () => {
      const options: ChannelSendOptions = {
        chatId: '12345',
        type: 'typing_off',
        accountId: 'default',
      };

      const result = await sender.send(options);

      expect(result.success).toBe(true);
    });
  });

  describe('empty message handling', () => {
    it('should skip empty messages without media', async () => {
      const options: ChannelSendOptions = {
        chatId: '12345',
        content: '',
        accountId: 'default',
      };

      const result = await sender.send(options);

      expect(result.success).toBe(true);
    });
  });

  describe('text message sending', () => {
    it('should send basic text message', async () => {
      const options: ChannelSendOptions = {
        chatId: '12345',
        content: 'Hello World',
        accountId: 'default',
      };

      const result = await sender.send(options);

      expect(mockBot.api.sendMessage).toHaveBeenCalled();
      expect(result.success).toBe(true);
      expect(result.messageId).toBe('123');
    });

    it('should handle missing bot gracefully', async () => {
      const options: ChannelSendOptions = {
        chatId: '12345',
        content: 'Hello',
        accountId: 'non-existent',
      };

      const result = await sender.send(options);

      expect(result.success).toBe(false);
      expect(result.error).toContain('Bot not initialized');
    });
  });

  describe('data URL media sending', () => {
    it('should send image from data URL', async () => {
      const dataUrl = 'data:image/png;base64,iVBORw0KGgoAAAA';
      const options: ChannelSendOptions = {
        chatId: '12345',
        content: 'Check this image',
        mediaUrl: dataUrl,
        mediaType: 'photo',
        accountId: 'default',
      };

      const result = await sender.send(options);

      expect(mockBot.api.sendPhoto).toHaveBeenCalled();
      expect(result.success).toBe(true);
    });
  });

  describe('send result structure', () => {
    it('should return correct result structure', async () => {
      const options: ChannelSendOptions = {
        chatId: '12345',
        content: 'Test',
        accountId: 'default',
      };

      const result = await sender.send(options);

      expect(result).toHaveProperty('messageId');
      expect(result).toHaveProperty('chatId');
      expect(result).toHaveProperty('success');
      expect(result.chatId).toBe('12345');
    });
  });
});
