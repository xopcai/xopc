/**
 * Telegram Routing Integration Tests
 */

import { describe, it, expect } from 'vitest';
import type { Config } from '@xopcai/xopcbot/config/schema.js';
import { generateSessionKeyWithRouting, extractMemberRoleIds } from '../routing-integration.js';

describe('TelegramRouting', () => {
  const baseConfig: Config = {
    agents: {
      default: 'main',
    },
    bindings: [],
    session: {
      dmScope: 'per-account-channel-peer',
      identityLinks: {},
    },
  };

  describe('generateSessionKeyWithRouting', () => {
    it('should generate basic DM session key', () => {
      const sessionKey = generateSessionKeyWithRouting(
        {
          accountId: 'acc_default',
          chatId: '123456',
          senderId: '789012',
          isGroup: false,
        },
        baseConfig
      );

      expect(sessionKey).toMatch(/^main:telegram:acc_default:dm:789012$/);
    });

    it('should generate group session key', () => {
      const sessionKey = generateSessionKeyWithRouting(
        {
          accountId: 'acc_default',
          chatId: '-1001234567',
          senderId: '789012',
          isGroup: true,
        },
        baseConfig
      );

      expect(sessionKey).toMatch(/^main:telegram:acc_default:group:-1001234567$/);
    });

    it('should use configured default agent', () => {
      const config: Config = {
        ...baseConfig,
        agents: {
          default: 'custom-agent',
        },
      };

      const sessionKey = generateSessionKeyWithRouting(
        {
          accountId: 'acc_default',
          chatId: '123456',
          senderId: '789012',
          isGroup: false,
        },
        config
      );

      expect(sessionKey).toMatch(/^custom-agent:telegram:acc_default:dm:789012$/);
    });

    it('should route to specific agent based on binding', () => {
      const config: Config = {
        ...baseConfig,
        bindings: [
          {
            agentId: 'coder',
            match: {
              channel: 'telegram',
              peerId: '-1001234567',
            },
            priority: 100,
          },
        ],
      };

      const sessionKey = generateSessionKeyWithRouting(
        {
          accountId: 'acc_default',
          chatId: '-1001234567',
          senderId: '789012',
          isGroup: true,
        },
        config
      );

      expect(sessionKey).toMatch(/^coder:telegram:acc_default:group:-1001234567$/);
    });

    it('should apply identity links', () => {
      const config: Config = {
        ...baseConfig,
        session: {
          ...baseConfig.session,
          identityLinks: {
            'alice': ['telegram:789012'],
          },
        },
      };

      const sessionKey = generateSessionKeyWithRouting(
        {
          accountId: 'acc_default',
          chatId: '123456',
          senderId: '789012',
          isGroup: false,
        },
        config
      );

      // Should use canonical name 'alice' instead of senderId
      expect(sessionKey).toMatch(/^main:telegram:acc_default:dm:alice$/);
    });

    it('should handle thread ID', () => {
      const sessionKey = generateSessionKeyWithRouting(
        {
          accountId: 'acc_default',
          chatId: '-1001234567',
          senderId: '789012',
          isGroup: true,
          threadId: '999',
        },
        baseConfig
      );

      expect(sessionKey).toContain(':thread:999');
    });

    it('should handle multiple bindings with priority', () => {
      const config: Config = {
        ...baseConfig,
        bindings: [
          {
            agentId: 'researcher',
            match: {
              channel: 'telegram',
            },
            priority: 50,
          },
          {
            agentId: 'coder',
            match: {
              channel: 'telegram',
              peerId: '-1001234567',
            },
            priority: 100,
          },
        ],
      };

      // Should match coder (higher priority)
      const sessionKey1 = generateSessionKeyWithRouting(
        {
          accountId: 'acc_default',
          chatId: '-1001234567',
          senderId: '789012',
          isGroup: true,
        },
        config
      );
      expect(sessionKey1).toMatch(/^coder:/);

      // Should match researcher (only match)
      const sessionKey2 = generateSessionKeyWithRouting(
        {
          accountId: 'acc_default',
          chatId: '-1009999999',
          senderId: '789012',
          isGroup: true,
        },
        config
      );
      expect(sessionKey2).toMatch(/^researcher:/);
    });
  });

  describe('extractMemberRoleIds', () => {
    it('should return empty array when no chat member', () => {
      // Mock context without chatMember
      const mockCtx = {} as any;
      const roles = extractMemberRoleIds(mockCtx);
      expect(roles).toEqual([]);
    });

    it('should extract creator role', () => {
      const mockCtx = {
        chatMember: {
          new_chat_member: {
            status: 'creator',
          },
        },
      } as any;

      const roles = extractMemberRoleIds(mockCtx);
      expect(roles).toContain('telegram:creator');
    });

    it('should extract admin role', () => {
      const mockCtx = {
        chatMember: {
          new_chat_member: {
            status: 'administrator',
          },
        },
      } as any;

      const roles = extractMemberRoleIds(mockCtx);
      expect(roles).toContain('telegram:admin');
    });
  });
});
