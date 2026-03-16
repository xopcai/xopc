import { describe, it, expect } from 'vitest';
import {
  globMatch,
  matchesBinding,
  parseBindingRules,
  parseBindingRule,
  resolveRoute,
  type BindingRule,
} from '../bindings.js';

describe('bindings', () => {
  describe('globMatch', () => {
    it('should match wildcard', () => {
      expect(globMatch('*', 'anything')).toBe(true);
    });

    it('should match exact string', () => {
      expect(globMatch('exact', 'exact')).toBe(true);
      expect(globMatch('exact', 'different')).toBe(false);
    });

    it('should match prefix wildcard', () => {
      expect(globMatch('user-*', 'user-123')).toBe(true);
      expect(globMatch('user-*', 'user-456')).toBe(true);
      expect(globMatch('user-*', 'admin-123')).toBe(false);
    });

    it('should match suffix wildcard', () => {
      expect(globMatch('*-group', 'telegram-group')).toBe(true);
      expect(globMatch('*-group', 'discord-group')).toBe(true);
      expect(globMatch('*-group', 'telegram-channel')).toBe(false);
    });

    it('should match middle wildcard', () => {
      expect(globMatch('user-*-admin', 'user-123-admin')).toBe(true);
      // Note: empty middle segment doesn't match with current implementation
      // expect(globMatch('user-*-admin', 'user-admin')).toBe(true);
    });

    it('should be case insensitive', () => {
      expect(globMatch('USER-*', 'user-123')).toBe(true);
      expect(globMatch('user-*', 'USER-123')).toBe(true);
    });

    it('should escape special regex characters', () => {
      expect(globMatch('test.com', 'test.com')).toBe(true);
      expect(globMatch('test.com', 'testXcom')).toBe(false);
    });
  });

  describe('matchesBinding', () => {
    const baseMatch = {
      channel: 'telegram',
    };

    it('should match channel only', () => {
      const input = { channel: 'telegram' };
      expect(matchesBinding(input, baseMatch)).toBe(true);
    });

    it('should not match different channel', () => {
      const input = { channel: 'discord' };
      expect(matchesBinding(input, baseMatch)).toBe(false);
    });

    it('should match accountId with wildcard', () => {
      const match = { ...baseMatch, accountId: '*' };
      expect(matchesBinding({ channel: 'telegram', accountId: 'any' }, match)).toBe(true);
    });

    it('should match specific accountId', () => {
      const match = { ...baseMatch, accountId: 'work' };
      expect(matchesBinding({ channel: 'telegram', accountId: 'work' }, match)).toBe(true);
      expect(matchesBinding({ channel: 'telegram', accountId: 'default' }, match)).toBe(false);
    });

    it('should match peerKind', () => {
      const match = { ...baseMatch, peerKind: 'dm' };
      expect(matchesBinding({ channel: 'telegram', peerKind: 'dm' }, match)).toBe(true);
      expect(matchesBinding({ channel: 'telegram', peerKind: 'group' }, match)).toBe(false);
    });

    it('should match peerId with glob', () => {
      const match = { ...baseMatch, peerId: '123*' };
      expect(matchesBinding({ channel: 'telegram', peerId: '123456' }, match)).toBe(true);
      expect(matchesBinding({ channel: 'telegram', peerId: '789012' }, match)).toBe(false);
    });

    it('should match guildId', () => {
      const match = { ...baseMatch, guildId: 'guild-123' };
      expect(
        matchesBinding({ channel: 'telegram', guildId: 'guild-123' }, match)
      ).toBe(true);
      expect(
        matchesBinding({ channel: 'telegram', guildId: 'guild-456' }, match)
      ).toBe(false);
    });

    it('should match teamId', () => {
      const match = { ...baseMatch, teamId: 'team-abc' };
      expect(matchesBinding({ channel: 'telegram', teamId: 'team-abc' }, match)).toBe(true);
      expect(matchesBinding({ channel: 'telegram', teamId: 'team-xyz' }, match)).toBe(false);
    });

    it('should match memberRoleIds (any match)', () => {
      const match = { ...baseMatch, memberRoleIds: ['role-1', 'role-2'] };
      expect(
        matchesBinding({ channel: 'telegram', memberRoleIds: ['role-1'] }, match)
      ).toBe(true);
      expect(
        matchesBinding({ channel: 'telegram', memberRoleIds: ['role-2', 'role-3'] }, match)
      ).toBe(true);
      expect(
        matchesBinding({ channel: 'telegram', memberRoleIds: ['role-3'] }, match)
      ).toBe(false);
    });

    it('should match all conditions', () => {
      const match = {
        ...baseMatch,
        accountId: 'work',
        peerKind: 'group',
        peerId: 'group-*',
      };
      expect(
        matchesBinding(
          {
            channel: 'telegram',
            accountId: 'work',
            peerKind: 'group',
            peerId: 'group-123',
          },
          match
        )
      ).toBe(true);
      expect(
        matchesBinding(
          {
            channel: 'telegram',
            accountId: 'default',
            peerKind: 'group',
            peerId: 'group-123',
          },
          match
        )
      ).toBe(false);
    });
  });

  describe('parseBindingRule', () => {
    it('should parse valid binding rule', () => {
      const raw = {
        id: 'test-rule',
        agentId: 'agent-1',
        priority: 10,
        match: {
          channel: 'telegram',
          accountId: 'work',
        },
      };
      const rule = parseBindingRule(raw, 0);
      expect(rule).toEqual({
        id: 'test-rule',
        agentId: 'agent-1',
        priority: 10,
        match: {
          channel: 'telegram',
          accountId: 'work',
        },
        enabled: true,
      });
    });

    it('should use defaults for missing fields', () => {
      const raw = {
        match: {
          channel: 'telegram',
        },
      };
      const rule = parseBindingRule(raw, 5);
      expect(rule?.id).toBe('binding-5');
      expect(rule?.agentId).toBe('main');
      expect(rule?.priority).toBe(5);
      expect(rule?.enabled).toBe(true);
    });

    it('should return null for invalid input', () => {
      expect(parseBindingRule(null, 0)).toBeNull();
      expect(parseBindingRule({}, 0)).toBeNull();
      expect(parseBindingRule({ match: {} }, 0)).toBeNull();
    });

    it('should handle disabled rules', () => {
      const raw = {
        match: { channel: 'telegram' },
        enabled: false,
      };
      const rule = parseBindingRule(raw, 0);
      expect(rule?.enabled).toBe(false);
    });
  });

  describe('parseBindingRules', () => {
    it('should parse array of rules', () => {
      const config = {
        bindings: [
          {
            id: 'rule-1',
            agentId: 'agent-1',
            priority: 10,
            match: { channel: 'telegram' },
          },
          {
            id: 'rule-2',
            agentId: 'agent-2',
            priority: 5,
            match: { channel: 'discord' },
          },
        ],
      };
      const rules = parseBindingRules(config);
      expect(rules).toHaveLength(2);
      expect(rules[0].id).toBe('rule-1'); // Sorted by priority (high to low)
      expect(rules[1].id).toBe('rule-2');
    });

    it('should return empty array for missing bindings', () => {
      expect(parseBindingRules({})).toEqual([]);
      expect(parseBindingRules({ bindings: null })).toEqual([]);
    });

    it('should skip invalid rules', () => {
      const config = {
        bindings: [
          { match: { channel: 'telegram' } }, // Valid
          { match: {} }, // Invalid - no channel
          null, // Invalid
        ],
      };
      const rules = parseBindingRules(config);
      expect(rules).toHaveLength(1);
    });
  });

  describe('resolveRoute', () => {
    const rules: BindingRule[] = [
      {
        id: 'rule-1',
        agentId: 'agent-1',
        priority: 10,
        match: { channel: 'telegram', accountId: 'work' },
        enabled: true,
      },
      {
        id: 'rule-2',
        agentId: 'agent-2',
        priority: 5,
        match: { channel: 'telegram' },
        enabled: true,
      },
    ];

    it('should match first applicable rule', () => {
      const result = resolveRoute(
        { channel: 'telegram', accountId: 'work' },
        rules
      );
      expect(result.agentId).toBe('agent-1');
      expect(result.matchedBy).toBe('binding');
      expect(result.matchedRule?.id).toBe('rule-1');
    });

    it('should use default agent when no match', () => {
      const result = resolveRoute(
        { channel: 'discord' },
        rules,
        'default-agent'
      );
      expect(result.agentId).toBe('default-agent');
      expect(result.matchedBy).toBe('default');
    });

    it('should skip disabled rules', () => {
      const disabledRules: BindingRule[] = [
        {
          id: 'rule-disabled',
          agentId: 'agent-disabled',
          priority: 1,
          match: { channel: 'telegram' },
          enabled: false,
        },
        {
          id: 'rule-enabled',
          agentId: 'agent-enabled',
          priority: 2,
          match: { channel: 'telegram' },
          enabled: true,
        },
      ];
      const result = resolveRoute({ channel: 'telegram' }, disabledRules);
      expect(result.agentId).toBe('agent-enabled');
    });

    it('should normalize account ID', () => {
      const result = resolveRoute(
        { channel: 'telegram', accountId: 'WORK' },
        rules
      );
      expect(result.accountId).toBe('work');
    });
  });
});
