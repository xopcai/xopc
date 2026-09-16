import { describe, it, expect } from 'vitest';
import {
  sanitizeSegment,
  isValidSegment,
  normalizeConversationId,
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

  it('normalizes UUIDs and rejects business keys', () => {
    expect(normalizeConversationId('ABCDEFAB-1234-4000-8000-ABCDEFABCDEF')).toBe('abcdefab-1234-4000-8000-abcdefabcdef');
    expect(() => normalizeConversationId('agent:main:main')).toThrow();
  });
});
