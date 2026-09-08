/** Browser Control status, approvals, and driver diagnostics. */
import { getConnInfo } from '@hono/node-server/conninfo';
import type { Context, Hono } from 'hono';

import { createBrowserDriver } from '../../../browser/drivers/create-driver.js';
import { decideBrowserApproval, listBrowserApprovals } from '../../../browser/policy/approval-store.js';
import { checkBrowserReadiness } from '../../../browser/readiness.js';
import { isLoopbackClientIp } from '../../security/loopback.js';
import type { AuthenticatedRouteDeps } from './deps.js';

const EXTENSION_ENDPOINT = 'http://127.0.0.1:19820/';

interface ExtensionStatusPayload {
  running: boolean;
  socketConnected: boolean;
  connected: boolean;
  driverKind: 'extension';
  protocolVersion: number | null;
  expectedProtocolVersion: number | null;
  extensionVersion: string | null;
  artifacts: Record<string, unknown>;
  bridgeHeld: boolean;
  refCount: number;
}

async function extensionStatus(): Promise<ExtensionStatusPayload> {
  const { getExtensionBrowserServerSnapshot } = await import(
    '../../../browser/providers/extension-ws-acquire.js'
  );
  const snapshot = getExtensionBrowserServerSnapshot();
  let running = snapshot.active;
  let socketConnected = false;
  let connected = false;
  let protocolVersion: number | null = null;
  let expectedProtocolVersion: number | null = null;
  let extensionVersion: string | null = null;
  try {
    const response = await fetch(EXTENSION_ENDPOINT, { signal: AbortSignal.timeout(2_000) });
    const payload = await response.json() as {
      ok?: boolean;
      socketConnected?: boolean;
      connected?: boolean;
      protocolVersion?: number | null;
      expectedProtocolVersion?: number;
      extensionVersion?: string | null;
    };
    running ||= payload.ok === true;
    socketConnected = payload.socketConnected ?? payload.connected === true;
    connected = payload.connected === true;
    protocolVersion = typeof payload.protocolVersion === 'number' ? payload.protocolVersion : null;
    expectedProtocolVersion = typeof payload.expectedProtocolVersion === 'number' ? payload.expectedProtocolVersion : null;
    extensionVersion = typeof payload.extensionVersion === 'string' ? payload.extensionVersion : null;
  } catch {
    // A stopped bridge is a valid diagnostic result.
  }

  const { browserExtDoctor } = await import('../../../browser/providers/browser-ext-install.js');
  const doctor = await browserExtDoctor({ runtimeExtensionVersion: extensionVersion ?? undefined });
  return {
    running,
    socketConnected,
    connected,
    driverKind: 'extension',
    protocolVersion,
    expectedProtocolVersion,
    extensionVersion,
    artifacts: {
      installed: doctor.installed,
      bundledAvailable: doctor.bundledAvailable,
      extensionDir: doctor.extensionDir,
      xopcVersion: doctor.xopcVersion,
      installedVersion: doctor.installedVersion,
      needsRefresh: doctor.needsRefresh,
      needsChromeReload: doctor.needsChromeReload || socketConnected && !connected,
    },
    bridgeHeld: snapshot.active,
    refCount: snapshot.refCount,
  };
}

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
    try {
      return c.json(await extensionStatus());
    } catch (error) {
      return c.json({
        running: false,
        connected: false,
        driverKind: 'extension',
        error: error instanceof Error ? error.message : String(error),
      });
    }
  });

  authenticated.get('/api/browser/status', async (c) => {
    const config = service.currentConfig.browser;
    if (!config.enabled) {
      return c.json({ ok: true, payload: { enabled: false, driverKind: config.driver.kind, state: 'disabled' } });
    }
    const readiness = await checkBrowserReadiness(service.currentConfig);
    const driverStatus = config.driver.kind === 'extension'
      ? await extensionStatus().catch((error) => ({ error: error instanceof Error ? error.message : String(error) }))
      : config.driver.kind === 'playwright'
        ? await import('../../../browser/providers/playwright-doctor.js').then(({ playwrightChromiumDoctor }) => playwrightChromiumDoctor())
        : undefined;
    const extensionConnected = config.driver.kind === 'extension'
      ? (driverStatus as { connected?: boolean }).connected === true
      : true;
    const extensionProtocolDetail = config.driver.kind === 'extension'
      && 'socketConnected' in driverStatus
      && driverStatus.socketConnected
      && !driverStatus.connected
      ? `Chrome extension protocol ${driverStatus.protocolVersion ?? 'unknown'} does not match ${driverStatus.expectedProtocolVersion ?? 'the gateway'}. Reload the extension in Chrome.`
      : undefined;
    return c.json({
      ok: true,
      payload: {
        enabled: true,
        driverKind: config.driver.kind,
        state: !readiness && extensionConnected ? 'ready' : 'needs_attention',
        reason: readiness?.hint.reason ?? (extensionConnected ? undefined : 'extension_not_connected'),
        detail: readiness?.hint.detail ?? extensionProtocolDetail,
        driverStatus,
      },
    });
  });

  authenticated.post('/api/browser/test', strictRateLimitMiddleware, async (c) => {
    if (!isLocalOwnerRequest(c, service)) {
      return c.json({ ok: false, error: 'Local owner access required.' }, 403);
    }
    if (!service.currentConfig.browser.enabled) {
      return c.json({ ok: false, error: 'Browser Control is disabled.' }, 400);
    }
    const startedAt = Date.now();
    let driver: Awaited<ReturnType<typeof createBrowserDriver>> | undefined;
    try {
      driver = await createBrowserDriver(service.currentConfig.browser);
      await driver.connect();
      return c.json({
        ok: true,
        payload: { driverKind: service.currentConfig.browser.driver.kind, durationMs: Date.now() - startedAt },
      });
    } catch (error) {
      return c.json({ ok: false, error: error instanceof Error ? error.message : String(error) }, 400);
    } finally {
      await driver?.disconnect().catch(() => {});
    }
  });

  authenticated.post('/api/browser/extension/install', strictRateLimitMiddleware, async (c) => {
    if (!isLocalOwnerRequest(c, service)) {
      return c.json({ ok: false, error: 'Local owner access required.' }, 403);
    }
    const body = await c.req.json().catch(() => ({})) as { force?: unknown };
    try {
      const { browserExtDoctor, ensureBrowserExtensionArtifacts } = await import('../../../browser/providers/browser-ext-install.js');
      const result = await ensureBrowserExtensionArtifacts({ force: body.force === true });
      return c.json({ ok: true, payload: { ...result, doctor: await browserExtDoctor() } });
    } catch (error) {
      return c.json({ ok: false, error: error instanceof Error ? error.message : String(error) }, 500);
    }
  });

  authenticated.post('/api/browser/extension/open', strictRateLimitMiddleware, async (c) => {
    if (!isLocalOwnerRequest(c, service)) {
      return c.json({ ok: false, error: 'Local owner access required.' }, 403);
    }
    const body = await c.req.json().catch(() => ({})) as { action?: unknown };
    const action = body.action === 'chrome' || body.action === 'folder' || body.action === 'both'
      ? body.action
      : 'both';
    try {
      const { openBrowserExtensionInstallUi } = await import('../../../browser/providers/browser-ext-install.js');
      return c.json({ ok: true, payload: await openBrowserExtensionInstallUi({ action }) });
    } catch (error) {
      return c.json({ ok: false, error: error instanceof Error ? error.message : String(error) }, 400);
    }
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
