/**
 * Session Key Unit Tests
 * 
 * Tests for session key generation and parsing using the new routing system format:
 * {agentId}:{source}:{accountId}:{peerKind}:{peerId}[:thread:{threadId}]
 */

import { describe, it, expect } from 'vitest';
import { generateSessionKey, parseSessionKey, getRoutingInfo } from '../session-key.js';

describe('SessionKey', () => {
  describe('generateSessionKey', () => {
    describe('Telegram', () => {
      it('should generate DM key with senderId', () => {
        const key = generateSessionKey({
          source: 'telegram',
          chatId: '123456',
          senderId: '916534770',
          isGroup: false,
        });

        // New format: {agentId}:{source}:{accountId}:{peerKind}:{peerId}
        expect(key).toBe('main:telegram:default:dm:916534770');
      });

      it('should generate group key', () => {
        const key = generateSessionKey({
          source: 'telegram',
          chatId: '-1001234567890',
          senderId: '916534770',
          isGroup: true,
        });

        expect(key).toBe('main:telegram:default:group:-1001234567890');
      });

      it('should generate thread key', () => {
        const key = generateSessionKey({
          source: 'telegram',
          chatId: '-1001234567890',
          senderId: '916534770',
          isGroup: true,
          threadId: '789',
        });

        expect(key).toBe('main:telegram:default:group:-1001234567890:thread:789');
      });
    });

    describe('CLI', () => {
      it('should generate direct key for CLI', () => {
        const key = generateSessionKey({
          source: 'cli',
          chatId: 'direct',
          senderId: 'user',
          isGroup: false,
        });

        expect(key).toBe('main:cli:default:direct:cli');
      });

      it('should generate named key for CLI', () => {
        const key = generateSessionKey({
          source: 'cli',
          chatId: 'my-session',
          senderId: 'user',
          isGroup: false,
        });

        expect(key).toBe('main:cli:default:direct:my-session');
      });
    });

    describe('WebUI', () => {
      it('should generate key for WebUI', () => {
        const key = generateSessionKey({
          source: 'webui',
          chatId: 'chat_123',
          senderId: 'user',
          isGroup: false,
        });

        // WebUI maps to gateway source
        expect(key).toBe('main:gateway:default:direct:chat_123');
      });
    });

    describe('Gateway', () => {
      it('should generate key for Gateway', () => {
        const key = generateSessionKey({
          source: 'gateway',
          chatId: 'chat_123456',
          senderId: 'user',
          isGroup: false,
        });

        expect(key).toBe('main:gateway:default:direct:chat_123456');
      });
    });

    describe('custom agent and account', () => {
      it('should use custom agentId', () => {
        const key = generateSessionKey({
          source: 'telegram',
          chatId: '123456',
          senderId: '916534770',
          isGroup: false,
          agentId: 'coder',
        });

        expect(key).toBe('coder:telegram:default:dm:916534770');
      });

      it('should use custom accountId', () => {
        const key = generateSessionKey({
          source: 'telegram',
          chatId: '123456',
          senderId: '916534770',
          isGroup: false,
          accountId: 'work',
        });

        expect(key).toBe('main:telegram:work:dm:916534770');
      });
    });
  });

  describe('parseSessionKey', () => {
    it('should parse Telegram DM key', () => {
      const parsed = parseSessionKey('main:telegram:default:dm:916534770');

      expect(parsed.source).toBe('telegram');
      expect(parsed.type).toBe('dm');
      expect(parsed.chatId).toBe('916534770');
      expect(parsed.agentId).toBe('main');
      expect(parsed.accountId).toBe('default');
    });

    it('should parse Telegram group key', () => {
      const parsed = parseSessionKey('main:telegram:default:group:-1001234567890');

      expect(parsed.source).toBe('telegram');
      expect(parsed.type).toBe('group');
      expect(parsed.chatId).toBe('-1001234567890');
    });

    it('should parse Telegram thread key', () => {
      const parsed = parseSessionKey('main:telegram:default:group:-1001234567890:thread:789');

      expect(parsed.source).toBe('telegram');
      expect(parsed.type).toBe('thread');
      expect(parsed.chatId).toBe('-1001234567890');
      expect(parsed.threadId).toBe('789');
    });

    it('should parse CLI direct key', () => {
      const parsed = parseSessionKey('main:cli:default:direct:cli');

      expect(parsed.source).toBe('cli');
      expect(parsed.type).toBe('direct');
      expect(parsed.chatId).toBe('cli');
    });

    it('should parse CLI named key', () => {
      const parsed = parseSessionKey('main:cli:default:direct:my-session');

      expect(parsed.source).toBe('cli');
      expect(parsed.type).toBe('direct');
      expect(parsed.chatId).toBe('my-session');
    });

    it('should parse WebUI key', () => {
      const parsed = parseSessionKey('main:gateway:default:direct:chat_123');

      expect(parsed.source).toBe('gateway');
      expect(parsed.type).toBe('direct');
      expect(parsed.chatId).toBe('chat_123');
    });

    it('should parse Gateway key', () => {
      const parsed = parseSessionKey('main:gateway:default:direct:chat_123456');

      expect(parsed.source).toBe('gateway');
      expect(parsed.type).toBe('direct');
      expect(parsed.chatId).toBe('chat_123456');
    });

    it('should handle invalid key gracefully', () => {
      const parsed = parseSessionKey('invalid-key');

      expect(parsed.source).toBe('invalid-key');
      expect(parsed.type).toBe('other');
      expect(parsed.chatId).toBe('invalid-key');
    });
  });

  describe('getRoutingInfo', () => {
    it('should extract routing info from Telegram DM', () => {
      const routing = getRoutingInfo('main:telegram:default:dm:916534770');

      expect(routing.channel).toBe('telegram');
      expect(routing.chatId).toBe('916534770');
      expect(routing.threadId).toBeUndefined();
    });

    it('should extract routing info from Telegram thread', () => {
      const routing = getRoutingInfo('main:telegram:default:group:-1001234567890:thread:789');

      expect(routing.channel).toBe('telegram');
      expect(routing.chatId).toBe('-1001234567890');
      expect(routing.threadId).toBe('789');
    });

    it('should extract routing info from CLI', () => {
      const routing = getRoutingInfo('main:cli:default:direct:cli');

      expect(routing.channel).toBe('cli');
      expect(routing.chatId).toBe('cli');
    });

    it('should extract routing info from Gateway', () => {
      const routing = getRoutingInfo('main:gateway:default:direct:chat_123456');

      expect(routing.channel).toBe('gateway');
      expect(routing.chatId).toBe('chat_123456');
    });
  });

  describe('consistency', () => {
    it('should generate consistent keys for same inputs', () => {
      const key1 = generateSessionKey({
        source: 'telegram',
        chatId: '123456',
        senderId: '916534770',
        isGroup: false,
      });

      const key2 = generateSessionKey({
        source: 'telegram',
        chatId: '123456',
        senderId: '916534770',
        isGroup: false,
      });

      expect(key1).toBe(key2);
    });

    it('should generate different keys for DM vs Group', () => {
      const dmKey = generateSessionKey({
        source: 'telegram',
        chatId: '-1001234567890',
        senderId: '916534770',
        isGroup: false,
      });

      const groupKey = generateSessionKey({
        source: 'telegram',
        chatId: '-1001234567890',
        senderId: '916534770',
        isGroup: true,
      });

      expect(dmKey).not.toBe(groupKey);
      expect(dmKey).toBe('main:telegram:default:dm:916534770');
      expect(groupKey).toBe('main:telegram:default:group:-1001234567890');
    });

    it('should round-trip generate and parse', () => {
      const original = {
        source: 'telegram' as const,
        chatId: '-1001234567890',
        senderId: '916534770',
        isGroup: true,
        threadId: '789',
      };

      const key = generateSessionKey(original);
      const parsed = parseSessionKey(key);

      expect(parsed.source).toBe(original.source);
      expect(parsed.chatId).toBe(original.chatId);
      expect(parsed.threadId).toBe(original.threadId);
    });
  });
});
