/**
 * Routing System E2E Tests
 * 
 * End-to-end tests for the complete routing flow:
 * - Inbound message → Route resolution → Session key generation → Identity links application
 */

import { describe, it, expect } from 'vitest';
import type { Config } from '../../config/schema.js';
import {
  buildSessionKey,
  parseSessionKey,
  resolveBindingRoute,
  type BindingRule,
  type RouteContext,
} from '../index.js';
import { generateSessionKeyWithRouting } from '../../channels/telegram/index.js';
import { buildAcpSessionKey, isAcpSessionKey } from '../../acp/routing-integration.js';

describe('Routing E2E', () => {
  describe('Complete Message Flow', () => {
    it('should route Telegram DM message correctly', () => {
      const config: Config = {
        agents: { default: 'main' },
        bindings: [],
        session: {
          dmScope: 'per-account-channel-peer',
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

      // Verify session key format
      const parsed = parseSessionKey(sessionKey);
      expect(parsed).toBeTruthy();
      expect(parsed?.agentId).toBe('main');
      expect(parsed?.source).toBe('telegram');
      expect(parsed?.peerKind).toBe('dm');
      expect(parsed?.peerId).toBe('789012');

      // Verify it can be used for routing back
      const routeContext: RouteContext = {
        channel: 'telegram',
        accountId: 'acc_default',
        peerKind: 'dm',
        peerId: '789012',
      };

      const route = resolveBindingRoute(routeContext, [], 'main');
      expect(route.agentId).toBe('main');
    });

    it('should route Telegram group message with binding', () => {
      const config: Config = {
        agents: {
          default: 'main',
          list: [
            { id: 'main', name: 'Main' },
            { id: 'researcher', name: 'Researcher' },
          ],
        },
        bindings: [
          {
            agentId: 'researcher',
            match: {
              channel: 'telegram',
              peerId: '-1001234567',
            },
            priority: 100,
          } as BindingRule,
        ],
        session: {
          dmScope: 'per-account-channel-peer',
        },
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

      const parsed = parseSessionKey(sessionKey);
      expect(parsed?.agentId).toBe('researcher');
      expect(parsed?.peerKind).toBe('group');
      expect(parsed?.peerId).toBe('-1001234567');
    });

    it('should apply identity links for cross-platform merging', () => {
      const config: Config = {
        agents: { default: 'main' },
        bindings: [],
        session: {
          dmScope: 'per-peer',
          identityLinks: {
            'alice': [
              'telegram:789012',
              'discord:987654',
              'feishu:ou_alice123',
            ],
          },
        },
      };

      // Telegram message from Alice
      const tgSessionKey = generateSessionKeyWithRouting(
        {
          accountId: 'acc_default',
          chatId: '123456',
          senderId: '789012',
          isGroup: false,
        },
        config
      );

      // Discord message from Alice
      const discordSessionKey = generateSessionKeyWithRouting(
        {
          accountId: 'acc_default',
          chatId: '555555',
          senderId: '987654',
          isGroup: false,
          channel: 'discord',
        },
        config
      );

      // Both should resolve to canonical name 'alice'
      const tgParsed = parseSessionKey(tgSessionKey);
      const discordParsed = parseSessionKey(discordSessionKey);

      expect(tgParsed?.peerId).toBe('alice');
      expect(discordParsed?.peerId).toBe('alice');

      // Different sources, same user
      expect(tgParsed?.source).toBe('telegram');
      expect(discordParsed?.source).toBe('discord');
    });

    it('should handle multi-account isolation', () => {
      const config: Config = {
        agents: { default: 'main' },
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

      // Personal account
      const personalKey = generateSessionKeyWithRouting(
        {
          accountId: 'acc_personal',
          chatId: '123456',
          senderId: '789012',
          isGroup: false,
        },
        config
      );

      // Work account
      const workKey = generateSessionKeyWithRouting(
        {
          accountId: 'acc_work',
          chatId: '123456',
          senderId: '789012',
          isGroup: false,
        },
        config
      );

      const personalParsed = parseSessionKey(personalKey);
      const workParsed = parseSessionKey(workKey);

      // Different agents
      expect(personalParsed?.agentId).toBe('main');
      expect(workParsed?.agentId).toBe('work-assistant');

      // Different account IDs
      expect(personalParsed?.accountId).toBe('acc_personal');
      expect(workParsed?.accountId).toBe('acc_work');
    });

    it('should handle thread messages', () => {
      const config: Config = {
        agents: { default: 'main' },
        bindings: [],
        session: {
          dmScope: 'per-account-channel-peer',
        },
      };

      const sessionKey = generateSessionKeyWithRouting(
        {
          accountId: 'acc_default',
          chatId: '-1001234567',
          senderId: '789012',
          isGroup: true,
          threadId: '999',
        },
        config
      );

      expect(sessionKey).toContain(':thread:999');

      const parsed = parseSessionKey(sessionKey);
      expect(parsed?.threadId).toBe('999');
    });
  });

  describe('Binding Priority and Matching', () => {
    it('should match highest priority binding', () => {
      const bindings: BindingRule[] = [
        {
          agentId: 'high-priority',
          match: { channel: 'telegram', peerId: '-100*' },
          priority: 100,
        },
        {
          agentId: 'medium-priority',
          match: { channel: 'telegram', peerKind: 'group' },
          priority: 50,
        },
        {
          agentId: 'low-priority',
          match: { channel: 'telegram' },
          priority: 10,
        },
      ];

      const context: RouteContext = {
        channel: 'telegram',
        peerKind: 'group',
        peerId: '-1001234567',
      };

      const route = resolveBindingRoute(context, bindings, 'main');
      expect(route.agentId).toBe('high-priority');
    });

    it('should support glob patterns in peerId', () => {
      const bindings: BindingRule[] = [
        {
          agentId: 'dev-bot',
          match: {
            channel: 'discord',
            peerId: 'dev-*',
          },
          priority: 100,
        } as BindingRule,
      ];

      const testCases = [
        { peerId: 'dev-123', shouldMatch: true },
        { peerId: 'dev-channel-456', shouldMatch: true },
        { peerId: 'prod-123', shouldMatch: false },
        { peerId: 'development', shouldMatch: false },
      ];

      for (const { peerId, shouldMatch } of testCases) {
        const context: RouteContext = {
          channel: 'discord',
          peerKind: 'channel',
          peerId,
        };

        const route = resolveBindingRoute(context, bindings, 'main');
        if (shouldMatch) {
          expect(route.agentId).toBe('dev-bot');
        } else {
          expect(route.agentId).toBe('main');
        }
      }
    });

    it('should handle role-based routing (Discord)', () => {
      const bindings: BindingRule[] = [
        {
          agentId: 'admin-bot',
          match: {
            channel: 'discord',
            guildId: '123456789',
            memberRoleIds: ['admin-role-1', 'admin-role-2'],
          },
          priority: 100,
        } as BindingRule,
      ];

      // User with admin role
      const contextWithRole: RouteContext = {
        channel: 'discord',
        peerKind: 'group',
        peerId: '987654',
        guildId: '123456789',
        memberRoleIds: ['admin-role-1', 'user-role'],
      };

      const routeWithRole = resolveBindingRoute(contextWithRole, bindings, 'main');
      expect(routeWithRole.agentId).toBe('admin-bot');

      // User without admin role
      const contextWithoutRole: RouteContext = {
        channel: 'discord',
        peerKind: 'group',
        peerId: '987654',
        guildId: '123456789',
        memberRoleIds: ['user-role'],
      };

      const routeWithoutRole = resolveBindingRoute(contextWithoutRole, bindings, 'main');
      expect(routeWithoutRole.agentId).toBe('main');
    });
  });

  describe('ACP Session Integration', () => {
    it('should create and validate ACP session', () => {
      const acpKey = buildAcpSessionKey({
        agentId: 'main',
        acpId: '550e8400-e29b-41d4-a716-446655440000',
      });

      expect(acpKey).toBe('main:acp:550e8400-e29b-41d4-a716-446655440000');
      expect(isAcpSessionKey(acpKey)).toBe(true);

      const parsed = parseSessionKey(acpKey);
      expect(parsed?.agentId).toBe('main');
      expect(parsed?.source).toBe('acp');
    });

    it('should handle subagent ACP sessions', () => {
      const subagentAcpKey = buildSessionKey({
        agentId: 'subagent:main:parent-123',
        source: 'acp',
        accountId: '_',
        peerKind: 'direct',
        peerId: 'child-456',
      });

      const parsed = parseSessionKey(subagentAcpKey);
      // sanitizeSegment replaces : with -, so agentId becomes 'subagent-main-parent-123'
      expect(parsed?.agentId).toBe('subagent-main-parent-123');
      expect(parsed?.source).toBe('acp');
    });
  });

  describe('Session Key Round-Trip', () => {
    it('should build and parse session key correctly', () => {
      const original = {
        agentId: 'main',
        source: 'telegram',
        accountId: 'acc_work',
        peerKind: 'group' as const,
        peerId: '-1001234567',
        threadId: '789',
        scopeId: 'project-a',
      };

      const sessionKey = buildSessionKey(original);
      const parsed = parseSessionKey(sessionKey);

      expect(parsed?.agentId).toBe(original.agentId);
      expect(parsed?.source).toBe(original.source);
      expect(parsed?.accountId).toBe(original.accountId);
      expect(parsed?.peerKind).toBe(original.peerKind);
      expect(parsed?.peerId).toBe(original.peerId);
      expect(parsed?.threadId).toBe(original.threadId);
      expect(parsed?.scopeId).toBe(original.scopeId);
    });

    it('should handle optional fields', () => {
      const sessionKey = buildSessionKey({
        agentId: 'main',
        source: 'telegram',
        accountId: '_',
        peerKind: 'dm',
        peerId: '123456',
      });

      const parsed = parseSessionKey(sessionKey);
      expect(parsed?.threadId).toBeUndefined();
      expect(parsed?.scopeId).toBeUndefined();
    });
  });

  describe('Edge Cases', () => {
    it('should handle empty bindings', () => {
      const config: Config = {
        agents: { default: 'main' },
        bindings: [],
        session: { dmScope: 'per-peer' },
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

      expect(sessionKey).toMatch(/^main:telegram:acc_default:dm:789012$/);
    });

    it('should handle missing accountId', () => {
      const sessionKey = buildSessionKey({
        agentId: 'main',
        source: 'telegram',
        accountId: null,
        peerKind: 'dm',
        peerId: '123456',
      });

      // sanitizeSegment returns 'default' for null/empty accountId
      expect(sessionKey).toContain(':default:dm:');
    });

    it('should sanitize invalid characters', () => {
      const sessionKey = buildSessionKey({
        agentId: 'Main Agent!',
        source: 'telegram',
        accountId: '_',
        peerKind: 'dm',
        peerId: '123',
      });

      // Should sanitize to valid format
      expect(sessionKey).toMatch(/^[a-z0-9_-]+:/);
    });

    it('should handle very long peer IDs', () => {
      const longPeerId = 'a'.repeat(100);
      const sessionKey = buildSessionKey({
        agentId: 'main',
        source: 'telegram',
        accountId: '_',
        peerKind: 'dm',
        peerId: longPeerId,
      });

      const parsed = parseSessionKey(sessionKey);
      // sanitizeSegment truncates to 64 characters
      expect(parsed?.peerId).toBe(longPeerId.slice(0, 64));
    });
  });
});
