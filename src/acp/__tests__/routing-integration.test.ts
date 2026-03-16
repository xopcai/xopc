/**
 * ACP Routing Integration Tests
 */

import { describe, it, expect } from 'vitest';
import {
  buildAcpSessionKey,
  buildSubagentAcpSessionKey,
  isAcpSessionKey,
  extractAgentIdFromAcpKey,
  isValidAcpSessionKey,
  migrateLegacyAcpKey,
} from '../routing-integration.js';

describe('AcpRouting', () => {
  describe('buildAcpSessionKey', () => {
    it('should build ACP session key', () => {
      const key = buildAcpSessionKey({
        agentId: 'main',
        acpId: 'abc-123-def',
      });
      expect(key).toBe('main:acp:abc-123-def');
    });

    it('should work with different agent IDs', () => {
      const key = buildAcpSessionKey({
        agentId: 'coder',
        acpId: 'xyz-789',
      });
      expect(key).toBe('coder:acp:xyz-789');
    });
  });

  describe('buildSubagentAcpSessionKey', () => {
    it('should build subagent ACP session key', () => {
      const key = buildSubagentAcpSessionKey({
        parentAgentId: 'main',
        parentSessionId: 'parent-123',
        acpId: 'child-456',
      });
      expect(key).toBe('subagent:main:parent-123:acp:child-456');
    });
  });

  describe('isAcpSessionKey', () => {
    it('should identify ACP session keys', () => {
      expect(isAcpSessionKey('main:acp:abc-123')).toBe(true);
      expect(isAcpSessionKey('coder:acp:xyz-789')).toBe(true);
    });

    it('should reject non-ACP session keys', () => {
      expect(isAcpSessionKey('main:telegram:acc_default:dm:123')).toBe(false);
      expect(isAcpSessionKey('main:discord:acc_work:group:456')).toBe(false);
    });
  });

  describe('extractAgentIdFromAcpKey', () => {
    it('should extract agent ID from ACP key', () => {
      expect(extractAgentIdFromAcpKey('main:acp:abc-123')).toBe('main');
      expect(extractAgentIdFromAcpKey('coder:acp:xyz-789')).toBe('coder');
    });

    it('should extract from subagent ACP key', () => {
      expect(extractAgentIdFromAcpKey('subagent:main:parent:acp:child')).toBe('main');
    });

    it('should return null for non-ACP keys', () => {
      expect(extractAgentIdFromAcpKey('main:telegram:dm:123')).toBe(null);
    });
  });

  describe('isValidAcpSessionKey', () => {
    it('should validate proper ACP keys', () => {
      expect(isValidAcpSessionKey('main:acp:abc-123')).toBe(true);
    });

    it('should reject invalid keys', () => {
      expect(isValidAcpSessionKey('acp:abc-123')).toBe(false); // missing agentId
      expect(isValidAcpSessionKey('main:telegram:dm:123')).toBe(false);
    });
  });

  describe('migrateLegacyAcpKey', () => {
    it('should migrate legacy acp:{uuid} format', () => {
      const migrated = migrateLegacyAcpKey('acp:abc-123', 'main');
      expect(migrated).toBe('main:acp:abc-123');
    });

    it('should handle uppercase ACP prefix', () => {
      const migrated = migrateLegacyAcpKey('ACP:xyz-789', 'main');
      expect(migrated).toBe('main:acp:xyz-789');
    });

    it('should return new format as-is', () => {
      const migrated = migrateLegacyAcpKey('main:acp:abc-123', 'main');
      expect(migrated).toBe('main:acp:abc-123');
    });

    it('should use default agent ID for unknown formats', () => {
      const migrated = migrateLegacyAcpKey('unknown-format', 'main');
      expect(migrated).toBe('main:acp:unknown-format');
    });
  });
});
