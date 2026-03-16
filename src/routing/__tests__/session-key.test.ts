import { describe, it, expect } from 'vitest';
import {
  buildSessionKey,
  parseSessionKey,
  sanitizeSegment,
  isValidSegment,
  isSubagentSessionKey,
  isAcpSessionKey,
  isCronSessionKey,
  getSubagentDepth,
  buildSubagentSessionKey,
  getParentSessionKey,
  normalizeSessionKey,
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

  describe('buildSessionKey', () => {
    it('should build basic session key', () => {
      const key = buildSessionKey({
        agentId: 'main',
        source: 'telegram',
        accountId: 'default',
        peerKind: 'dm',
        peerId: '123456',
      });
      expect(key).toBe('main:telegram:default:dm:123456');
    });

    it('should build session key with thread', () => {
      const key = buildSessionKey({
        agentId: 'main',
        source: 'discord',
        accountId: 'work',
        peerKind: 'channel',
        peerId: '987654',
        threadId: '789',
      });
      expect(key).toBe('main:discord:work:channel:987654:thread:789');
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
      expect(key).toBe('main:telegram:default:dm:123456:scope:scope1');
    });

    it('should sanitize segments', () => {
      const key = buildSessionKey({
        agentId: 'MAIN',
        source: 'Telegram',
        accountId: 'DEFAULT',
        peerKind: 'DM',
        peerId: 'USER@123',
      });
      expect(key).toBe('main:telegram:default:dm:user-123');
    });

    it('should use defaults for missing required fields', () => {
      const key = buildSessionKey({
        agentId: '',
        source: '',
        accountId: '',
        peerKind: '',
        peerId: '',
      });
      expect(key).toBe('main:unknown:default:unknown:unknown');
    });
  });

  describe('parseSessionKey', () => {
    it('should parse basic session key', () => {
      const parsed = parseSessionKey('main:telegram:default:dm:123456');
      expect(parsed).toEqual({
        agentId: 'main',
        source: 'telegram',
        accountId: 'default',
        peerKind: 'dm',
        peerId: '123456',
      });
    });

    it('should parse session key with thread', () => {
      const parsed = parseSessionKey('main:discord:work:channel:987654:thread:789');
      expect(parsed).toEqual({
        agentId: 'main',
        source: 'discord',
        accountId: 'work',
        peerKind: 'channel',
        peerId: '987654',
        threadId: '789',
      });
    });

    it('should parse session key with scope', () => {
      const parsed = parseSessionKey('main:telegram:default:dm:123456:scope:scope1');
      expect(parsed).toEqual({
        agentId: 'main',
        source: 'telegram',
        accountId: 'default',
        peerKind: 'dm',
        peerId: '123456',
        scopeId: 'scope1',
      });
    });

    it('should parse session key with both thread and scope', () => {
      const parsed = parseSessionKey('main:telegram:default:dm:123456:thread:789:scope:scope1');
      expect(parsed).toEqual({
        agentId: 'main',
        source: 'telegram',
        accountId: 'default',
        peerKind: 'dm',
        peerId: '123456',
        threadId: '789',
        scopeId: 'scope1',
      });
    });

    it('should return null for invalid keys', () => {
      expect(parseSessionKey(null)).toBeNull();
      expect(parseSessionKey('')).toBeNull();
      expect(parseSessionKey('invalid')).toBeNull();
      expect(parseSessionKey('a:b:c:d')).toBeNull(); // Too few segments
    });

    it('should handle case insensitivity', () => {
      const parsed = parseSessionKey('MAIN:TELEGRAM:DEFAULT:DM:123456');
      expect(parsed?.agentId).toBe('main');
      expect(parsed?.source).toBe('telegram');
    });
  });

  describe('isSubagentSessionKey', () => {
    it('should return true for subagent keys', () => {
      expect(isSubagentSessionKey('subagent:main:default:dm:123456')).toBe(true);
    });

    it('should return false for non-subagent keys', () => {
      expect(isSubagentSessionKey('main:telegram:default:dm:123456')).toBe(false);
    });
  });

  describe('isAcpSessionKey', () => {
    it('should return true for acp keys', () => {
      expect(isAcpSessionKey('main:acp:default:dm:uuid-123')).toBe(true);
    });

    it('should return false for non-acp keys', () => {
      expect(isAcpSessionKey('main:telegram:default:dm:123456')).toBe(false);
    });
  });

  describe('isCronSessionKey', () => {
    it('should return true for cron keys', () => {
      expect(isCronSessionKey('main:cron:default:dm:job-123')).toBe(true);
    });

    it('should return false for non-cron keys', () => {
      expect(isCronSessionKey('main:telegram:default:dm:123456')).toBe(false);
    });
  });

  describe('getSubagentDepth', () => {
    it('should return 0 for non-subagent keys', () => {
      expect(getSubagentDepth('main:telegram:default:dm:123456')).toBe(0);
    });

    it('should return 1 for single subagent', () => {
      expect(getSubagentDepth('subagent:main:default:dm:123456')).toBe(1);
    });

    it('should count nested subagents', () => {
      expect(getSubagentDepth('subagent:subagent:main:default:dm:123456')).toBe(2);
    });
  });

  describe('buildSubagentSessionKey', () => {
    it('should build subagent session key from parent', () => {
      const parentKey = 'main:telegram:default:dm:123456';
      const subKey = buildSubagentSessionKey({
        parentSessionKey: parentKey,
        agentId: 'subagent',
        source: 'main',
        accountId: 'default',
        peerKind: 'dm',
        peerId: '123456',
      });
      expect(subKey).toBe('subagent:main:default:dm:123456');
    });

    it('should throw for invalid parent key', () => {
      expect(() =>
        buildSubagentSessionKey({
          parentSessionKey: 'invalid',
          agentId: 'subagent',
          source: 'main',
          accountId: 'default',
          peerKind: 'dm',
          peerId: '123456',
        })
      ).toThrow();
    });
  });

  describe('getParentSessionKey', () => {
    it('should remove thread suffix', () => {
      const parent = getParentSessionKey('main:telegram:default:dm:123456:thread:789');
      expect(parent).toBe('main:telegram:default:dm:123456');
    });

    it('should return null for keys without thread', () => {
      expect(getParentSessionKey('main:telegram:default:dm:123456')).toBeNull();
    });
  });

  describe('normalizeSessionKey', () => {
    it('should normalize to lowercase', () => {
      expect(normalizeSessionKey('MAIN:TELEGRAM:DEFAULT')).toBe('main:telegram:default');
    });

    it('should handle null/undefined', () => {
      expect(normalizeSessionKey(null)).toBe('');
      expect(normalizeSessionKey(undefined)).toBe('');
    });
  });
});
