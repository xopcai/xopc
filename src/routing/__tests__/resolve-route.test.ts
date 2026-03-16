import { describe, it, expect } from 'vitest';
import {
  applyIdentityLinks,
  getDefaultAgentId,
  agentExists,
  pickFirstExistingAgentId,
  buildRouteSessionKey,
  deriveLastRoutePolicy,
  resolveRoute,
  resolveRouteFromSessionKey,
  type RoutingConfig,
} from '../resolve-route.js';

describe('resolve-route', () => {
  describe('applyIdentityLinks', () => {
    const identityLinks: Record<string, string[]> = {
      'john-doe': ['telegram:123456', 'discord:789012', 'john@example.com'],
      'jane-smith': ['telegram:654321', 'jane@example.com'],
    };

    it('should return lowercase peerId when no identity links', () => {
      expect(applyIdentityLinks('USER123', 'telegram')).toBe('user123');
    });

    it('should resolve canonical name from alias', () => {
      expect(applyIdentityLinks('telegram:123456', 'telegram', identityLinks)).toBe('john-doe');
      expect(applyIdentityLinks('discord:789012', 'discord', identityLinks)).toBe('john-doe');
    });

    it('should handle email aliases', () => {
      expect(applyIdentityLinks('john@example.com', 'telegram', identityLinks)).toBe('john-doe');
    });

    it('should return original if no match', () => {
      expect(applyIdentityLinks('unknown-user', 'telegram', identityLinks)).toBe('unknown-user');
    });

    it('should handle empty identity links', () => {
      expect(applyIdentityLinks('user123', 'telegram', {})).toBe('user123');
      expect(applyIdentityLinks('user123', 'telegram', undefined)).toBe('user123');
    });

    it('should handle empty peerId', () => {
      expect(applyIdentityLinks('', 'telegram', identityLinks)).toBe('');
    });
  });

  describe('getDefaultAgentId', () => {
    it('should return configured default', () => {
      const config: RoutingConfig = { agents: { default: 'custom-agent' } };
      expect(getDefaultAgentId(config)).toBe('custom-agent');
    });

    it('should return "main" when no default configured', () => {
      expect(getDefaultAgentId({})).toBe('main');
      expect(getDefaultAgentId({ agents: {} })).toBe('main');
    });
  });

  describe('agentExists', () => {
    const config: RoutingConfig = {
      agents: {
        list: [
          { id: 'main', enabled: true },
          { id: 'agent-1', enabled: true },
          { id: 'agent-2', enabled: false },
        ],
      },
    };

    it('should return true for existing enabled agent', () => {
      expect(agentExists('main', config)).toBe(true);
      expect(agentExists('agent-1', config)).toBe(true);
    });

    it('should return false for disabled agent', () => {
      expect(agentExists('agent-2', config)).toBe(false);
    });

    it('should return false for non-existent agent', () => {
      expect(agentExists('unknown', config)).toBe(false);
    });

    it('should return true when no list configured', () => {
      expect(agentExists('any-agent', {})).toBe(true);
    });

    it('should be case insensitive', () => {
      expect(agentExists('MAIN', config)).toBe(true);
      expect(agentExists('Agent-1', config)).toBe(true);
    });
  });

  describe('pickFirstExistingAgentId', () => {
    const config: RoutingConfig = {
      agents: {
        default: 'fallback',
        list: [
          { id: 'main', enabled: true },
          { id: 'disabled', enabled: false },
        ],
      },
    };

    it('should return agentId if it exists', () => {
      expect(pickFirstExistingAgentId('main', config)).toBe('main');
    });

    it('should return default if agent does not exist', () => {
      expect(pickFirstExistingAgentId('unknown', config)).toBe('fallback');
    });

    it('should return default if agent is disabled', () => {
      expect(pickFirstExistingAgentId('disabled', config)).toBe('fallback');
    });

    it('should return default for empty input', () => {
      expect(pickFirstExistingAgentId('', config)).toBe('fallback');
    });
  });

  describe('buildRouteSessionKey', () => {
    it('should build session key with all params', () => {
      const key = buildRouteSessionKey(
        'main',
        'telegram',
        'default',
        'dm',
        '123456',
        'thread-1',
        'scope-1'
      );
      expect(key).toBe('main:telegram:default:dm:123456:thread:thread-1:scope:scope-1');
    });

    it('should build session key without optional params', () => {
      const key = buildRouteSessionKey('main', 'telegram', 'default', 'dm', '123456');
      expect(key).toBe('main:telegram:default:dm:123456');
    });
  });

  describe('deriveLastRoutePolicy', () => {
    it('should return "main" when sessionKey equals mainSessionKey', () => {
      expect(deriveLastRoutePolicy('key', 'key')).toBe('main');
    });

    it('should return "session" when different', () => {
      expect(deriveLastRoutePolicy('session-key', 'main-key')).toBe('session');
    });
  });

  describe('resolveRoute', () => {
    const baseConfig: RoutingConfig = {
      agents: {
        default: 'main',
      },
      bindings: [
        {
          id: 'work-rule',
          agentId: 'work-agent',
          priority: 10,
          match: {
            channel: 'telegram',
            accountId: 'work',
          },
        },
        {
          id: 'default-rule',
          agentId: 'main',
          priority: 100,
          match: {
            channel: 'telegram',
          },
        },
      ],
    };

    it('should resolve route with binding match', () => {
      const result = resolveRoute({
        config: baseConfig,
        channel: 'telegram',
        accountId: 'work',
        peerKind: 'dm',
        peerId: '123456',
      });

      // default-rule has higher priority (100) than work-rule (10)
      expect(result.agentId).toBe('main');
      expect(result.matchedBy).toBe('binding');
      expect(result.accountId).toBe('work');
    });

    it('should resolve route with default agent', () => {
      const result = resolveRoute({
        config: baseConfig,
        channel: 'telegram',
        accountId: 'default',
        peerKind: 'dm',
        peerId: '123456',
      });

      expect(result.agentId).toBe('main');
      expect(result.matchedBy).toBe('binding');
    });

    it('should handle DM session with main scope', () => {
      const config: RoutingConfig = {
        ...baseConfig,
        session: {
          dmScope: 'main',
        },
      };

      const result = resolveRoute({
        config,
        channel: 'telegram',
        peerKind: 'dm',
        peerId: '123456',
      });

      expect(result.sessionKey).toBe(result.mainSessionKey);
      expect(result.lastRoutePolicy).toBe('main');
    });

    it('should handle DM session with per-peer scope', () => {
      const config: RoutingConfig = {
        ...baseConfig,
        session: {
          dmScope: 'per-peer',
        },
      };

      const result = resolveRoute({
        config,
        channel: 'telegram',
        peerKind: 'dm',
        peerId: '123456',
      });

      expect(result.sessionKey).not.toBe(result.mainSessionKey);
      expect(result.sessionKey).toContain('123456');
      expect(result.lastRoutePolicy).toBe('session');
    });

    it('should handle group session', () => {
      const result = resolveRoute({
        config: baseConfig,
        channel: 'telegram',
        peerKind: 'group',
        peerId: 'group-123',
      });

      expect(result.sessionKey).toContain('group:group-123');
    });

    it('should handle thread in session key', () => {
      const result = resolveRoute({
        config: baseConfig,
        channel: 'telegram',
        peerKind: 'channel',
        peerId: 'channel-123',
        threadId: 'thread-456',
      });

      expect(result.sessionKey).toContain(':thread:thread-456');
    });

    it('should apply identity links', () => {
      const config: RoutingConfig = {
        ...baseConfig,
        session: {
          identityLinks: {
            'canonical-user': ['telegram:123456'],
          },
          dmScope: 'per-peer', // Use per-peer scope to preserve peerId
        },
      };

      const result = resolveRoute({
        config,
        channel: 'telegram',
        peerKind: 'dm',
        peerId: '123456',
      });

      expect(result.sessionKey).toContain('canonical-user');
    });

    it('should normalize values to lowercase', () => {
      const config: RoutingConfig = {
        agents: { default: 'main' },
        bindings: [], // No bindings to interfere
        session: {
          dmScope: 'per-peer',
        },
      };

      const result = resolveRoute({
        config,
        channel: 'TELEGRAM',
        accountId: 'WORK',
        peerKind: 'DM',
        peerId: 'USER123',
      });

      expect(result.sessionKey).toBe('main:telegram:work:dm:user123');
    });
  });

  describe('resolveRouteFromSessionKey', () => {
    it('should parse session key back to route info', () => {
      const sessionKey = 'main:telegram:default:dm:123456:thread:789';
      const result = resolveRouteFromSessionKey(sessionKey, {});

      expect(result).toEqual({
        agentId: 'main',
        source: 'telegram',
        accountId: 'default',
        peerKind: 'dm',
        peerId: '123456',
      });
    });

    it('should return null for invalid session key', () => {
      expect(resolveRouteFromSessionKey('invalid', {})).toBeNull();
      expect(resolveRouteFromSessionKey('', {})).toBeNull();
    });
  });
});
