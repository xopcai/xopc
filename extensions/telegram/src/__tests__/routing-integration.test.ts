import { requireConversation } from '@xopcai/xopc/storage/sqlite/conversation-repository.js';
/**
 * Telegram Routing Integration Tests
 */

import { beforeEach, describe, it, expect } from 'vitest';
import { ConfigSchema, type Config } from '@xopcai/xopc/config/schema.js';
import { AgentCatalogRepository } from '../../../../src/agent-catalog/repository.js';
import { initializeTestAgentCatalog } from '../../../../src/agent-catalog/test-support.js';
import { generateConversationIdWithRouting, extractMemberRoleIds } from '../routing-integration.js';

describe('TelegramRouting', () => {
  const baseConfig: Config = ConfigSchema.parse({
    session: {
      dmScope: 'per-account-channel-peer',
      identityLinks: {},
    },
  });

  beforeEach(() => initializeTestAgentCatalog({
    agents: [
      { id: 'main', enabled: true },
      { id: 'custom-agent', enabled: true },
      { id: 'coder', enabled: true },
      { id: 'researcher', enabled: true },
    ],
  }));

  describe('generateConversationIdWithRouting', () => {
    it('should generate basic DM session key', () => {
      const conversationId = generateConversationIdWithRouting(
        {
          accountId: 'acc_default',
          chatId: '123456',
          senderId: '789012',
          isGroup: false,
        },
        baseConfig
      );

      expect(requireConversation(conversationId)).toMatchObject({ agentId: 'main', routing: { peerKind: 'direct', peerId: '789012', accountId: 'acc_default' } });
    });

    it('should generate group session key', () => {
      const conversationId = generateConversationIdWithRouting(
        {
          accountId: 'acc_default',
          chatId: '-1001234567',
          senderId: '789012',
          isGroup: true,
        },
        baseConfig
      );

      expect(requireConversation(conversationId)).toMatchObject({ agentId: 'main', routing: { peerKind: 'group', peerId: '-1001234567' } });
    });

    it('should use configured default agent', () => {
      const repository = new AgentCatalogRepository();
      repository.setDefault('custom-agent', repository.getSettings().revision);

      const conversationId = generateConversationIdWithRouting(
        {
          accountId: 'acc_default',
          chatId: '123456',
          senderId: '789012',
          isGroup: false,
        },
        baseConfig
      );

      expect(requireConversation(conversationId)).toMatchObject({ agentId: 'custom-agent' });
    });

    it('should route to specific agent based on binding', () => {
      new AgentCatalogRepository().replaceBindings([{
        agentId: 'coder',
        match: { channel: 'telegram', peerId: '-1001234567' },
        priority: 100,
        enabled: true,
      }]);

      const conversationId = generateConversationIdWithRouting(
        {
          accountId: 'acc_default',
          chatId: '-1001234567',
          senderId: '789012',
          isGroup: true,
        },
        baseConfig
      );

      expect(requireConversation(conversationId)).toMatchObject({ agentId: 'coder' });
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

      const conversationId = generateConversationIdWithRouting(
        {
          accountId: 'acc_default',
          chatId: '123456',
          senderId: '789012',
          isGroup: false,
        },
        config
      );

      // Should use canonical name 'alice' instead of senderId
      expect(generateConversationIdWithRouting({ accountId: 'acc_default', chatId: 'other', senderId: 'alice', isGroup: false }, config)).toBe(conversationId);
    });

    it('should handle thread ID', () => {
      const conversationId = generateConversationIdWithRouting(
        {
          accountId: 'acc_default',
          chatId: '-1001234567',
          senderId: '789012',
          isGroup: true,
          threadId: '999',
        },
        baseConfig
      );

      expect(requireConversation(conversationId).routing?.threadId).toBe('999');
    });

    it('should handle multiple bindings with priority', () => {
      new AgentCatalogRepository().replaceBindings([
        { agentId: 'researcher', match: { channel: 'telegram' }, priority: 50, enabled: true },
        { agentId: 'coder', match: { channel: 'telegram', peerId: '-1001234567' }, priority: 100, enabled: true },
      ]);

      // Should match coder (higher priority)
      const conversationId1 = generateConversationIdWithRouting(
        {
          accountId: 'acc_default',
          chatId: '-1001234567',
          senderId: '789012',
          isGroup: true,
        },
        baseConfig
      );
      expect(requireConversation(conversationId1).agentId).toBe('coder');

      // Should match researcher (only match)
      const conversationId2 = generateConversationIdWithRouting(
        {
          accountId: 'acc_default',
          chatId: '-1009999999',
          senderId: '789012',
          isGroup: true,
        },
        baseConfig
      );
      expect(requireConversation(conversationId2).agentId).toBe('researcher');
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
