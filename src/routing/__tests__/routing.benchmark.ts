/**
 * Routing System Benchmark Tests
 * 
 * Performance benchmarks for:
 * - Session key generation
 * - Route resolution
 * - Binding matching
 * - Identity links application
 * - Memory usage
 */

import { describe, it, expect, bench } from 'vitest';
import {
  buildSessionKey,
  parseSessionKey,
  resolveRoute,
  applyIdentityLinks,
  type BindingRule,
  type RouteContext,
} from '../index.js';
import { generateSessionKeyWithRouting } from '../../channels/telegram/routing-integration.js';
import type { Config } from '../../config/schema.js';

// =============================================================================
// Session Key Generation Benchmarks
// =============================================================================

describe('Routing Benchmarks', () => {
  describe('Session Key Generation', () => {
    bench('buildSessionKey - basic', () => {
      buildSessionKey({
        agentId: 'main',
        source: 'telegram',
        accountId: 'acc_default',
        peerKind: 'dm',
        peerId: '123456',
      });
    });

    bench('buildSessionKey - with thread', () => {
      buildSessionKey({
        agentId: 'main',
        source: 'discord',
        accountId: 'acc_work',
        peerKind: 'channel',
        peerId: '987654',
        threadId: '789',
      });
    });

    bench('buildSessionKey - with all options', () => {
      buildSessionKey({
        agentId: 'main',
        source: 'telegram',
        accountId: 'acc_default',
        peerKind: 'group',
        peerId: '-1001234567',
        threadId: '999',
        scopeId: 'project-a',
      });
    });

    bench('buildSessionKey - sanitize input', () => {
      buildSessionKey({
        agentId: 'Main Agent!',
        source: 'telegram',
        accountId: 'acc_@default',
        peerKind: 'dm',
        peerId: 'user-123',
      });
    });
  });

  describe('Session Key Parsing', () => {
    const simpleKey = 'main:telegram:acc_default:dm:123456';
    const complexKey = 'main:telegram:acc_default:group:-1001234567:thread:999:scope:project-a';
    const acpKey = 'main:acp:550e8400-e29b-41d4-a716-446655440000';

    bench('parseSessionKey - simple', () => {
      parseSessionKey(simpleKey);
    });

    bench('parseSessionKey - complex', () => {
      parseSessionKey(complexKey);
    });

    bench('parseSessionKey - ACP', () => {
      parseSessionKey(acpKey);
    });

    bench('parseSessionKey - invalid', () => {
      parseSessionKey('invalid-key');
    });
  });

  // =============================================================================
  // Route Resolution Benchmarks
  // =============================================================================

  describe('Route Resolution', () => {
    const createContext = (overrides: Partial<RouteContext> = {}): RouteContext => ({
      channel: 'telegram',
      peerKind: 'dm',
      peerId: '123456',
      ...overrides,
    });

    bench('resolveRoute - no bindings', () => {
      resolveRoute([], createContext(), 'main');
    });

    bench('resolveRoute - single binding match', () => {
      const bindings: BindingRule[] = [
        {
          agentId: 'coder',
          match: { channel: 'telegram' },
          priority: 100,
        },
      ];
      resolveRoute(bindings, createContext(), 'main');
    });

    bench('resolveRoute - multiple bindings (10)', () => {
      const bindings: BindingRule[] = Array.from({ length: 10 }, (_, i) => ({
        agentId: `agent-${i}`,
        match: { channel: 'telegram', peerId: `-${i}` },
        priority: i * 10,
      }));
      resolveRoute(bindings, createContext(), 'main');
    });

    bench('resolveRoute - multiple bindings (100)', () => {
      const bindings: BindingRule[] = Array.from({ length: 100 }, (_, i) => ({
        agentId: `agent-${i}`,
        match: { channel: 'telegram', peerId: `-${i}` },
        priority: i * 10,
      }));
      resolveRoute(bindings, createContext(), 'main');
    });

    bench('resolveRoute - glob pattern match', () => {
      const bindings: BindingRule[] = [
        {
          agentId: 'wildcard-bot',
          match: { channel: 'telegram', peerId: '-100*' },
          priority: 100,
        },
      ];
      resolveRoute(bindings, createContext({ peerKind: 'group', peerId: '-1001234567' }), 'main');
    });

    bench('resolveRoute - role-based match', () => {
      const bindings: BindingRule[] = [
        {
          agentId: 'admin-bot',
          match: {
            channel: 'discord',
            guildId: '123456789',
            memberRoleIds: ['admin-role'],
          },
          priority: 100,
        },
      ];
      resolveRoute(
        bindings,
        createContext({
          channel: 'discord',
          peerKind: 'group',
          guildId: '123456789',
          memberRoleIds: ['admin-role', 'user-role'],
        }),
        'main'
      );
    });
  });

  // =============================================================================
  // Identity Links Benchmarks
  // =============================================================================

  describe('Identity Links Application', () => {
    const baseSessionKey = 'main:telegram:acc_default:dm:123456';
    
    const smallIdentityLinks = {
      'alice': ['telegram:123456'],
      'bob': ['telegram:789012'],
    };

    const largeIdentityLinks = Object.fromEntries(
      Array.from({ length: 100 }, (_, i) => [
        `user-${i}`,
        [`telegram:${100000 + i}`, `discord:${200000 + i}`],
      ])
    );

    bench('applyIdentityLinks - no match', () => {
      applyIdentityLinks(baseSessionKey, smallIdentityLinks, {
        channel: 'telegram',
        peerId: '999999',
      });
    });

    bench('applyIdentityLinks - small map match', () => {
      applyIdentityLinks(baseSessionKey, smallIdentityLinks, {
        channel: 'telegram',
        peerId: '123456',
      });
    });

    bench('applyIdentityLinks - large map no match', () => {
      applyIdentityLinks(baseSessionKey, largeIdentityLinks, {
        channel: 'telegram',
        peerId: '999999',
      });
    });

    bench('applyIdentityLinks - large map match', () => {
      applyIdentityLinks(baseSessionKey, largeIdentityLinks, {
        channel: 'telegram',
        peerId: '100050',
      });
    });
  });

  // =============================================================================
  // Integration Benchmarks
  // =============================================================================

  describe('Telegram Integration', () => {
    const config: Config = {
      agents: { default: 'main' },
      bindings: [],
      session: { dmScope: 'per-account-channel-peer' },
    };

    const configWithBindings: Config = {
      agents: { default: 'main' },
      bindings: [
        {
          agentId: 'coder',
          match: { channel: 'telegram', peerId: '-100*' },
          priority: 100,
        },
        {
          agentId: 'researcher',
          match: { channel: 'telegram', peerKind: 'group' },
          priority: 50,
        },
      ],
      session: {
        dmScope: 'per-account-channel-peer',
        identityLinks: {
          'alice': ['telegram:789012'],
        },
      },
    };

    bench('generateSessionKeyWithRouting - simple', () => {
      generateSessionKeyWithRouting(
        {
          accountId: 'acc_default',
          chatId: '123456',
          senderId: '789012',
          isGroup: false,
        },
        config
      );
    });

    bench('generateSessionKeyWithRouting - with bindings', () => {
      generateSessionKeyWithRouting(
        {
          accountId: 'acc_default',
          chatId: '-1001234567',
          senderId: '789012',
          isGroup: true,
        },
        configWithBindings
      );
    });

    bench('generateSessionKeyWithRouting - with identity links', () => {
      generateSessionKeyWithRouting(
        {
          accountId: 'acc_default',
          chatId: '123456',
          senderId: '789012',
          isGroup: false,
        },
        configWithBindings
      );
    });
  });

  // =============================================================================
  // Stress Tests
  // =============================================================================

  describe('Stress Tests', () => {
    bench('Stress: 1000 session keys generation', () => {
      for (let i = 0; i < 1000; i++) {
        buildSessionKey({
          agentId: 'main',
          source: 'telegram',
          accountId: `acc_${i % 10}`,
          peerKind: i % 2 === 0 ? 'dm' : 'group',
          peerId: `${i}`,
        });
      }
    });

    bench('Stress: 1000 route resolutions', () => {
      const bindings: BindingRule[] = Array.from({ length: 20 }, (_, i) => ({
        agentId: `agent-${i}`,
        match: { channel: 'telegram', peerId: `${i}` },
        priority: i,
      }));

      for (let i = 0; i < 1000; i++) {
        resolveRoute(
          bindings,
          {
            channel: 'telegram',
            peerKind: 'dm',
            peerId: `${i % 100}`,
          },
          'main'
        );
      }
    });

    bench('Stress: 1000 identity links applications', () => {
      const identityLinks = Object.fromEntries(
        Array.from({ length: 50 }, (_, i) => [
          `user-${i}`,
          [`telegram:${i}`, `discord:${i + 1000}`],
        ])
      );

      for (let i = 0; i < 1000; i++) {
        applyIdentityLinks(
          'main:telegram:acc_default:dm:xxx',
          identityLinks,
          {
            channel: 'telegram',
            peerId: `${i % 50}`,
          }
        );
      }
    });
  });

  // =============================================================================
  // Memory Benchmarks (indirect via iterations)
  // =============================================================================

  describe('Memory Efficiency', () => {
    bench('Memory: parse 10000 keys', () => {
      const keys = Array.from({ length: 10000 }, (_, i) => 
        `main:telegram:acc_default:dm:${i}`
      );

      for (const key of keys) {
        parseSessionKey(key);
      }
    });

    bench('Memory: build 10000 keys', () => {
      for (let i = 0; i < 10000; i++) {
        buildSessionKey({
          agentId: 'main',
          source: 'telegram',
          accountId: 'acc_default',
          peerKind: 'dm',
          peerId: `${i}`,
        });
      }
    });
  });

  // =============================================================================
  // Performance Validation Tests
  // =============================================================================

  describe('Performance Validation', () => {
    it('should generate session key in < 100μs', () => {
      const start = performance.now();
      for (let i = 0; i < 100; i++) {
        buildSessionKey({
          agentId: 'main',
          source: 'telegram',
          accountId: 'acc_default',
          peerKind: 'dm',
          peerId: '123456',
        });
      }
      const duration = performance.now() - start;
      const avgMs = duration / 100;
      
      expect(avgMs).toBeLessThan(0.1); // 100μs = 0.1ms
    });

    it('should parse session key in < 50μs', () => {
      const start = performance.now();
      const key = 'main:telegram:acc_default:dm:123456:thread:789';
      
      for (let i = 0; i < 100; i++) {
        parseSessionKey(key);
      }
      
      const duration = performance.now() - start;
      const avgMs = duration / 100;
      
      expect(avgMs).toBeLessThan(0.05); // 50μs = 0.05ms
    });

    it('should resolve route with 100 bindings in < 1ms', () => {
      const bindings: BindingRule[] = Array.from({ length: 100 }, (_, i) => ({
        agentId: `agent-${i}`,
        match: { channel: 'telegram', peerId: `${i}` },
        priority: i,
      }));

      const start = performance.now();
      for (let i = 0; i < 10; i++) {
        resolveRoute(
          bindings,
          {
            channel: 'telegram',
            peerKind: 'dm',
            peerId: '50',
          },
          'main'
        );
      }
      
      const duration = performance.now() - start;
      const avgMs = duration / 10;
      
      expect(avgMs).toBeLessThan(1);
    });

    it('should apply identity links with 1000 users in < 5ms', () => {
      const identityLinks = Object.fromEntries(
        Array.from({ length: 1000 }, (_, i) => [
          `user-${i}`,
          [`telegram:${i}`],
        ])
      );

      const start = performance.now();
      for (let i = 0; i < 10; i++) {
        applyIdentityLinks(
          'main:telegram:acc_default:dm:xxx',
          identityLinks,
          {
            channel: 'telegram',
            peerId: '500',
          }
        );
      }
      
      const duration = performance.now() - start;
      const avgMs = duration / 10;
      
      expect(avgMs).toBeLessThan(5);
    });
  });
});
