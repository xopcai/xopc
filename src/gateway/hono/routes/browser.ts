/** Browser Control status, approvals, and driver diagnostics. */
import { getConnInfo } from '@hono/node-server/conninfo';
import type { Context, Hono } from 'hono';
import { browserTabBindingRequestSchema } from '@xopcai/gateway-contract';

import { createBrowserDriver } from '../../../browser/drivers/create-driver.js';
import { decideBrowserApproval, listBrowserApprovals } from '../../../browser/policy/approval-store.js';
import { checkBrowserReadiness } from '../../../browser/readiness.js';
import { isLoopbackClientIp } from '../../security/loopback.js';
import type { AuthenticatedRouteDeps } from './deps.js';
import { getGatewayPrincipal } from '../../security/gateway-principal.js';
import { getDevice } from '../../../storage/sqlite/device-access-repository.js';
import {
  deleteBrowserTabBinding,
  getBrowserTabBinding,
  setBrowserTabBinding,
} from '../../../storage/sqlite/browser-tab-binding-repository.js';

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
  const principal = getGatewayPrincipal(c);
  if (principal.kind !== 'owner' && principal.kind !== 'trusted-proxy') return false;
  if (service.currentConfig.gateway?.bind === 'loopback') return true;
  try {
    return isLoopbackClientIp(getConnInfo(c).remote.address);
  } catch {
    return false;
  }
}

function chromeDevicePrincipal(c: Context) {
  const principal = getGatewayPrincipal(c);
  if (principal.kind !== 'device' || !principal.deviceId) return undefined;
  const device = getDevice(principal.deviceId);
  return device?.platform === 'chrome' && device.revokedAt === undefined ? principal : undefined;
}

function canManageBrowserSession(c: Context, service: AuthenticatedRouteDeps['service'], sessionKey: string): boolean {
  const principal = chromeDevicePrincipal(c);
  if (principal) return getBrowserTabBinding(sessionKey)?.principalId === principal.deviceId;
  return isLocalOwnerRequest(c, service);
}

export function registerBrowserRoutes(authenticated: Hono, deps: AuthenticatedRouteDeps): void {
  const { service, strictRateLimitMiddleware } = deps;

  authenticated.get('/api/browser/tab-bindings/:sessionKey', (c) => {
    const sessionKey = c.req.param('sessionKey').trim();
    const binding = getBrowserTabBinding(sessionKey);
    if (!binding) return c.json({ ok: false, error: { code: 'NOT_FOUND', message: 'Tab binding not found' } }, 404);
    if (!canManageBrowserSession(c, service, sessionKey)) {
      return c.json({ ok: false, error: { code: 'FORBIDDEN', message: 'Tab binding belongs to another device' } }, 403);
    }
    return c.json({ ok: true, payload: binding });
  });

  authenticated.put('/api/browser/tab-bindings/:sessionKey', async (c) => {
    const principal = chromeDevicePrincipal(c);
    if (!principal?.deviceId) {
      return c.json({ ok: false, error: { code: 'FORBIDDEN', message: 'Chrome device access required' } }, 403);
    }
    const parsed = browserTabBindingRequestSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) {
      return c.json({ ok: false, error: { code: 'BAD_REQUEST', message: 'Invalid tab binding' } }, 400);
    }
    const endpoint = service.endpointTools.registry.get(parsed.data.endpointId);
    if (!service.endpointTools.registry.verifyTurnClaim(parsed.data.endpointId, parsed.data.turnToken)
      || endpoint?.kind !== 'browser' || endpoint.principalId !== principal.deviceId) {
      return c.json({ ok: false, error: { code: 'INVALID_ENDPOINT', message: 'Browser endpoint is not active' } }, 401);
    }
    const sessionKey = c.req.param('sessionKey').trim();
    if (!sessionKey || !await service.sessions.getSession(sessionKey)) {
      return c.json({ ok: false, error: { code: 'NOT_FOUND', message: 'Session not found' } }, 404);
    }
    const { turnToken: _turnToken, ...bindingInput } = parsed.data;
    const binding = setBrowserTabBinding({
      ...bindingInput,
      sessionKey,
      principalId: principal.deviceId,
    });
    return c.json({ ok: true, payload: binding });
  });

  authenticated.delete('/api/browser/tab-bindings/:sessionKey', (c) => {
    const sessionKey = c.req.param('sessionKey').trim();
    if (!canManageBrowserSession(c, service, sessionKey)) {
      return c.json({ ok: false, error: { code: 'FORBIDDEN', message: 'Tab binding belongs to another device' } }, 403);
    }
    return c.json({ ok: true, payload: { removed: deleteBrowserTabBinding(sessionKey) } });
  });

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
    const sessionKey = c.req.query('sessionKey');
    if (!isLocalOwnerRequest(c, service) && (!sessionKey || !canManageBrowserSession(c, service, sessionKey))) {
      return c.json({ ok: false, error: 'Local owner access required.' }, 403);
    }
    return c.json({ ok: true, approvals: listBrowserApprovals(sessionKey) });
  });

  authenticated.post('/api/browser/approvals/respond', strictRateLimitMiddleware, async (c) => {
    const body = await c.req.json().catch(() => null) as { id?: unknown; decision?: unknown } | null;
    const approval = typeof body?.id === 'string'
      ? listBrowserApprovals().find((candidate) => candidate.id === body.id)
      : undefined;
    if (!isLocalOwnerRequest(c, service)
      && (!approval || !canManageBrowserSession(c, service, approval.sessionKey))) {
      return c.json({ ok: false, error: 'Local owner access required.' }, 403);
    }
    if (typeof body?.id !== 'string' || (body.decision !== 'approved' && body.decision !== 'denied')) {
      return c.json({ ok: false, error: 'id and decision are required.' }, 400);
    }
    const decided = decideBrowserApproval(body.id, body.decision);
    if (!decided) return c.json({ ok: false, error: 'Approval not found.' }, 404);
    return c.json({ ok: true, approval: decided });
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
