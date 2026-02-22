import { describe, it, expect } from 'vitest';
import {
  resolveGatewayAuth,
  safeCompare,
  validateToken,
  extractToken,
  assertGatewayAuthConfigured,
} from '../auth.js';

describe('Gateway Auth', () => {
  describe('resolveGatewayAuth', () => {
    it('should use default token mode with auto-generated token', () => {
      const result = resolveGatewayAuth({ authConfig: null });
      expect(result.mode).toBe('token');
      expect(result.token).toBeDefined();
      expect(result.token?.length).toBe(48); // 24 bytes hex = 48 chars
    });

    it('should use token from config', () => {
      const result = resolveGatewayAuth({
        authConfig: { mode: 'token', token: 'test-token-123' },
      });
      expect(result.mode).toBe('token');
      expect(result.token).toBe('test-token-123');
    });

    it('should use token from environment variable', () => {
      const result = resolveGatewayAuth({
        authConfig: { mode: 'token', token: 'config-token' },
        env: { XOPCBOT_GATEWAY_TOKEN: 'env-token' },
      });
      expect(result.mode).toBe('token');
      expect(result.token).toBe('env-token');
    });

    it('should use none mode from config', () => {
      const result = resolveGatewayAuth({
        authConfig: { mode: 'none' },
      });
      expect(result.mode).toBe('none');
      expect(result.token).toBeUndefined();
    });

    it('should use none mode from environment variable', () => {
      const result = resolveGatewayAuth({
        authConfig: { mode: 'token', token: 'config-token' },
        env: { XOPCBOT_GATEWAY_AUTH_MODE: 'none' },
      });
      expect(result.mode).toBe('none');
    });
  });

  describe('safeCompare', () => {
    it('should return true for equal strings', () => {
      expect(safeCompare('abc123', 'abc123')).toBe(true);
    });

    it('should return false for different strings', () => {
      expect(safeCompare('abc123', 'abc124')).toBe(false);
    });

    it('should return false for different lengths', () => {
      expect(safeCompare('abc', 'abcdef')).toBe(false);
    });

    it('should handle empty strings', () => {
      expect(safeCompare('', '')).toBe(true);
      expect(safeCompare('', 'abc')).toBe(false);
    });
  });

  describe('validateToken', () => {
    it('should return true for none mode', () => {
      const auth = { mode: 'none' as const };
      expect(validateToken(auth, 'any-token')).toBe(true);
      expect(validateToken(auth, null)).toBe(true);
      expect(validateToken(auth, undefined)).toBe(true);
    });

    it('should return true for valid token', () => {
      const auth = { mode: 'token' as const, token: 'secret-123' };
      expect(validateToken(auth, 'secret-123')).toBe(true);
    });

    it('should return false for invalid token', () => {
      const auth = { mode: 'token' as const, token: 'secret-123' };
      expect(validateToken(auth, 'wrong-token')).toBe(false);
    });

    it('should return false for missing token', () => {
      const auth = { mode: 'token' as const, token: 'secret-123' };
      expect(validateToken(auth, null)).toBe(false);
      expect(validateToken(auth, undefined)).toBe(false);
    });

    it('should return false for missing auth token', () => {
      const auth = { mode: 'token' as const };
      expect(validateToken(auth, 'any-token')).toBe(false);
    });
  });

  describe('extractToken', () => {
    it('should extract token from Authorization Bearer header', () => {
      const headers = { authorization: 'Bearer my-secret-token' };
      expect(extractToken(headers)).toBe('my-secret-token');
    });

    it('should extract token from X-Api-Key header', () => {
      const headers = { 'x-api-key': 'api-key-token' };
      expect(extractToken(headers)).toBe('api-key-token');
    });

    it('should prefer Authorization over X-Api-Key', () => {
      const headers = {
        authorization: 'Bearer bearer-token',
        'x-api-key': 'api-key-token',
      };
      expect(extractToken(headers)).toBe('bearer-token');
    });

    it('should handle array header values', () => {
      const headers = { authorization: ['Bearer token1', 'Bearer token2'] };
      expect(extractToken(headers)).toBe('token1');
    });

    it('should return undefined for missing headers', () => {
      expect(extractToken(undefined)).toBe(undefined);
      expect(extractToken({})).toBe(undefined);
    });

    it('should return undefined for non-Bearer Authorization', () => {
      const headers = { authorization: 'Basic dXNlcjpwYXNz' };
      expect(extractToken(headers)).toBe(undefined);
    });
  });

  describe('assertGatewayAuthConfigured', () => {
    it('should not throw for none mode', () => {
      expect(() => {
        assertGatewayAuthConfigured({ mode: 'none' });
      }).not.toThrow();
    });

    it('should not throw for token mode with token', () => {
      expect(() => {
        assertGatewayAuthConfigured({ mode: 'token', token: 'test-token' });
      }).not.toThrow();
    });

    it('should throw for token mode without token', () => {
      expect(() => {
        assertGatewayAuthConfigured({ mode: 'token' });
      }).toThrow(/no token was configured/);
    });
  });
});
