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
import {
  buildSessionKey,
  parseSessionKey,
  type BindingRule,
} from '../routing/index.js';
import { generateSessionKeyWithRouting } from '../channels/telegram/index.js';
import { buildAcpSessionKey } from '../acp/routing-integration.js';

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
      const sessionKey = generateSessionKeyWithRouting(
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
      const parsed = parseSessionKey(sessionKey);
      expect(parsed).toBeTruthy();
      expect(parsed?.agentId).toBe('main');
      expect(parsed?.peerKind).toBe('dm');
    });
  });

  describe('Scenario 2: Group Message with Binding Routing', () => {
    it('should route group message to specialized agent', () => {
      const config: Config = {
        agents: {
          default: 'main',
          list: [
            { id: 'main', name: 'Main Assistant' },
            { id: 'coder', name: 'Coding Assistant' },
            { id: 'researcher', name: 'Research Assistant' },
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

      const sessionKey1 = generateSessionKeyWithRouting(
        {
          accountId: programmingGroupMsg.accountId,
          chatId: programmingGroupMsg.chatId,
          senderId: programmingGroupMsg.senderId,
          isGroup: programmingGroupMsg.isGroup,
        },
        config
      );

      const parsed1 = parseSessionKey(sessionKey1);
      expect(parsed1?.agentId).toBe('coder');

      // Message to research group
      const researchGroupMsg = {
        accountId: 'acc_default',
        chatId: '-1002222222',
        senderId: '789012',
        isGroup: true,
        content: 'Find papers about AI',
      };

      const sessionKey2 = generateSessionKeyWithRouting(
        {
          accountId: researchGroupMsg.accountId,
          chatId: researchGroupMsg.chatId,
          senderId: researchGroupMsg.senderId,
          isGroup: researchGroupMsg.isGroup,
        },
        config
      );

      const parsed2 = parseSessionKey(sessionKey2);
      expect(parsed2?.agentId).toBe('researcher');

      // Message to general group (default routing)
      const generalGroupMsg = {
        accountId: 'acc_default',
        chatId: '-1003333333',
        senderId: '789012',
        isGroup: true,
        content: 'General question',
      };

      const sessionKey3 = generateSessionKeyWithRouting(
        {
          accountId: generalGroupMsg.accountId,
          chatId: generalGroupMsg.chatId,
          senderId: generalGroupMsg.senderId,
          isGroup: generalGroupMsg.isGroup,
        },
        config
      );

      const parsed3 = parseSessionKey(sessionKey3);
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
      const aliceTgKey = generateSessionKeyWithRouting(
        {
          accountId: 'acc_default',
          chatId: 'channel1',
          senderId: '111111',
          isGroup: false,
        },
        config
      );

      // Alice sends message on Discord
      const aliceDiscordKey = generateSessionKeyWithRouting(
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
      const aliceFeishuKey = generateSessionKeyWithRouting(
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
      const tgParsed = parseSessionKey(aliceTgKey);
      const discordParsed = parseSessionKey(aliceDiscordKey);
      const feishuParsed = parseSessionKey(aliceFeishuKey);

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

      const personalKey = generateSessionKeyWithRouting(personalMsg, config);
      const workKey = generateSessionKeyWithRouting(workMsg, config);

      const personalParsed = parseSessionKey(personalKey);
      const workParsed = parseSessionKey(workKey);

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

      const sessionKey = generateSessionKeyWithRouting(
        {
          accountId: topicMsg.accountId,
          chatId: topicMsg.chatId,
          senderId: topicMsg.senderId,
          isGroup: topicMsg.isGroup,
          threadId: topicMsg.threadId,
        },
        config
      );

      expect(sessionKey).toContain(':thread:999');

      const parsed = parseSessionKey(sessionKey);
      expect(parsed?.threadId).toBe('999');

      // Verify thread messages are isolated from parent group
      const parentGroupKey = generateSessionKeyWithRouting(
        {
          accountId: topicMsg.accountId,
          chatId: topicMsg.chatId,
          senderId: topicMsg.senderId,
          isGroup: topicMsg.isGroup,
        },
        config
      );

      expect(parentGroupKey).not.toContain(':thread:');
      expect(parentGroupKey).not.toBe(sessionKey);
    });
  });

  describe('Scenario 6: ACP Session Flow', () => {
    it('should create and route ACP sessions', () => {
      const acpId = '550e8400-e29b-41d4-a716-446655440000';
      
      const acpSessionKey = buildAcpSessionKey({
        agentId: 'main',
        acpId,
      });

      expect(acpSessionKey).toBe(`main:acp:${acpId}`);

      const parsed = parseSessionKey(acpSessionKey);
      expect(parsed?.source).toBe('acp');
      expect(parsed?.agentId).toBe('main');

      // Verify ACP sessions are isolated from regular sessions
      const regularKey = buildSessionKey({
        agentId: 'main',
        source: 'telegram',
        accountId: 'acc_default',
        peerKind: 'dm',
        peerId: '123456',
      });

      expect(regularKey).not.toBe(acpSessionKey);
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
      const expertKey = generateSessionKeyWithRouting(
        {
          accountId: 'acc_default',
          chatId: '-1009999999',
          senderId: '789012',
          isGroup: true,
        },
        config
      );
      expect(parseSessionKey(expertKey)?.agentId).toBe('expert');

      // Should match specialist (group match, higher than generalist)
      const specialistKey = generateSessionKeyWithRouting(
        {
          accountId: 'acc_default',
          chatId: '-1001111111',
          senderId: '789012',
          isGroup: true,
        },
        config
      );
      expect(parseSessionKey(specialistKey)?.agentId).toBe('specialist');

      // Should match generalist (only channel match)
      const generalistKey = generateSessionKeyWithRouting(
        {
          accountId: 'acc_default',
          chatId: '123456',
          senderId: '789012',
          isGroup: false,
        },
        config
      );
      expect(parseSessionKey(generalistKey)?.agentId).toBe('generalist');
    });
  });

  describe('Scenario 8: Complex Real-World Setup', () => {
    it('should handle complex multi-channel, multi-agent setup', () => {
      const config: Config = {
        agents: {
          default: 'main',
          list: [
            { id: 'main', name: 'Main Assistant' },
            { id: 'coder', name: 'Coding Bot' },
            { id: 'support', name: 'Support Bot' },
            { id: 'admin', name: 'Admin Bot' },
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
        const sessionKey = generateSessionKeyWithRouting(
          scenario.input as any,
          config
        );
        const parsed = parseSessionKey(sessionKey);
        
        expect(parsed?.agentId).toBe(
          scenario.expectedAgent,
          `${scenario.name} should route to ${scenario.expectedAgent}`
        );
      }
    });
  });
});
