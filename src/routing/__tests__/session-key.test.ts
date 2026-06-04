import { describe, it, expect } from 'vitest';
import {
  buildSessionKey,
  parseSessionKey,
  sanitizeSegment,
  isValidSegment,
  isSubagentSessionKey,
  isCronSessionKey,
  getSubagentDepth,
  buildSubagentSessionKey,
  getParentSessionKey,
  normalizeSessionKey,
  defaultMainSessionKey,
} from '../session-key.js';

describe('session-key', () => {
  describe('sanitizeSegment', () => {
    it('should return empty string for null/undefined/empty', () => {
      expect(sanitizeSegment(null)).toBe('');
      expect(sanitizeSegment(undefined)).toBe('');
      expect(sanitizeSegment('')).toBe('');
      expect(sanitizeSegment('   ')).toBe('');
    });

    it('should keep valid segments unchanged (lowercase)', () => {
      expect(sanitizeSegment('main')).toBe('main');
      expect(sanitizeSegment('telegram')).toBe('telegram');
      expect(sanitizeSegment('acc_default')).toBe('acc_default');
      expect(sanitizeSegment('user-123')).toBe('user-123');
    });

    it('should convert to lowercase', () => {
      expect(sanitizeSegment('MAIN')).toBe('main');
      expect(sanitizeSegment('Telegram')).toBe('telegram');
    });

    it('should replace invalid characters with dash', () => {
      expect(sanitizeSegment('user@123')).toBe('user-123');
      expect(sanitizeSegment('chat.id')).toBe('chat-id');
      expect(sanitizeSegment('group#1')).toBe('group-1');
    });

    it('should remove leading/trailing dashes', () => {
      expect(sanitizeSegment('-user-')).toBe('user');
      expect(sanitizeSegment('--test--')).toBe('test');
    });

    it('should truncate to 64 characters', () => {
      const long = 'a'.repeat(100);
      expect(sanitizeSegment(long)).toBe('a'.repeat(64));
    });
  });

  describe('isValidSegment', () => {
    it('should return false for empty/null/undefined', () => {
      expect(isValidSegment(null)).toBe(false);
      expect(isValidSegment('')).toBe(false);
    });

    it('should return true for valid segments', () => {
      expect(isValidSegment('main')).toBe(true);
      expect(isValidSegment('user-123')).toBe(true);
      expect(isValidSegment('acc_default')).toBe(true);
    });

    it('should return false for invalid segments', () => {
      expect(isValidSegment('user@123')).toBe(false);
      expect(isValidSegment('-user')).toBe(false);
      expect(isValidSegment('user-')).toBe(false);
    });
  });

  describe('defaultMainSessionKey', () => {
    it('should build main bucket key', () => {
      expect(defaultMainSessionKey('main')).toBe('agent:main:main');
    });
  });

  describe('buildSessionKey', () => {
    it('should build telegram DM session key', () => {
      const key = buildSessionKey({
        agentId: 'main',
        source: 'telegram',
        accountId: 'default',
        peerKind: 'dm',
        peerId: '123456',
      });
      expect(key).toBe('agent:main:telegram:default:direct:123456');
    });

    it('should build telegram group session key', () => {
      const key = buildSessionKey({
        agentId: 'main',
        source: 'telegram',
        accountId: 'default',
        peerKind: 'group',
        peerId: '-100123456',
      });
      expect(key).toBe('agent:main:telegram:group:-100123456');
    });

    it('should build webchat session key', () => {
      const key = buildSessionKey({
        agentId: 'main',
        source: 'webchat',
        accountId: 'default',
        peerKind: 'direct',
        peerId: 'chat_abc123',
      });
      expect(key).toBe('agent:main:webchat:default:direct:chat_abc123');
    });

    it('should build session key with thread', () => {
      const key = buildSessionKey({
        agentId: 'main',
        source: 'telegram',
        accountId: 'default',
        peerKind: 'dm',
        peerId: '123',
        threadId: '789',
      });
      expect(key).toBe('agent:main:telegram:default:direct:123:thread:789');
    });

    it('should build session key with scope', () => {
      const key = buildSessionKey({
        agentId: 'main',
        source: 'telegram',
        accountId: 'default',
        peerKind: 'dm',
        peerId: '123456',
        scopeId: 'scope1',
      });
      expect(key).toBe('agent:main:telegram:default:direct:123456:scope:scope1');
    });

    it('should normalize dm peerKind to direct', () => {
      const key = buildSessionKey({
        agentId: 'MAIN',
        source: 'Telegram',
        accountId: 'DEFAULT',
        peerKind: 'dm',
        peerId: 'USER@123',
      });
      expect(key).toBe('agent:main:telegram:default:direct:user@123');
    });

    it('should use defaults for missing required fields on group keys', () => {
      const key = buildSessionKey({
        agentId: '',
        source: '',
        accountId: '',
        peerKind: 'group',
        peerId: '',
      });
      expect(key).toBe('agent:main:unknown:group:unknown');
    });
  });

  describe('parseSessionKey', () => {
    it('should parse main bucket key', () => {
      const parsed = parseSessionKey('agent:main:main');
      expect(parsed).toEqual({
        agentId: 'main',
        source: 'cli',
        accountId: 'default',
        peerKind: 'direct',
        peerId: 'main',
      });
    });

    it('should parse telegram DM key', () => {
      const parsed = parseSessionKey('agent:main:telegram:default:direct:123456');
      expect(parsed).toEqual({
        agentId: 'main',
        source: 'telegram',
        accountId: 'default',
        peerKind: 'direct',
        peerId: '123456',
      });
    });

    it('should parse telegram group key', () => {
      const parsed = parseSessionKey('agent:main:telegram:group:-100123456');
      expect(parsed).toEqual({
        agentId: 'main',
        source: 'telegram',
        accountId: 'default',
        peerKind: 'group',
        peerId: '-100123456',
      });
    });

    it('should parse webchat key', () => {
      const parsed = parseSessionKey('agent:main:webchat:default:direct:chat_abc123');
      expect(parsed).toEqual({
        agentId: 'main',
        source: 'webchat',
        accountId: 'default',
        peerKind: 'direct',
        peerId: 'chat_abc123',
      });
    });

    it('should parse session key with thread', () => {
      const parsed = parseSessionKey('agent:main:telegram:default:direct:123:thread:789');
      expect(parsed).toEqual({
        agentId: 'main',
        source: 'telegram',
        accountId: 'default',
        peerKind: 'direct',
        peerId: '123',
        threadId: '789',
      });
    });

    it('should parse session key with scope', () => {
      const parsed = parseSessionKey('agent:main:telegram:default:direct:123456:scope:scope1');
      expect(parsed).toEqual({
        agentId: 'main',
        source: 'telegram',
        accountId: 'default',
        peerKind: 'direct',
        peerId: '123456',
        scopeId: 'scope1',
      });
    });

    it('should parse cron rest key', () => {
      const parsed = parseSessionKey('agent:main:cron:job-123');
      expect(parsed).toEqual({
        agentId: 'main',
        source: 'cron',
        accountId: 'default',
        peerKind: 'direct',
        peerId: 'job-123',
      });
    });

    it('should parse subagent key', () => {
      const parsed = parseSessionKey('agent:main:subagent:telegram:default:direct:123456');
      expect(parsed).toEqual({
        agentId: 'subagent',
        source: 'telegram',
        accountId: 'default',
        peerKind: 'direct',
        peerId: '123456',
      });
    });

    it('should return null for invalid keys', () => {
      expect(parseSessionKey(null)).toBeNull();
      expect(parseSessionKey('')).toBeNull();
      expect(parseSessionKey('invalid')).toBeNull();
      expect(parseSessionKey('main:telegram:default:dm:123456')).toBeNull();
      expect(parseSessionKey('agent:main')).toBeNull();
    });

    it('should handle case insensitivity', () => {
      const parsed = parseSessionKey('AGENT:MAIN:TELEGRAM:DEFAULT:DIRECT:123456');
      expect(parsed?.agentId).toBe('main');
      expect(parsed?.source).toBe('telegram');
    });
  });

  describe('isSubagentSessionKey', () => {
    it('should return true for subagent keys', () => {
      expect(isSubagentSessionKey('agent:main:subagent:telegram:default:direct:123456')).toBe(true);
    });

    it('should return false for non-subagent keys', () => {
      expect(isSubagentSessionKey('agent:main:telegram:default:direct:123456')).toBe(false);
    });
  });

  describe('isCronSessionKey', () => {
    it('should return true for cron keys', () => {
      expect(isCronSessionKey('agent:main:cron:job-123')).toBe(true);
    });

    it('should return false for non-cron keys', () => {
      expect(isCronSessionKey('agent:main:telegram:default:direct:123456')).toBe(false);
    });
  });

  describe('getSubagentDepth', () => {
    it('should return 0 for non-subagent keys', () => {
      expect(getSubagentDepth('agent:main:telegram:default:direct:123456')).toBe(0);
    });

    it('should return 1 for single subagent', () => {
      expect(getSubagentDepth('agent:main:subagent:telegram:default:direct:123456')).toBe(1);
    });

    it('should count nested subagents', () => {
      expect(
        getSubagentDepth('agent:main:subagent:telegram:default:direct:123:subagent:nested'),
      ).toBe(2);
    });
  });

  describe('buildSubagentSessionKey', () => {
    it('should build subagent session key from parent', () => {
      const parentKey = 'agent:main:telegram:default:direct:123456';
      const subKey = buildSubagentSessionKey({
        parentSessionKey: parentKey,
        agentId: 'main',
        source: 'telegram',
        accountId: 'default',
        peerKind: 'direct',
        peerId: '123456',
      });
      expect(subKey).toBe('agent:main:subagent:telegram:default:direct:123456');
    });

    it('should throw for invalid parent key', () => {
      expect(() =>
        buildSubagentSessionKey({
          parentSessionKey: 'main:telegram:default:dm:123456',
          agentId: 'main',
          source: 'telegram',
          accountId: 'default',
          peerKind: 'direct',
          peerId: '123456',
        }),
      ).toThrow();
    });
  });

  describe('getParentSessionKey', () => {
    it('should remove thread suffix', () => {
      const parent = getParentSessionKey('agent:main:telegram:default:direct:123:thread:789');
      expect(parent).toBe('agent:main:telegram:default:direct:123');
    });

    it('should return null for keys without thread', () => {
      expect(getParentSessionKey('agent:main:telegram:default:direct:123456')).toBeNull();
    });
  });

  describe('normalizeSessionKey', () => {
    it('should normalize to lowercase', () => {
      expect(normalizeSessionKey('AGENT:MAIN:TELEGRAM:DEFAULT')).toBe('agent:main:telegram:default');
    });

    it('should handle null/undefined', () => {
      expect(normalizeSessionKey(null)).toBe('');
      expect(normalizeSessionKey(undefined)).toBe('');
    });
  });
});
