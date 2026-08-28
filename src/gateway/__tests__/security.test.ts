import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createHonoApp, isExtensionGatewayUiAssetPath } from '../hono/app.js';
import { isQueryTokenAllowedPath } from '../hono/middleware/auth.js';
import type { GatewayService } from '../service.js';
import { resolveGatewayEffectiveHost } from '../../config/gateway-bind.js';
import { GatewayConfigSchema, type Config } from '../../config/schema.js';
import { buckets } from '../rate-limit/index.js';
import { resolveEffectiveGatewayPort } from '../host.js';
import { loadTunnelState } from '../../tunnel/tunnel-state.js';

vi.mock('../../tunnel/tunnel-state.js', () => ({
  loadTunnelState: vi.fn(() => null),
}));

const mockLoadTunnelState = vi.mocked(loadTunnelState);

// Mock GatewayService for testing
function createMockService(config: any = {}, listenPort?: number): GatewayService {
  const gatewayAuth = config.gateway?.auth ?? { mode: 'token', token: 'test-token' };
  const resolvedAuth =
    gatewayAuth.mode === 'trusted-proxy'
      ? { mode: 'trusted-proxy' as const, trustedProxy: gatewayAuth.trustedProxy }
      : gatewayAuth.mode === 'none'
        ? { mode: 'none' as const }
        : gatewayAuth.mode === 'password'
          ? { mode: 'password' as const, password: gatewayAuth.password ?? 'test-password' }
          : { mode: 'token' as const, token: gatewayAuth.token ?? 'test-token' };

  return {
    currentConfig: {
      gateway: {
        port: 18790,
        corsOrigins: [],
        auth: gatewayAuth,
        ...config.gateway,
      },
      agents: { defaultPreset: 'default', capabilityPresets: {}, list: [] },
      channels: {},
      ...config,
    },
    getEffectiveListenPort: () =>
      resolveEffectiveGatewayPort(
        {
          gateway: {
            port: 18790,
            corsOrigins: [],
            ...config.gateway,
          },
        },
        listenPort,
      ),
    getHealth: () => ({ status: 'healthy', version: 'test', channels: [], uptime: 0 }),
    getChannelsStatus: () => [],
    getAuthToken: () => (resolvedAuth.mode === 'token' ? resolvedAuth.token : undefined),
    getAuthMode: () => resolvedAuth.mode,
    getResolvedAuth: () => resolvedAuth,
    sessionManagerInstance: {} as any,
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
    getExtensionLoader: () => null,
  } as unknown as GatewayService;
}

describe('Gateway Security Fixes', () => {
  describe('password gateway authentication', () => {
    it('fails closed without a password and accepts only the configured password', async () => {
      const service = createMockService({ gateway: { auth: { mode: 'password', password: 'correct-password' } } });
      const app = createHonoApp({ service });

      expect((await app.request('/api/config')).status).toBe(401);
      expect((await app.request('/api/config', { headers: { Authorization: 'Bearer wrong-password' } })).status).toBe(401);
      expect((await app.request('/api/config', { headers: { Authorization: 'Bearer correct-password' } })).status).toBe(200);
    });

    it('never accepts password credentials in a query string', async () => {
      const service = createMockService({ gateway: { auth: { mode: 'password', password: 'correct-password' } } });
      const app = createHonoApp({ service });

      expect((await app.request('/api/config?token=correct-password')).status).toBe(401);
    });
  });

  describe('query token path policy', () => {
    it('allows query token only for agent avatar GET', () => {
      expect(isQueryTokenAllowedPath('/api/agents/main/avatar', 'GET')).toBe(true);
      expect(isQueryTokenAllowedPath('/api/notes/n1/media/a1', 'GET')).toBe(false);
      expect(isQueryTokenAllowedPath('/api/agents/main/avatar', 'PUT')).toBe(false);
      expect(isQueryTokenAllowedPath('/api/notes/n1/media/a1', 'POST')).toBe(false);
      expect(isQueryTokenAllowedPath('/api/config', 'GET')).toBe(false);
    });
  });

  describe('extension UI asset paths', () => {
    it('detects extension sandbox static URLs so global anti-framing headers are skipped', () => {
      expect(isExtensionGatewayUiAssetPath('/api/extensions/hello/assets/ui/panel.html')).toBe(true);
      expect(isExtensionGatewayUiAssetPath('/api/extensions/hello/assets/ui/panel.bundle.js')).toBe(
        true,
      );
      expect(isExtensionGatewayUiAssetPath('/api/extensions/hello/storage')).toBe(false);
      expect(isExtensionGatewayUiAssetPath('/api/extensions')).toBe(false);
      expect(isExtensionGatewayUiAssetPath('/health')).toBe(false);
    });

    it('allows extension asset requests with sandbox Origin null (not 403 from CSRF middleware)', async () => {
      const service = createMockService();
      const app = createHonoApp({ service, token: 'test' });
      const res = await app.request('/api/extensions/hello/assets/ui/panel.bundle.js', {
        headers: { Origin: 'null' },
      });
      expect(res.status).toBe(503);
      expect(res.headers.get('Access-Control-Allow-Origin')).toBe('null');
    });
  });

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
      expect(res.headers.get('Permissions-Policy')).toBe(
        'camera=(), microphone=(self), geolocation=()',
      );
    });

    it('should include Content-Security-Policy', async () => {
      const service = createMockService();
      const app = createHonoApp({ service, token: 'test' });
      
      const res = await app.request('/health');
      const csp = res.headers.get('Content-Security-Policy');
      expect(csp).toContain("default-src 'self'");
      expect(csp).toContain("media-src 'self' blob: data:");
      expect(csp).toContain("frame-ancestors 'none'");
      expect(csp).toContain("frame-src 'none'");
      expect(csp).toContain("form-action 'self'");
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

    it('hot reloads additional origins without changing the active listen host', async () => {
      const service = createMockService({
        gateway: { bind: 'lan', corsOrigins: [] },
      });
      const app = createHonoApp({ service, listenHost: '192.168.1.10' });

      service.currentConfig.gateway.corsOrigins = ['https://console.example.com'];
      service.currentConfig.gateway.bind = 'loopback';

      const custom = await app.request('/health', {
        headers: { Origin: 'https://console.example.com' },
      });
      expect(custom.headers.get('Access-Control-Allow-Origin')).toBe('https://console.example.com');

      const activeGateway = await app.request('/health', {
        headers: { Origin: 'http://192.168.1.10:18790' },
      });
      expect(activeGateway.headers.get('Access-Control-Allow-Origin')).toBe('http://192.168.1.10:18790');
    });

    it('uses effective listen port for default loopback CORS when CLI overrides port', async () => {
      const service = createMockService(
        { gateway: { bind: 'lan', port: 18790, corsOrigins: [] } },
        8080,
      );
      const app = createHonoApp({ service, token: 'test' });

      const allowed = await app.request('/health', {
        headers: { Origin: 'http://localhost:8080' },
      });
      expect(allowed.headers.get('Access-Control-Allow-Origin')).toBe('http://localhost:8080');

      const stale = await app.request('/health', {
        headers: { Origin: 'http://localhost:18790' },
      });
      expect(stale.headers.get('Access-Control-Allow-Origin')).not.toBe('http://localhost:18790');
    });

    it('does not allow host-header origin fallback by default', async () => {
      const service = createMockService({
        gateway: {
          port: 18790,
          corsOrigins: ['http://localhost:18790'],
        },
      });
      const app = createHonoApp({ service, token: 'test' });

      const res = await app.request('/api/config', {
        headers: {
          Origin: 'http://evil.example:18790',
          Host: 'evil.example:18790',
          Authorization: 'Bearer test',
        },
      });
      expect(res.status).toBe(403);
    });

    it('allows Vite dev origin when custom corsOrigins omit port 3000', async () => {
      const service = createMockService({
        gateway: {
          port: 18790,
          bind: 'lan',
          corsOrigins: ['http://localhost:18790', 'http://192.168.1.5:18790'],
        },
      });
      const app = createHonoApp({ service, token: 'test' });

      const res = await app.request('/api/tunnel/pair', {
        method: 'POST',
        headers: {
          Origin: 'http://localhost:3000',
          Authorization: 'Bearer test',
          'Content-Type': 'application/json',
        },
        body: '{}',
      });
      expect(res.status).not.toBe(403);
    });

    it('allows Expo web dev origin when custom corsOrigins omit port 8081', async () => {
      const service = createMockService({
        gateway: {
          port: 18790,
          bind: 'lan',
          corsOrigins: ['http://localhost:18790', 'http://192.168.1.5:18790'],
        },
      });
      const app = createHonoApp({ service, token: 'test' });

      const res = await app.request('/api/home', {
        headers: {
          Origin: 'http://localhost:8081',
          Authorization: 'Bearer test',
        },
      });
      expect(res.status).not.toBe(403);
      expect(res.headers.get('Access-Control-Allow-Origin')).toBe('http://localhost:8081');
    });

    it('allows API calls with opaque Origin null when Bearer token is valid', async () => {
      const service = createMockService();
      const app = createHonoApp({ service, token: 'test' });

      const res = await app.request('/api/sessions', {
        method: 'POST',
        headers: {
          Origin: 'null',
          Authorization: 'Bearer test',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ channel: 'webchat' }),
      });

      expect(res.status).not.toBe(403);
    });

    it('allows browser API calls from the active tunnel public URL origin', async () => {
      mockLoadTunnelState.mockReturnValue({
        tunnelId: 't1',
        tunnelToken: 'tok',
        subdomain: 'wxfy4i',
        publicUrl: 'https://wxfy4i.frp.xopc.ai',
        frpcAuthToken: 'frpc',
        registeredAt: new Date().toISOString(),
        enabled: true,
        frpcServerAddr: '127.0.0.1',
        frpcServerPort: 8080,
        proxyName: 'p',
      });

      const service = createMockService();
      const app = createHonoApp({ service, token: 'test' });

      const res = await app.request('/api/sessions', {
        method: 'POST',
        headers: {
          Origin: 'https://wxfy4i.frp.xopc.ai',
          Authorization: 'Bearer test',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ channel: 'webchat' }),
      });

      expect(res.status).not.toBe(403);
      mockLoadTunnelState.mockReturnValue(null);
    });

    it('allows host-header origin fallback when explicitly enabled', async () => {
      const service = createMockService({
        gateway: {
          port: 18790,
          corsOrigins: ['http://localhost:18790'],
          dangerouslyAllowHostHeaderOriginFallback: true,
        },
      });
      const app = createHonoApp({ service, token: 'test' });

      const res = await app.request('/api/config', {
        headers: {
          Origin: 'http://192.168.1.5:18790',
          Host: '192.168.1.5:18790',
          Authorization: 'Bearer test',
        },
      });
      expect(res.status).not.toBe(403);
    });
  });

  describe('FIX-3: Body Size Limit', () => {
    it('should reject requests larger than 1MB on typical /api/* routes', async () => {
      const service = createMockService();
      const app = createHonoApp({ service, token: 'test' });
      
      // Create a large body (> 1MB). Set Content-Length so `bodyLimit` can reject without buffering the body.
      const largeBody = { data: 'x'.repeat(2 * 1024 * 1024) };
      const bodyString = JSON.stringify(largeBody);

      const res = await app.request('/api/config/reload', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer test',
          'Content-Length': String(Buffer.byteLength(bodyString)),
        },
        body: bodyString,
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
      
      const res = await app.request('/api/sessions/agent%3Amain%3Amain/inputs', {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'Authorization': 'Bearer test-token',
        },
        body: JSON.stringify(smallBody),
      });
      
      // Should not be 413 (Payload Too Large)
      expect(res.status).not.toBe(413);
      expect(res.headers.get('X-RateLimit-Remaining')).toBe('179');
    });

    it('should allow larger note media uploads through the API body limit', async () => {
      const service = createMockService();
      const app = createHonoApp({ service, token: 'test' });
      const boundary = '----xopc-test-boundary';
      const body = [
        `--${boundary}`,
        'Content-Disposition: form-data; name="file"; filename="photo.jpg"',
        'Content-Type: image/jpeg',
        '',
        'x'.repeat(2 * 1024 * 1024),
        `--${boundary}--`,
        '',
      ].join('\r\n');

      const res = await app.request('/api/notes/note-1/media', {
        method: 'POST',
        headers: {
          'Content-Type': `multipart/form-data; boundary=${boundary}`,
          Authorization: 'Bearer test',
          'Content-Length': String(Buffer.byteLength(body)),
        },
        body,
      });

      expect(res.status).not.toBe(413);
    });

    it('should keep rejecting oversized note media uploads', async () => {
      const service = createMockService();
      const app = createHonoApp({ service, token: 'test' });

      const res = await app.request('/api/notes/note-1/media', {
        method: 'POST',
        headers: {
          'Content-Type': 'multipart/form-data; boundary=xopc',
          Authorization: 'Bearer test',
          'Content-Length': String(26 * 1024 * 1024),
        },
        body: 'x',
      });

      expect(res.status).toBe(413);
      const json = await res.json();
      expect(json.maxSize).toBe('25MB');
    });

    it('should allow multipart voice transcription payloads through the API body limit', async () => {
      const service = createMockService();
      const app = createHonoApp({ service, token: 'test' });

      const res = await app.request('/api/voice/transcriptions', {
        method: 'POST',
        headers: {
          'Content-Type': 'multipart/form-data; boundary=xopc',
          Authorization: 'Bearer test',
          'Content-Length': String(2 * 1024 * 1024),
        },
        body: 'x',
      });

      expect(res.status).not.toBe(413);
    });

    it('should keep rejecting oversized voice transcription payloads', async () => {
      const service = createMockService();
      const app = createHonoApp({ service, token: 'test' });

      const res = await app.request('/api/voice/transcriptions', {
        method: 'POST',
        headers: {
          'Content-Type': 'multipart/form-data; boundary=xopc',
          Authorization: 'Bearer test',
          'Content-Length': String(27 * 1024 * 1024),
        },
        body: '{}',
      });

      expect(res.status).toBe(413);
      const json = await res.json();
      expect(json.maxSize).toBe('26MB');
    });
  });

  describe('Auth failure rate limiting', () => {
    beforeEach(() => {
      buckets.resetAllForTests();
    });
    afterEach(() => {
      buckets.resetAllForTests();
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
              // Disable burst-coalesce so sequential test requests count as
              // distinct attempts. Production default (1000ms) absorbs SPA
              // fan-out — see auth-rate-limit policy docs.
              burstCoalesceMs: 0,
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

    it('exempts loopback browser-origin auth failures when exemptLoopback is true', async () => {
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
              exemptLoopback: true,
            },
          },
        },
      });
      const app = createHonoApp({ service, token: 'real' });
      const headers = {
        Origin: 'http://localhost:18790',
        Authorization: 'Bearer wrong',
        'X-Forwarded-For': '127.0.0.1',
      };

      expect((await app.request('/api/config', { headers })).status).toBe(401);
      expect((await app.request('/api/config', { headers })).status).toBe(401);
      expect((await app.request('/api/config', { headers })).status).toBe(401);
    });

    it('exempts loopback browser-origin auth failures when client IP is unknown (embedded desktop UI)', async () => {
      const service = createMockService({
        gateway: {
          corsOrigins: ['http://127.0.0.1:28790'],
          auth: {
            mode: 'token',
            token: 'real',
            rateLimit: {
              enabled: true,
              maxAttempts: 2,
              windowMs: 60_000,
              blockDurationMs: 60_000,
              exemptLoopback: true,
            },
          },
        },
      });
      const app = createHonoApp({ service, token: 'real' });
      const headers = {
        Origin: 'http://127.0.0.1:28790',
        Authorization: 'Bearer wrong',
      };

      expect((await app.request('/api/config', { headers })).status).toBe(401);
      expect((await app.request('/api/config', { headers })).status).toBe(401);
      expect((await app.request('/api/config', { headers })).status).toBe(401);
    });

    it('rate limits remote browser-origin auth failures on loopback', async () => {
      const service = createMockService({
        gateway: {
          corsOrigins: ['http://evil.example.com'],
          auth: {
            mode: 'token',
            token: 'real',
            rateLimit: {
              enabled: true,
              maxAttempts: 2,
              windowMs: 60_000,
              blockDurationMs: 60_000,
              exemptLoopback: true,
              burstCoalesceMs: 0,
            },
          },
        },
      });
      const app = createHonoApp({ service, token: 'real' });
      const headers = {
        Origin: 'http://evil.example.com',
        Authorization: 'Bearer wrong',
        'X-Forwarded-For': '127.0.0.1',
      };

      expect((await app.request('/api/config', { headers })).status).toBe(401);
      expect((await app.request('/api/config', { headers })).status).toBe(401);
      expect((await app.request('/api/config', { headers })).status).toBe(429);
    });

    it('allows immediate recovery with a valid token after block', async () => {
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
              burstCoalesceMs: 0,
            },
          },
        },
      });
      const app = createHonoApp({ service, token: 'real' });

      // Drive the client into blocked state.
      const bad1 = await app.request('/api/config', {
        headers: { Authorization: 'Bearer wrong' },
      });
      expect(bad1.status).toBe(401);
      const bad2 = await app.request('/api/config', {
        headers: { Authorization: 'Bearer wrong' },
      });
      expect(bad2.status).toBe(401);
      const blocked = await app.request('/api/config', {
        headers: { Authorization: 'Bearer wrong' },
      });
      expect(blocked.status).toBe(429);

      // Correct token should bypass historical block and clear limiter state.
      const good = await app.request('/api/config', {
        headers: { Authorization: 'Bearer real' },
      });
      expect(good.status).toBe(200);

      // After successful auth, failures are counted from a clean slate.
      const badAfterSuccess = await app.request('/api/config', {
        headers: { Authorization: 'Bearer wrong' },
      });
      expect(badAfterSuccess.status).toBe(401);
    });

    it('allows GET agent avatar with ?token= (img subresources cannot send Authorization)', async () => {
      const service = createMockService({ gateway: { auth: { mode: 'token', token: 'test' } } });
      const app = createHonoApp({ service });

      const res = await app.request('/api/agents/main/avatar?token=test');
      expect(res.status).not.toBe(401);

      const rejected = await app.request('/api/config?token=test');
      expect(rejected.status).toBe(401);
    });

    it('does not count missing-credential requests as failures', async () => {
      // Page reloads / SDK cold starts often issue requests before a token is
      // attached. Counting these as brute-force attempts would lock users out
      // of the recovery path (they couldn't even open the token-entry UI).
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
              burstCoalesceMs: 0,
            },
          },
        },
      });
      const app = createHonoApp({ service, token: 'real' });

      // 10 missing-token requests must never trigger a block.
      for (let i = 0; i < 10; i += 1) {
        const res = await app.request('/api/config');
        expect(res.status).toBe(401);
        const body = (await res.json()) as { code?: string };
        expect(body.code).toBe('missing_credential');
      }

      // After all that, valid token still works — bucket was never armed.
      const good = await app.request('/api/config', {
        headers: { Authorization: 'Bearer real' },
      });
      expect(good.status).toBe(200);
    });
  });

  describe('FIX-4: Default Host Binding', () => {
    it('should default to loopback bind in config', () => {
      const defaults = GatewayConfigSchema.parse(undefined);
      expect(defaults.bind).toBe('loopback');
      expect(resolveGatewayEffectiveHost({ gateway: defaults } as Config)).toBe('127.0.0.1');
    });

    it('should default to empty corsOrigins array', () => {
      const defaults = GatewayConfigSchema.parse(undefined);
      expect(defaults.corsOrigins).toEqual([]);
    });
  });
});
