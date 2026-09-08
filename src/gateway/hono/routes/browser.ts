/** Browser Control status, approvals, and driver diagnostics. */
import { getConnInfo } from '@hono/node-server/conninfo';
import type { Context, Hono } from 'hono';

import { decideBrowserApproval, listBrowserApprovals } from '../../../browser/policy/approval-store.js';
import { isLoopbackClientIp } from '../../security/loopback.js';
import type { AuthenticatedRouteDeps } from './deps.js';

const EXTENSION_ENDPOINT = 'http://127.0.0.1:19820/';

function isLocalOwnerRequest(c: Context, service: AuthenticatedRouteDeps['service']): boolean {
  if (service.currentConfig.gateway?.bind === 'loopback') return true;
  try {
    return isLoopbackClientIp(getConnInfo(c).remote.address);
  } catch {
    return false;
  }
}

export function registerBrowserRoutes(authenticated: Hono, deps: AuthenticatedRouteDeps): void {
  const { service, strictRateLimitMiddleware } = deps;

  authenticated.get('/api/browser/extension-status', async (c) => {
    const { getExtensionBrowserServerSnapshot } = await import(
      '../../../browser/providers/extension-ws-acquire.js'
    );
    const snapshot = getExtensionBrowserServerSnapshot();
    let running = snapshot.active;
    let connected = false;
    try {
      const response = await fetch(EXTENSION_ENDPOINT, { signal: AbortSignal.timeout(2_000) });
      const payload = await response.json() as { ok?: boolean; connected?: boolean };
      running ||= payload.ok === true;
      connected = payload.connected === true;
    } catch {
      // A stopped bridge is a valid diagnostic result.
    }

    let artifacts: Record<string, unknown> | undefined;
    try {
      const { browserExtDoctor } = await import('../../../browser/providers/browser-ext-install.js');
      const doctor = await browserExtDoctor();
      artifacts = {
        installed: doctor.installed,
        extensionDir: doctor.extensionDir,
        xopcVersion: doctor.xopcVersion,
        installedVersion: doctor.installedVersion,
        needsRefresh: doctor.needsRefresh,
        needsChromeReload: doctor.needsChromeReload,
      };
    } catch {
      // Installation diagnostics are optional when only checking the bridge.
    }

    return c.json({
      running,
      connected,
      driverKind: 'extension',
      artifacts,
      bridgeHeld: snapshot.active,
      refCount: snapshot.refCount,
    });
  });

  authenticated.get('/api/browser/approvals', (c) => {
    if (!isLocalOwnerRequest(c, service)) {
      return c.json({ ok: false, error: 'Local owner access required.' }, 403);
    }
    return c.json({ ok: true, approvals: listBrowserApprovals(c.req.query('sessionKey')) });
  });

  authenticated.post('/api/browser/approvals/respond', strictRateLimitMiddleware, async (c) => {
    if (!isLocalOwnerRequest(c, service)) {
      return c.json({ ok: false, error: 'Local owner access required.' }, 403);
    }
    const body = await c.req.json().catch(() => null) as { id?: unknown; decision?: unknown } | null;
    if (typeof body?.id !== 'string' || (body.decision !== 'approved' && body.decision !== 'denied')) {
      return c.json({ ok: false, error: 'id and decision are required.' }, 400);
    }
    const approval = decideBrowserApproval(body.id, body.decision);
    if (!approval) return c.json({ ok: false, error: 'Approval not found.' }, 404);
    return c.json({ ok: true, approval });
  });

  authenticated.get('/api/browser/playwright/doctor', async (c) => {
    try {
      const { playwrightChromiumDoctor } = await import('../../../browser/providers/playwright-doctor.js');
      return c.json({ ok: true, payload: await playwrightChromiumDoctor() });
    } catch (error) {
      return c.json({ ok: false, error: error instanceof Error ? error.message : String(error) }, 500);
    }
  });
}
