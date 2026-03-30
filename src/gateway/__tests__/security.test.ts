import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createHonoApp } from '../hono/app.js';
import type { GatewayService } from '../service.js';
import { GatewayConfigSchema } from '../../config/schema.js';
import { getAuthFailureRateLimiter } from '../auth-rate-limit.js';

// Mock GatewayService for testing
function createMockService(config: any = {}): GatewayService {
  return {
    currentConfig: {
      gateway: {
        port: 18790,
        corsOrigins: [],
        ...config.gateway,
      },
      agents: { defaults: {} },
      channels: {},
      ...config,
    },
    getHealth: () => ({ status: 'healthy', version: 'test', channels: [], uptime: 0 }),
    getChannelsStatus: () => [],
    getAuthToken: () => 'test-token',
    getAuthMode: () => 'token',
    sessionManagerInstance: {} as any,
    cronServiceInstance: {} as any,
    emit: () => {},
    listSessions: async () => ({ items: [], total: 0 }),
    getSession: async () => null,
    reloadConfig: async () => ({ success: true }),
    saveConfig: async () => ({ saved: true }),
    refreshAuthToken: async () => 'new-token',
    getSkillsApi: () => [],
    reloadSkillsFromDisk: () => {},
    installManagedSkillZip: () => ({ success: true }),
    deleteManagedSkill: () => {},
  } as unknown as GatewayService;
}

describe('Gateway Security Fixes', () => {
  describe('FIX-1: HTTP Security Headers', () => {
    it('should include X-Frame-Options: DENY', async () => {
      const service = createMockService();
      const app = createHonoApp({ service, token: 'test' });
      
      const res = await app.request('/health');
      expect(res.headers.get('X-Frame-Options')).toBe('DENY');
    });

    it('should include X-Content-Type-Options: nosniff', async () => {
      const service = createMockService();
      const app = createHonoApp({ service, token: 'test' });
      
      const res = await app.request('/health');
      expect(res.headers.get('X-Content-Type-Options')).toBe('nosniff');
    });

    it('should include Referrer-Policy: strict-origin-when-cross-origin', async () => {
      const service = createMockService();
      const app = createHonoApp({ service, token: 'test' });
      
      const res = await app.request('/health');
      expect(res.headers.get('Referrer-Policy')).toBe('strict-origin-when-cross-origin');
    });

    it('should include X-XSS-Protection: 1; mode=block', async () => {
      const service = createMockService();
      const app = createHonoApp({ service, token: 'test' });
      
      const res = await app.request('/health');
      expect(res.headers.get('X-XSS-Protection')).toBe('1; mode=block');
    });

    it('should include Permissions-Policy', async () => {
      const service = createMockService();
      const app = createHonoApp({ service, token: 'test' });
      
      const res = await app.request('/health');
      expect(res.headers.get('Permissions-Policy')).toBe('camera=(), microphone=(), geolocation=()');
    });

    it('should include Content-Security-Policy', async () => {
      const service = createMockService();
      const app = createHonoApp({ service, token: 'test' });
      
      const res = await app.request('/health');
      const csp = res.headers.get('Content-Security-Policy');
      expect(csp).toContain("default-src 'self'");
      expect(csp).toContain("frame-ancestors 'none'");
    });
  });

  describe('FIX-2: CORS Default Configuration', () => {
    it('should allow localhost origins by default', async () => {
      const service = createMockService();
      const app = createHonoApp({ service, token: 'test' });
      
      const res = await app.request('/health', {
        headers: { 'Origin': 'http://localhost:18790' },
      });
      expect(res.headers.get('Access-Control-Allow-Origin')).toBe('http://localhost:18790');
    });

    it('should reject unknown origins by default', async () => {
      const service = createMockService();
      const app = createHonoApp({ service, token: 'test' });
      
      const res = await app.request('/health', {
        headers: { 'Origin': 'https://evil.com' },
      });
      expect(res.headers.get('Access-Control-Allow-Origin')).not.toBe('https://evil.com');
    });

    it('should respect explicitly configured origins', async () => {
      const service = createMockService({
        gateway: { corsOrigins: ['https://myapp.com'] },
      });
      const app = createHonoApp({ service, token: 'test' });
      
      const res = await app.request('/health', {
        headers: { 'Origin': 'https://myapp.com' },
      });
      expect(res.headers.get('Access-Control-Allow-Origin')).toBe('https://myapp.com');
    });
  });

  describe('FIX-3: Body Size Limit', () => {
    it('should reject requests larger than 1MB on /api/*', async () => {
      const service = createMockService();
      const app = createHonoApp({ service, token: 'test' });
      
      // Create a large body (> 1MB)
      const largeBody = { data: 'x'.repeat(2 * 1024 * 1024) };
      
      const res = await app.request('/api/agent', {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'Authorization': 'Bearer test',
        },
        body: JSON.stringify(largeBody),
      });
      
      // Hono may return 413 from bodyLimit or 400 if the runtime rejects the payload before the limit handler.
      expect([400, 413]).toContain(res.status);
      if (res.status === 413) {
        const json = await res.json();
        expect(json.error).toContain('Request body too large');
      }
    });

    it('should accept requests smaller than 1MB', async () => {
      const service = createMockService();
      const app = createHonoApp({ service, token: 'test' });
      
      // Create a small body (< 1MB)
      const smallBody = { data: 'small payload' };
      
      const res = await app.request('/api/agent', {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'Authorization': 'Bearer test',
        },
        body: JSON.stringify(smallBody),
      });
      
      // Should not be 413 (Payload Too Large)
      expect(res.status).not.toBe(413);
    });
  });

  describe('Auth failure rate limiting', () => {
    beforeEach(() => {
      getAuthFailureRateLimiter().resetForTests();
    });
    afterEach(() => {
      getAuthFailureRateLimiter().resetForTests();
    });

    it('returns 429 after repeated invalid gateway tokens', async () => {
      const service = createMockService({
        gateway: {
          auth: {
            mode: 'token',
            token: 'real',
            rateLimit: {
              enabled: true,
              maxAttempts: 2,
              windowMs: 60_000,
              blockDurationMs: 60_000,
            },
          },
        },
      });
      const app = createHonoApp({ service, token: 'real' });

      const r1 = await app.request('/api/config', {
        headers: { Authorization: 'Bearer wrong' },
      });
      expect(r1.status).toBe(401);

      const r2 = await app.request('/api/config', {
        headers: { Authorization: 'Bearer wrong' },
      });
      expect(r2.status).toBe(401);

      const r3 = await app.request('/api/config', {
        headers: { Authorization: 'Bearer wrong' },
      });
      expect(r3.status).toBe(429);
    });
  });

  describe('FIX-4: Default Host Binding', () => {
    it('should default to loopback address in config', () => {
      const defaults = GatewayConfigSchema.parse(undefined);
      expect(defaults.host).toBe('127.0.0.1');
    });

    it('should default to empty corsOrigins array', () => {
      const defaults = GatewayConfigSchema.parse(undefined);
      expect(defaults.corsOrigins).toEqual([]);
    });
  });
});
