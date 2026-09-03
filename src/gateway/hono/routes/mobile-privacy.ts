import type { Hono } from 'hono';

import type { AuthenticatedRouteDeps } from './deps.js';

export function registerMobilePrivacyRoutes(authenticated: Hono, { service }: AuthenticatedRouteDeps): void {
  authenticated.get('/api/mobile/privacy', async (c) => {
    c.header('Cache-Control', 'no-store');
    const { getMobilePrivacyDisclosure } = await import('../../mobile-privacy.js');
    return c.json({ ok: true, payload: await getMobilePrivacyDisclosure(service.currentConfig) });
  });
}
