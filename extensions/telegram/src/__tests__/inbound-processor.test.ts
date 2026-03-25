import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createInboundProcessor, type InboundProcessorDeps } from '../inbound-processor.js';
import { TelegramAccountManager } from '../account-manager.js';
import type { Config } from '@xopcai/xopcbot/config/schema.js';
import type { MessageBus } from '@xopcai/xopcbot/infra/bus/index.js';
import type { Bot, Context } from 'grammy';
import type { Message } from '@grammyjs/types';

// Mock dedupe module
vi.mock('../dedupe.js', () => ({
  telegramUpdateDedupe: {
    checkAndAdd: vi.fn(() => false),
  },
  buildTelegramUpdateKey: vi.fn(() => 'test-update-key'),
}));

vi.mock('../../../utils/logger.js', () => ({
  createLogger: vi.fn(() => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  })),
}));

describe('inbound-processor', () => {
  let accountManager: TelegramAccountManager;
  let mockBus: MessageBus;
  let mockConfig: Config;
  let processor: ReturnType<typeof createInboundProcessor>;
  let mockBot: Bot;
  let deps: InboundProcessorDeps;

  // Mock services for dependency injection
  const mockAccessControl = {
    normalizeAllowFromWithStore: vi.fn((x) => x.allowFrom ?? []),
    evaluateGroupBaseAccess: vi.fn(() => ({ allowed: true })),
    resolveRequireMention: vi.fn(() => false),
    hasBotMention: vi.fn(() => true),
    removeBotMention: vi.fn((text) => text),
  };

  const mockSessionKeyService = {
    generateSessionKey: vi.fn(() => 'telegram:12345:67890'),
  };

  const mockSttService = {
    transcribe: vi.fn().mockResolvedValue({ text: 'Transcribed text' }),
    isSTTAvailable: vi.fn(() => false),
  };

  const mockMediaUtils = {
    getMimeType: vi.fn(() => 'image/jpeg'),
  };

  beforeEach(() => {
    vi.clearAllMocks();

    accountManager = new TelegramAccountManager();
    mockBot = {
      api: {
        getFile: vi.fn().mockResolvedValue({
          file_path: 'photos/test.jpg',
        }),
      },
    } as unknown as Bot;

    accountManager.registerBot('default', mockBot);
    accountManager.registerAccount({
      accountId: 'default',
      name: 'Default',
      enabled: true,
      botToken: 'test-token',
    });
    accountManager.setBotUsername('default', 'test_bot');

    mockBus = {
      publishInbound: vi.fn().mockResolvedValue(undefined),
    } as unknown as MessageBus;

    mockConfig = {};

    // Create processor with injected dependencies (P1 improvement)
    deps = {
      bus: mockBus,
      config: mockConfig,
      accountManager,
      accessControl: mockAccessControl,
      sessionKeyService: mockSessionKeyService,
      sttService: mockSttService,
      mediaUtils: mockMediaUtils,
    };

    processor = createInboundProcessor(deps);
  });

  describe('basic message processing', () => {
    it('should process text message', async () => {
      const mockCtx = createMockContext({
        text: 'Hello World',
        chatId: 12345,
        fromId: 67890,
      });

      await processor(mockCtx as Context, 'default');

      expect(mockBus.publishInbound).toHaveBeenCalled();
      const call = (mockBus.publishInbound as any).mock.calls[0][0];
      expect(call.content).toBe('Hello World');
      expect(call.channel).toBe('telegram');
    });

    it('should handle caption as content', async () => {
      const mockCtx = createMockContext({
        caption: 'Photo caption',
        chatId: 12345,
        fromId: 67890,
      });

      await processor(mockCtx as Context, 'default');

      const call = (mockBus.publishInbound as any).mock.calls[0][0];
      expect(call.content).toBe('Photo caption');
    });

    it('should skip if account not found', async () => {
      const mockCtx = createMockContext({ text: 'Hello' });

      await processor(mockCtx as Context, 'non-existent');

      expect(mockBus.publishInbound).not.toHaveBeenCalled();
    });

    it('should skip if bot username not available', async () => {
      accountManager.setBotUsername('default', '');
      const mockCtx = createMockContext({ text: 'Hello' });

      await processor(mockCtx as Context, 'default');

      expect(mockBus.publishInbound).not.toHaveBeenCalled();
    });
  });

  describe('dependency injection (P1 improvement)', () => {
    it('should use injected accessControl service', async () => {
      const mockCtx = createMockContext({ text: 'Hello' });

      await processor(mockCtx as Context, 'default');

      expect(mockAccessControl.evaluateGroupBaseAccess).toHaveBeenCalled();
      expect(mockAccessControl.normalizeAllowFromWithStore).toHaveBeenCalled();
    });

    it('should use injected sessionKeyService', async () => {
      const mockCtx = createMockContext({ text: 'Hello' });

      await processor(mockCtx as Context, 'default');

      expect(mockSessionKeyService.generateSessionKey).toHaveBeenCalledWith({
        source: 'telegram',
        chatId: '12345',
        senderId: '67890',
        isGroup: false,
        threadId: undefined,
        accountId: 'default',
      });
    });

    it('should respect access control rejection', async () => {
      mockAccessControl.evaluateGroupBaseAccess.mockReturnValueOnce({ allowed: false, reason: 'blocked' });
      
      const mockCtx = createMockContext({ text: 'Hello' });
      await processor(mockCtx as Context, 'default');

      expect(mockBus.publishInbound).not.toHaveBeenCalled();
    });
  });

  describe('queue management', () => {
    it('should process messages sequentially', async () => {
      const mockCtx1 = createMockContext({ text: 'Message 1', chatId: 12345 });
      const mockCtx2 = createMockContext({ text: 'Message 2', chatId: 12345 });

      await Promise.all([
        processor(mockCtx1 as Context, 'default'),
        processor(mockCtx2 as Context, 'default'),
      ]);

      expect(mockBus.publishInbound).toHaveBeenCalledTimes(2);
    });
  });

  describe('result structure', () => {
    it('should publish correct message structure', async () => {
      const mockCtx = createMockContext({
        text: 'Test',
        chatId: 12345,
        fromId: 67890,
      });

      await processor(mockCtx as Context, 'default');

      const call = (mockBus.publishInbound as any).mock.calls[0][0];
      expect(call).toHaveProperty('channel', 'telegram');
      expect(call).toHaveProperty('sender_id');
      expect(call).toHaveProperty('chat_id');
      expect(call).toHaveProperty('content');
      expect(call).toHaveProperty('metadata');
    });
  });

  describe('media processing helper functions (P3 improvement)', () => {
    beforeEach(() => {
      // Mock global fetch for media download
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        arrayBuffer: vi.fn().mockResolvedValue(Buffer.from('fake-image-data')),
      });
    });

    it('should process media attachments when photo is sent', async () => {
      const mockCtx = createMockContext({
        caption: 'Photo caption',
        chatId: 12345,
        fromId: 67890,
      });
      // Add photo to message
      (mockCtx.message as any).photo = [{ file_id: 'photo1' }, { file_id: 'photo2' }];

      await processor(mockCtx as Context, 'default');

      expect(mockBot.api.getFile).toHaveBeenCalledWith('photo2'); // Takes last photo
      expect(mockMediaUtils.getMimeType).toHaveBeenCalled();
    });
  });

  describe('externalAccessGate (plugin path)', () => {
    beforeEach(() => {
      accountManager.registerAccount({
        accountId: 'default',
        name: 'Default',
        enabled: true,
        botToken: 'test-token',
        requireMention: true,
      } as any);
      processor = createInboundProcessor({ ...deps, externalAccessGate: true });
    });

    it('strips @bot mention in group when requireMention is set (legacy strip)', async () => {
      const mockCtx = createMockContext({
        text: '@test_bot please read',
        chatId: -100123,
        fromId: 67890,
        chatType: 'supergroup',
      });

      await processor(mockCtx as Context, 'default');

      const call = (mockBus.publishInbound as any).mock.calls[0][0];
      expect(call.content).toBe('please read');
    });

    it('does not strip mention in private chat (externalAccessGate)', async () => {
      const mockCtx = createMockContext({
        text: '@test_bot hello',
        chatId: 12345,
        fromId: 67890,
        chatType: 'private',
      });

      await processor(mockCtx as Context, 'default');

      const call = (mockBus.publishInbound as any).mock.calls[0][0];
      expect(call.content).toBe('@test_bot hello');
    });

    it('skips inbound access gates but still dedupes', async () => {
      const mockCtx = createMockContext({ text: 'plain', chatId: 12345 });
      await processor(mockCtx as Context, 'default');
      expect(mockAccessControl.evaluateGroupBaseAccess).not.toHaveBeenCalled();
      expect(mockBus.publishInbound).toHaveBeenCalled();
    });
  });
});

// Helper to create mock context
function createMockContext(options: {
  text?: string;
  caption?: string;
  chatId?: number;
  fromId?: number;
  chatType?: 'private' | 'group' | 'supergroup';
}): Partial<Context> {
  return {
    chat: {
      id: options.chatId ?? 12345,
      type: options.chatType ?? 'private',
    } as any,
    from: {
      id: options.fromId ?? 67890,
      username: 'testuser',
    } as any,
    message: {
      message_id: 1,
      text: options.text,
      caption: options.caption,
      date: Date.now(),
    } as Message,
  };
}
