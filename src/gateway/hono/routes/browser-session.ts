import type { Hono } from 'hono';
import { BrowserSessionLimitError, createBrowserSession, deleteBrowserSession } from '../../../storage/sqlite/browser-session-repository.js';
import { getGatewayPrincipal } from '../../security/gateway-principal.js';
import { browserCookieRequestAllowed, clearBrowserSessionCookie, writeBrowserSessionCookie } from '../../security/browser-session.js';
import type { AuthenticatedRouteDeps } from './deps.js';

export function registerBrowserSessionRoutes(app: Hono, deps: AuthenticatedRouteDeps): void {
  app.get('/api/browser-session', (c) => {
    c.header('Cache-Control', 'no-store');
    const principal = getGatewayPrincipal(c);
    return c.json({ conversationId: principal.principalId });
  });
  app.post('/api/browser-session', deps.strictRateLimitMiddleware, (c) => {
    const principal = getGatewayPrincipal(c);
    if (principal.kind !== 'owner' || !browserCookieRequestAllowed(c)) return c.json({ error: 'Forbidden' }, 403);
    let session;
    try { session = createBrowserSession(deps.service.getResolvedAuth(), principal.browserSessionId); }
    catch (error) {
      if (error instanceof BrowserSessionLimitError) return c.json({ error: 'Browser session limit reached' }, 409);
      throw error;
    }
    if (principal.browserSessionId) {
      deps.service.realtime.disconnectPrincipal(principal.principalId);
      deps.service.voiceRealtime.disconnectPrincipal(principal.principalId);
    }
    writeBrowserSessionCookie(c, session.token, session.expiresAt);
    c.header('Cache-Control', 'no-store');
    return c.json({ conversationId: `browser:${session.sessionId}` });
  });
  app.delete('/api/browser-session', (c) => {
    if (!browserCookieRequestAllowed(c)) return c.json({ error: 'Forbidden' }, 403);
    const principal = getGatewayPrincipal(c);
    if (principal.browserSessionId) {
      deleteBrowserSession(principal.browserSessionId);
      deps.service.realtime.disconnectPrincipal(principal.principalId);
      deps.service.voiceRealtime.disconnectPrincipal(principal.principalId);
    }
    clearBrowserSessionCookie(c);
    c.header('Cache-Control', 'no-store');
    return c.json({ ok: true });
  });
}
