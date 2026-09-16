import { requireConversation } from '../storage/sqlite/conversation-repository.js';
/**
 * Complete Routing Integration E2E Test
 * 
 * Tests the complete flow from inbound message to agent routing:
 * 1. Inbound message received from channel
 * 2. Route context extraction
 * 3. Binding rule matching
 * 4. Session key generation
 * 5. Identity links application
 * 6. Agent routing
 * 7. Response routing back to channel
 */

import { describe, it, expect } from 'vitest';
import type { Config } from '../config/schema.js';
import { getConversationRouting, type BindingRule } from '../routing/index.js';
import { generateConversationIdWithRouting } from '../channels/telegram/index.js';
describe('Complete Routing E2E Flow', () => {

  describe('Scenario 1: Simple DM Message Flow', () => {
    it('should route DM message from start to finish', () => {
      const config: Config = {
        agents: { default: 'main' },
        bindings: [],
        session: {
          dmScope: 'per-account-channel-peer',
        },
      };

      // Simulate inbound Telegram message
      const inboundMessage = {
        accountId: 'acc_default',
        chatId: '123456',
        senderId: '789012',
        senderUsername: 'testuser',
        isGroup: false,
        content: 'Hello!',
      };

      // Step 1: Generate session key
      const conversationId = generateConversationIdWithRouting(
        {
          accountId: inboundMessage.accountId,
          chatId: inboundMessage.chatId,
          senderId: inboundMessage.senderId,
          senderUsername: inboundMessage.senderUsername,
          isGroup: inboundMessage.isGroup,
        },
        config
      );

      // Step 2: Parse and validate
      const parsed = getConversationRouting(conversationId);
      expect(parsed).toBeTruthy();
      expect(parsed?.agentId).toBe('main');
      expect(parsed?.peerKind).toBe('direct');
    });
  });

  describe('Scenario 2: Group Message with Binding Routing', () => {
    it('should route group message to specialized agent', () => {
      const config: Config = {
        agents: {
          default: 'main',
          list: [
            { id: 'main' },
            { id: 'coder' },
            { id: 'researcher' },
          ],
        },
        bindings: [
          {
            agentId: 'coder',
            match: {
              channel: 'telegram',
              peerId: '-1001111111', // Programming group
            },
            priority: 100,
          } as BindingRule,
          {
            agentId: 'researcher',
            match: {
              channel: 'telegram',
              peerId: '-1002222222', // Research group
            },
            priority: 100,
          } as BindingRule,
        ],
        session: {
          dmScope: 'per-account-channel-peer',
        },
      };

      // Message to programming group
      const programmingGroupMsg = {
        accountId: 'acc_default',
        chatId: '-1001111111',
        senderId: '789012',
        isGroup: true,
        content: 'How do I fix this bug?',
      };

      const conversationId1 = generateConversationIdWithRouting(
        {
          accountId: programmingGroupMsg.accountId,
          chatId: programmingGroupMsg.chatId,
          senderId: programmingGroupMsg.senderId,
          isGroup: programmingGroupMsg.isGroup,
        },
        config
      );

      const parsed1 = getConversationRouting(conversationId1);
      expect(parsed1?.agentId).toBe('coder');

      // Message to research group
      const researchGroupMsg = {
        accountId: 'acc_default',
        chatId: '-1002222222',
        senderId: '789012',
        isGroup: true,
        content: 'Find papers about AI',
      };

      const conversationId2 = generateConversationIdWithRouting(
        {
          accountId: researchGroupMsg.accountId,
          chatId: researchGroupMsg.chatId,
          senderId: researchGroupMsg.senderId,
          isGroup: researchGroupMsg.isGroup,
        },
        config
      );

      const parsed2 = getConversationRouting(conversationId2);
      expect(parsed2?.agentId).toBe('researcher');

      // Message to general group (default routing)
      const generalGroupMsg = {
        accountId: 'acc_default',
        chatId: '-1003333333',
        senderId: '789012',
        isGroup: true,
        content: 'General question',
      };

      const conversationId3 = generateConversationIdWithRouting(
        {
          accountId: generalGroupMsg.accountId,
          chatId: generalGroupMsg.chatId,
          senderId: generalGroupMsg.senderId,
          isGroup: generalGroupMsg.isGroup,
        },
        config
      );

      const parsed3 = getConversationRouting(conversationId3);
      expect(parsed3?.agentId).toBe('main');
    });
  });

  describe('Scenario 3: Cross-Platform User Identity Merging', () => {
    it('should merge same user across platforms', () => {
      const config: Config = {
        agents: { default: 'main' },
        bindings: [],
        session: {
          dmScope: 'per-peer',
          identityLinks: {
            'alice': [
              'telegram:111111',
              'discord:222222',
              'feishu:ou_alice123',
            ],
            'bob': [
              'telegram:333333',
              'discord:444444',
            ],
          },
        },
      };

      // Alice sends message on Telegram
      const aliceTgKey = generateConversationIdWithRouting(
        {
          accountId: 'acc_default',
          chatId: 'channel1',
          senderId: '111111',
          isGroup: false,
        },
        config
      );

      // Alice sends message on Discord
      const aliceDiscordKey = generateConversationIdWithRouting(
        {
          accountId: 'acc_default',
          chatId: 'channel2',
          senderId: '222222',
          isGroup: false,
          channel: 'discord',
        },
        config
      );

      // Alice sends message on Feishu
      const aliceFeishuKey = generateConversationIdWithRouting(
        {
          accountId: 'acc_default',
          chatId: 'channel3',
          senderId: 'ou_alice123',
          isGroup: false,
          channel: 'feishu',
        },
        config
      );

      // All should resolve to canonical name 'alice'
      const tgParsed = getConversationRouting(aliceTgKey);
      const discordParsed = getConversationRouting(aliceDiscordKey);
      const feishuParsed = getConversationRouting(aliceFeishuKey);

      expect(tgParsed?.peerId).toBe('alice');
      expect(discordParsed?.peerId).toBe('alice');
      expect(feishuParsed?.peerId).toBe('alice');

      // Different sources
      expect(tgParsed?.source).toBe('telegram');
      expect(discordParsed?.source).toBe('discord');
      expect(feishuParsed?.source).toBe('feishu');

      // Verify they would be stored in same logical session
      // (Same peerId 'alice' across platforms)
    });
  });

  describe('Scenario 4: Multi-Account Isolation', () => {
    it('should isolate messages from different accounts', () => {
      const config: Config = {
        agents: {
          default: 'main',
        },
        bindings: [
          {
            agentId: 'work-assistant',
            match: {
              channel: 'telegram',
              accountId: 'acc_work',
            },
            priority: 100,
          } as BindingRule,
        ],
        session: {
          dmScope: 'per-account-channel-peer',
        },
      };

      // Same user, different accounts
      const personalMsg = {
        accountId: 'acc_personal',
        chatId: '123456',
        senderId: '789012',
        isGroup: false,
      };

      const workMsg = {
        accountId: 'acc_work',
        chatId: '123456',
        senderId: '789012',
        isGroup: false,
      };

      const personalKey = generateConversationIdWithRouting(personalMsg, config);
      const workKey = generateConversationIdWithRouting(workMsg, config);

      const personalParsed = getConversationRouting(personalKey);
      const workParsed = getConversationRouting(workKey);

      // Different agents
      expect(personalParsed?.agentId).toBe('main');
      expect(workParsed?.agentId).toBe('work-assistant');

      // Different account IDs in session key
      expect(personalParsed?.accountId).toBe('acc_personal');
      expect(workParsed?.accountId).toBe('acc_work');

      // Same peer but isolated by account
      expect(personalParsed?.peerId).toBe('789012');
      expect(workParsed?.peerId).toBe('789012');
    });
  });

  describe('Scenario 5: Thread/Topic Messages', () => {
    it('should handle threaded messages correctly', () => {
      const config: Config = {
        agents: { default: 'main' },
        bindings: [],
        session: {
          dmScope: 'per-account-channel-peer',
        },
      };

      // Telegram topic message
      const topicMsg = {
        accountId: 'acc_default',
        chatId: '-1001234567',
        senderId: '789012',
        isGroup: true,
        threadId: '999',
      };

      const conversationId = generateConversationIdWithRouting(
        {
          accountId: topicMsg.accountId,
          chatId: topicMsg.chatId,
          senderId: topicMsg.senderId,
          isGroup: topicMsg.isGroup,
          threadId: topicMsg.threadId,
        },
        config
      );

      expect(requireConversation(conversationId).routing?.threadId).toBe('999');

      const parsed = getConversationRouting(conversationId);
      expect(parsed?.threadId).toBe('999');

      // Verify thread messages are isolated from parent group
      const parentGroupKey = generateConversationIdWithRouting(
        {
          accountId: topicMsg.accountId,
          chatId: topicMsg.chatId,
          senderId: topicMsg.senderId,
          isGroup: topicMsg.isGroup,
        },
        config
      );

      expect(requireConversation(parentGroupKey).routing?.threadId).toBeUndefined();
      expect(parentGroupKey).not.toBe(conversationId);
    });
  });

  describe('Scenario 7: Priority-Based Routing', () => {
    it('should respect binding priority', () => {
      const config: Config = {
        agents: {
          default: 'main',
          list: [
            { id: 'main' },
            { id: 'specialist' },
            { id: 'generalist' },
            { id: 'expert' },
          ],
        },
        bindings: [
          {
            agentId: 'expert',
            match: { channel: 'telegram', peerId: '-1009999999' },
            priority: 100,
          } as BindingRule,
          {
            agentId: 'specialist',
            match: { channel: 'telegram', peerKind: 'group' },
            priority: 50,
          } as BindingRule,
          {
            agentId: 'generalist',
            match: { channel: 'telegram' },
            priority: 10,
          } as BindingRule,
        ],
        session: { dmScope: 'per-peer' },
      };

      // Should match expert (highest priority, exact peer match)
      const expertKey = generateConversationIdWithRouting(
        {
          accountId: 'acc_default',
          chatId: '-1009999999',
          senderId: '789012',
          isGroup: true,
        },
        config
      );
      expect(getConversationRouting(expertKey)?.agentId).toBe('expert');

      // Should match specialist (group match, higher than generalist)
      const specialistKey = generateConversationIdWithRouting(
        {
          accountId: 'acc_default',
          chatId: '-1001111111',
          senderId: '789012',
          isGroup: true,
        },
        config
      );
      expect(getConversationRouting(specialistKey)?.agentId).toBe('specialist');

      // Should match generalist (only channel match)
      const generalistKey = generateConversationIdWithRouting(
        {
          accountId: 'acc_default',
          chatId: '123456',
          senderId: '789012',
          isGroup: false,
        },
        config
      );
      expect(getConversationRouting(generalistKey)?.agentId).toBe('generalist');
    });
  });

  describe('Scenario 8: Complex Real-World Setup', () => {
    it('should handle complex multi-channel, multi-agent setup', () => {
      const config: Config = {
        agents: {
          default: 'main',
          list: [
            { id: 'main' },
            { id: 'coder' },
            { id: 'support' },
            { id: 'admin' },
          ],
        },
        bindings: [
          // Discord admin channel
          {
            agentId: 'admin',
            match: {
              channel: 'discord',
              guildId: '123456789',
              peerId: 'admin-channel',
              memberRoleIds: ['admin-role'],
            },
            priority: 100,
          } as BindingRule,
          // Discord dev channel
          {
            agentId: 'coder',
            match: {
              channel: 'discord',
              guildId: '123456789',
              peerId: 'dev-*',
            },
            priority: 90,
          } as BindingRule,
          // Telegram support group
          {
            agentId: 'support',
            match: {
              channel: 'telegram',
              peerId: '-100support',
            },
            priority: 100,
          } as BindingRule,
          // Work account
          {
            agentId: 'main',
            match: {
              channel: 'telegram',
              accountId: 'acc_work',
            },
            priority: 50,
          } as BindingRule,
        ],
        session: {
          dmScope: 'per-account-channel-peer',
          identityLinks: {
            'admin-user': [
              'telegram:admin123',
              'discord:admin456',
            ],
          },
        },
      };

      // Test various scenarios
      const scenarios = [
        {
          name: 'Discord admin channel',
          input: {
            accountId: 'acc_default',
            chatId: 'admin-channel',
            senderId: 'user1',
            isGroup: true,
            guildId: '123456789',
            memberRoleIds: ['admin-role'],
            channel: 'discord',
          },
          expectedAgent: 'admin',
        },
        {
          name: 'Discord dev channel',
          input: {
            accountId: 'acc_default',
            chatId: 'dev-general',
            senderId: 'user2',
            isGroup: true,
            guildId: '123456789',
            channel: 'discord',
          },
          expectedAgent: 'coder',
        },
        {
          name: 'Telegram support group',
          input: {
            accountId: 'acc_default',
            chatId: '-100support',
            senderId: 'user3',
            isGroup: true,
            channel: 'telegram',
          },
          expectedAgent: 'support',
        },
        {
          name: 'Telegram work account DM',
          input: {
            accountId: 'acc_work',
            chatId: '123456',
            senderId: 'user4',
            isGroup: false,
            channel: 'telegram',
          },
          expectedAgent: 'main',
        },
        {
          name: 'Telegram personal account DM (default)',
          input: {
            accountId: 'acc_personal',
            chatId: '123456',
            senderId: 'user5',
            isGroup: false,
            channel: 'telegram',
          },
          expectedAgent: 'main',
        },
      ];

      for (const scenario of scenarios) {
        const conversationId = generateConversationIdWithRouting(
          scenario.input as any,
          config
        );
        const parsed = getConversationRouting(conversationId);
        
        expect(parsed?.agentId).toBe(
          scenario.expectedAgent,
          `${scenario.name} should route to ${scenario.expectedAgent}`
        );
      }
    });
  });
});
