/** Browser Control status and driver diagnostics. */
import { bodyLimit } from 'hono/body-limit';
import { getConnInfo } from '@hono/node-server/conninfo';
import type { Context, Hono } from 'hono';
import { z } from 'zod';
import { browserTabBindingRequestSchema } from '@xopcai/gateway-contract';
import { BROWSER_EXTENSION_PROTOCOL_VERSION, BROWSER_CONTROL_ENDPOINT_TOOL_NAME } from '@xopcai/browser-control-contract';

import { ManagedBrowserLiveError } from '../../../browser/managed-live-runtime.js';
import { createBrowserDriver } from '../../../browser/drivers/create-driver.js';
import { checkBrowserReadiness } from '../../../browser/readiness.js';
import { isLoopbackClientIp } from '../../security/loopback.js';
import type { AuthenticatedRouteDeps } from './deps.js';
import { getGatewayPrincipal } from '../../security/gateway-principal.js';
import { hasGatewayScope } from '../../security/gateway-scopes.js';
import { getDevice } from '../../../storage/sqlite/device-access-repository.js';
import {
  deleteBrowserTabBinding,
  getBrowserTabBinding,
  setBrowserTabBinding,
} from '../../../storage/sqlite/browser-tab-binding-repository.js';

interface ExtensionStatusPayload {
  running: boolean;
  socketConnected: boolean;
  connected: boolean;
  localConnected: boolean;
  localManagementAvailable: boolean;
  driverKind: 'extension';
  protocolVersion: number | null;
  expectedProtocolVersion: number | null;
  extensionVersion: string | null;
  endpoints: Array<{
    endpointId: string;
    principalId: string;
    displayName: string;
    platform: string;
    appVersion: string;
    lastHeartbeatAt: number;
  }>;
  artifacts: Record<string, unknown>;
  bridgeHeld: boolean;
  refCount: number;
  transport: 'gateway-realtime';
  setupState?: 'not_installed' | 'installed_not_connected' | 'connected';
}

async function extensionStatus(
  service: AuthenticatedRouteDeps['service'],
  includeLocalArtifacts: boolean,
): Promise<ExtensionStatusPayload> {
  const endpoints = service.endpointTools.registry.list()
    .filter((item) => item.kind === 'browser'
      && item.tools.some((tool) => tool.descriptor.name === BROWSER_CONTROL_ENDPOINT_TOOL_NAME))
    .sort((left, right) => right.lastHeartbeatAt - left.lastHeartbeatAt);
  const endpoint = endpoints[0];
  const connected = endpoints.length > 0;
  const localConnected = endpoints.some((item) => item.localTransport === true);
  const extensionVersion = endpoint?.appVersion ?? null;

  const doctor = includeLocalArtifacts
    ? await import('../../../browser/providers/browser-ext-install.js')
      .then(({ browserExtDoctor }) => browserExtDoctor({ runtimeExtensionVersion: extensionVersion ?? undefined }))
    : undefined;
  const setupState = connected
    ? 'connected'
    : doctor
      ? doctor.installed === true ? 'installed_not_connected' : 'not_installed'
      : undefined;
  return {
    running: true,
    socketConnected: connected,
    connected,
    localConnected,
    localManagementAvailable: includeLocalArtifacts,
    driverKind: 'extension',
    protocolVersion: connected ? BROWSER_EXTENSION_PROTOCOL_VERSION : null,
    expectedProtocolVersion: BROWSER_EXTENSION_PROTOCOL_VERSION,
    extensionVersion,
    endpoints: endpoints.map((item) => ({
      endpointId: item.endpointId,
      principalId: item.principalId,
      displayName: item.displayName,
      platform: item.platform,
      appVersion: item.appVersion,
      lastHeartbeatAt: item.lastHeartbeatAt,
    })),
    artifacts: {
      ...(doctor ? {
        installed: doctor.installed,
        bundledAvailable: doctor.bundledAvailable,
        extensionDir: doctor.extensionDir,
        xopcVersion: doctor.xopcVersion,
        installedVersion: doctor.installedVersion,
        needsRefresh: doctor.needsRefresh,
        needsChromeReload: doctor.needsChromeReload,
        nativeHost: doctor.nativeHost,
      } : {}),
    },
    bridgeHeld: false,
    refCount: endpoints.length,
    transport: 'gateway-realtime',
    ...(setupState ? { setupState } : {}),
  };
}

export function isLocalOwnerRequest(c: Context, service: AuthenticatedRouteDeps['service']): boolean {
  const principal = getGatewayPrincipal(c);
  if (principal.kind !== 'owner' && principal.kind !== 'trusted-proxy') return false;
  if (service.currentConfig.gateway?.bind === 'loopback') return true;
  try {
    return isLoopbackClientIp(getConnInfo(c).remote.address);
  } catch {
    return false;
  }
}

function isOwnerRequest(c: Context): boolean {
  const principal = getGatewayPrincipal(c);
  return principal.kind === 'owner' || principal.kind === 'trusted-proxy';
}

function chromeDevicePrincipal(c: Context) {
  const principal = getGatewayPrincipal(c);
  if (principal.kind !== 'device' || !principal.deviceId) return undefined;
  const device = getDevice(principal.deviceId);
  return device?.platform === 'chrome' && device.revokedAt === undefined ? principal : undefined;
}

function canManageBrowserSession(c: Context, service: AuthenticatedRouteDeps['service'], conversationId: string): boolean {
  const principal = chromeDevicePrincipal(c);
  if (principal) return getBrowserTabBinding(conversationId)?.principalId === principal.deviceId;
  return isLocalOwnerRequest(c, service);
}

function canViewBrowserPreview(c: Context): boolean {
  const principal = getGatewayPrincipal(c);
  if (!hasGatewayScope(principal.scopes, 'sessions.read') || !hasGatewayScope(principal.scopes, 'agents.run')) return false;
  if (principal.kind === 'owner' || principal.kind === 'trusted-proxy') return true;
  if (principal.kind !== 'device' || !principal.deviceId) return false;
  const device = getDevice(principal.deviceId);
  return device?.platform === 'android' && device.revokedAt === undefined;
}

const managedClientIdSchema = z.string().min(1).max(160);
const managedTakeoverBodySchema = z.strictObject({
  clientId: managedClientIdSchema,
});
const managedEpochBodySchema = z.strictObject({
  clientId: managedClientIdSchema,
  epoch: z.number().int().positive(),
});
const managedOptionalEpochBodySchema = z.strictObject({
  clientId: managedClientIdSchema,
  epoch: z.number().int().positive().optional(),
});
const managedInteractiveEventSchema = z.discriminatedUnion('kind', [
  z.strictObject({
    kind: z.literal('pointer'),
    phase: z.enum(['down', 'move', 'up', 'cancel', 'click']),
    x: z.number().min(0).max(1),
    y: z.number().min(0).max(1),
    button: z.enum(['left', 'right', 'middle']).optional(),
  }),
  z.strictObject({
    kind: z.literal('wheel'),
    x: z.number().min(0).max(1),
    y: z.number().min(0).max(1),
    deltaX: z.number().min(-2000).max(2000),
    deltaY: z.number().min(-2000).max(2000),
  }),
  z.strictObject({
    kind: z.literal('text'),
    text: z.string().min(1).max(1024),
  }),
  z.strictObject({
    kind: z.literal('key'),
    key: z.enum(['Enter', 'Backspace', 'Tab', 'Escape', 'Delete', 'Home', 'End', 'PageUp', 'PageDown', 'Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight']),
  }),
  z.strictObject({
    kind: z.literal('navigate'),
    action: z.enum(['back', 'forward', 'reload']),
  }),
]);
const managedInputBodySchema = z.strictObject({
  clientId: managedClientIdSchema,
  epoch: z.number().int().positive(),
  seq: z.number().int().positive(),
  event: managedInteractiveEventSchema,
});

function managedActor(c: Context, clientId: string) {
  const principal = getGatewayPrincipal(c);
  const device = principal.kind === 'device' && principal.deviceId ? getDevice(principal.deviceId) : undefined;
  return {
    actorKey: `${principal.principalId}:${clientId}`,
    principalId: principal.principalId,
    deviceName: device?.displayName || (principal.kind === 'device' ? 'Mobile' : 'xopc'),
  };
}

function managedErrorResponse(c: Context, error: unknown) {
  if (error instanceof ManagedBrowserLiveError) {
    return c.json({ ok: false, error: { code: error.code, message: error.message } }, error.status as 404 | 409 | 429);
  }
  return c.json({ ok: false, error: { code: 'BROWSER_LIVE_ERROR', message: error instanceof Error ? error.message : String(error) } }, 500);
}

export function registerBrowserRoutes(authenticated: Hono, deps: AuthenticatedRouteDeps): void {
  const { service, strictRateLimitMiddleware } = deps;

  authenticated.get('/api/browser/preview/:conversationId', (c) => {
    c.header('Cache-Control', 'no-store');
    if (!canViewBrowserPreview(c)) return c.json({ available: false });
    const conversationId = c.req.param('conversationId');
    const clientId = c.req.query('clientId')?.trim() || c.req.header('X-Xopc-Client-Id')?.trim();
    const actorKey = clientId ? `${getGatewayPrincipal(c).principalId}:${clientId}` : undefined;
    const managed = service.managedBrowserLive?.status(conversationId, actorKey);
    if (managed) return c.json(managed);
    const available = service.browserPreviews.available(conversationId);
    return c.json(available ? { available: true, mode: 'extension' as const } : { available: false });
  });

  authenticated.get('/api/browser/managed/:conversationId/frame', async (c) => {
    c.header('Cache-Control', 'no-store');
    if (!canViewBrowserPreview(c) || !service.managedBrowserLive) return c.body(null, 403);
    const after = Number(c.req.query('after') ?? '0');
    if (!Number.isSafeInteger(after) || after < 0) return c.body(null, 400);
    const clientId = c.req.query('clientId')?.trim() || c.req.header('X-Xopc-Client-Id')?.trim() || 'viewer';
    const actorKey = `${getGatewayPrincipal(c).principalId}:${clientId}`;
    const result = await service.managedBrowserLive.waitForFrame(
      c.req.param('conversationId'),
      actorKey,
      after,
      1200,
      c.req.raw.signal,
    );
    if (result.kind === 'unavailable') return c.body(null, 404);
    if (result.kind === 'privacy_paused') return c.body(null, 423);
    if (result.kind === 'empty') return c.body(null, 204);
    c.header('Content-Type', 'image/jpeg');
    c.header('X-Xopc-Preview-Frame', String(result.frame.seq));
    c.header('X-Xopc-Viewport-Width', String(result.frame.width));
    c.header('X-Xopc-Viewport-Height', String(result.frame.height));
    return c.body(Uint8Array.from(result.frame.bytes));
  });

  authenticated.post('/api/browser/managed/:conversationId/takeover', async (c) => {
    c.header('Cache-Control', 'no-store');
    if (!canViewBrowserPreview(c) || !service.managedBrowserLive) return c.json({ ok: false, error: { code: 'FORBIDDEN', message: 'Browser takeover is not authorized.' } }, 403);
    const parsed = managedTakeoverBodySchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ ok: false, error: { code: 'BAD_REQUEST', message: 'Invalid takeover request.' } }, 400);
    try {
      const payload = await service.managedBrowserLive.takeover(c.req.param('conversationId'), managedActor(c, parsed.data.clientId));
      return c.json({ ok: true, payload });
    } catch (error) {
      return managedErrorResponse(c, error);
    }
  });

  authenticated.post('/api/browser/managed/:conversationId/heartbeat', async (c) => {
    c.header('Cache-Control', 'no-store');
    if (!canViewBrowserPreview(c) || !service.managedBrowserLive) return c.json({ ok: false, error: { code: 'FORBIDDEN', message: 'Browser control is not authorized.' } }, 403);
    const parsed = managedEpochBodySchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ ok: false, error: { code: 'BAD_REQUEST', message: 'Invalid heartbeat request.' } }, 400);
    try {
      const actor = managedActor(c, parsed.data.clientId);
      const payload = service.managedBrowserLive.heartbeat(c.req.param('conversationId'), actor.actorKey, parsed.data.epoch);
      return c.json({ ok: true, payload });
    } catch (error) {
      return managedErrorResponse(c, error);
    }
  });

  authenticated.post('/api/browser/managed/:conversationId/release', async (c) => {
    c.header('Cache-Control', 'no-store');
    if (!canViewBrowserPreview(c) || !service.managedBrowserLive) return c.json({ ok: false, error: { code: 'FORBIDDEN', message: 'Browser control is not authorized.' } }, 403);
    const parsed = managedOptionalEpochBodySchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ ok: false, error: { code: 'BAD_REQUEST', message: 'Invalid release request.' } }, 400);
    const actor = managedActor(c, parsed.data.clientId);
    const payload = service.managedBrowserLive.release(c.req.param('conversationId'), actor.actorKey, parsed.data.epoch);
    return c.json({ ok: true, payload: payload ?? null });
  });

  authenticated.post('/api/browser/managed/:conversationId/handback', async (c) => {
    c.header('Cache-Control', 'no-store');
    if (!canViewBrowserPreview(c) || !service.managedBrowserLive) return c.json({ ok: false, error: { code: 'FORBIDDEN', message: 'Browser handback is not authorized.' } }, 403);
    const parsed = managedOptionalEpochBodySchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ ok: false, error: { code: 'BAD_REQUEST', message: 'Invalid handback request.' } }, 400);
    try {
      const actor = managedActor(c, parsed.data.clientId);
      const payload = service.managedBrowserLive.handback(c.req.param('conversationId'), actor.actorKey, parsed.data.epoch);
      return c.json({ ok: true, payload });
    } catch (error) {
      return managedErrorResponse(c, error);
    }
  });

  authenticated.post('/api/browser/managed/:conversationId/input', bodyLimit({ maxSize: 16 * 1024 }), async (c) => {
    c.header('Cache-Control', 'no-store');
    if (!canViewBrowserPreview(c) || !service.managedBrowserLive) return c.json({ ok: false, error: { code: 'FORBIDDEN', message: 'Browser input is not authorized.' } }, 403);
    const parsed = managedInputBodySchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ ok: false, error: { code: 'BAD_REQUEST', message: 'Invalid browser input payload.' } }, 400);
    try {
      const actor = managedActor(c, parsed.data.clientId);
      await service.managedBrowserLive.input(
        c.req.param('conversationId'),
        actor.actorKey,
        parsed.data.epoch,
        parsed.data.seq,
        parsed.data.event,
      );
      return c.body(null, 204);
    } catch (error) {
      return managedErrorResponse(c, error);
    }
  });

  const snapshotPath = '/api/browser/preview/:requestId/snapshot';
  authenticated.post(snapshotPath, bodyLimit({ maxSize: 80 * 1024 }), async (c) => {
    c.header('Cache-Control', 'no-store');
    const chrome = chromeDevicePrincipal(c);
    const token = c.req.header('X-Xopc-Preview');
    if (!chrome || !token || c.req.header('Content-Type') !== 'image/jpeg') return c.body(null, 403);
    const bytes = new Uint8Array(await c.req.arrayBuffer());
    const stored = service.browserPreviews.publishSnapshot(c.req.param('requestId'), chrome.principalId, token, bytes);
    return c.body(null, stored ? 204 : 404);
  });

  authenticated.get(snapshotPath, (c) => {
    c.header('Cache-Control', 'no-store');
    const token = c.req.header('X-Xopc-Preview');
    if (!token) return c.body(null, 403);
    const after = Number(c.req.query('after') ?? '0');
    if (!Number.isSafeInteger(after) || after < 0) return c.body(null, 400);
    const result = service.browserPreviews.readSnapshot(c.req.param('requestId'), getGatewayPrincipal(c).principalId, token, after);
    if (!result) return c.body(null, 404);
    if (!result.snapshot) return c.body(null, 204);
    c.header('Content-Type', 'image/jpeg');
    c.header('X-Xopc-Preview-Frame', String(result.snapshot.version));
    return c.body(Uint8Array.from(result.snapshot.bytes));
  });

  authenticated.get('/api/browser/tabs', (c) => {
    const conversationId = (c.req.query('conversationId') ?? '').trim();
    if (!conversationId) {
      return c.json({ ok: false, error: { code: 'BAD_REQUEST', message: 'Missing conversationId' } }, 400);
    }
    const binding = getBrowserTabBinding(conversationId);
    if (!binding) return c.json({ ok: true, payload: { tabs: [] } });
    if (!canManageBrowserSession(c, service, conversationId)) {
      return c.json({ ok: false, error: { code: 'FORBIDDEN', message: 'Tab binding belongs to another device' } }, 403);
    }
    return c.json({
      ok: true,
      payload: {
        tabs: [{
          id: binding.id,
          title: new URL(binding.urlOrigin).hostname,
          url: binding.urlOrigin,
          documentId: binding.documentId,
          active: true,
        }],
      },
    });
  });

  authenticated.get('/api/browser/tab-bindings/:conversationId', (c) => {
    const conversationId = c.req.param('conversationId').trim();
    const binding = getBrowserTabBinding(conversationId);
    if (!binding) return c.json({ ok: false, error: { code: 'NOT_FOUND', message: 'Tab binding not found' } }, 404);
    if (!canManageBrowserSession(c, service, conversationId)) {
      return c.json({ ok: false, error: { code: 'FORBIDDEN', message: 'Tab binding belongs to another device' } }, 403);
    }
    return c.json({ ok: true, payload: binding });
  });

  authenticated.put('/api/browser/tab-bindings/:conversationId', async (c) => {
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
    const conversationId = c.req.param('conversationId').trim();
    if (!conversationId || !await service.sessions.getSession(conversationId)) {
      return c.json({ ok: false, error: { code: 'NOT_FOUND', message: 'Session not found' } }, 404);
    }
    const { turnToken: _turnToken, ...bindingInput } = parsed.data;
    const binding = setBrowserTabBinding({
      ...bindingInput,
      conversationId,
      principalId: principal.deviceId,
    });
    return c.json({ ok: true, payload: binding });
  });

  authenticated.delete('/api/browser/tab-bindings/:conversationId', (c) => {
    const conversationId = c.req.param('conversationId').trim();
    if (!canManageBrowserSession(c, service, conversationId)) {
      return c.json({ ok: false, error: { code: 'FORBIDDEN', message: 'Tab binding belongs to another device' } }, 403);
    }
    return c.json({ ok: true, payload: { removed: deleteBrowserTabBinding(conversationId) } });
  });

  authenticated.get('/api/browser/extension-status', async (c) => {
    try {
      return c.json(await extensionStatus(service, isLocalOwnerRequest(c, service)));
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
    const localManagementAvailable = isLocalOwnerRequest(c, service);
    if (!config.enabled) {
      return c.json({ ok: true, payload: { enabled: false, driverKind: config.driver.kind, state: 'disabled' } });
    }
    const driverStatus = config.driver.kind === 'extension'
      ? await extensionStatus(service, localManagementAvailable)
        .catch((error) => ({ error: error instanceof Error ? error.message : String(error) }))
      : config.driver.kind === 'playwright'
        ? await import('../../../browser/providers/playwright-doctor.js').then(({ playwrightChromiumDoctor }) => playwrightChromiumDoctor())
        : undefined;
    const extensionConnected = config.driver.kind === 'extension'
      ? (driverStatus as { connected?: boolean }).connected === true
      : true;
    const readiness = await checkBrowserReadiness(service.currentConfig, {
      extensionConnected,
      checkExtensionInstall: localManagementAvailable,
    });
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
        localManagementAvailable,
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
      driver = await createBrowserDriver(service.currentConfig.browser, service.endpointTools);
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
      const {
        browserExtDoctor,
        ensureBrowserExtensionArtifacts,
        installBrowserNativeMessagingHost,
      } = await import('../../../browser/providers/browser-ext-install.js');
      const result = await ensureBrowserExtensionArtifacts({ force: body.force === true });
      const nativeHost = await installBrowserNativeMessagingHost({
        configPath: service.getHealth().configPath,
      });
      return c.json({ ok: true, payload: { ...result, nativeHost, doctor: await browserExtDoctor() } });
    } catch (error) {
      return c.json({ ok: false, error: error instanceof Error ? error.message : String(error) }, 500);
    }
  });

  authenticated.get('/api/browser/extension/archive', strictRateLimitMiddleware, async (c) => {
    if (!isOwnerRequest(c)) {
      return c.json({ ok: false, error: 'Owner access required.' }, 403);
    }
    try {
      const { createBrowserExtensionArchive } = await import('../../../browser/providers/browser-ext-install.js');
      const archive = await createBrowserExtensionArchive();
      const body = new Uint8Array(archive.data.byteLength);
      body.set(archive.data);
      return c.body(body, 200, {
        'Content-Type': 'application/zip',
        'Content-Disposition': `attachment; filename="${archive.filename}"`,
        'Cache-Control': 'private, no-store',
      });
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

  authenticated.get('/api/browser/playwright/doctor', async (c) => {
    try {
      const { playwrightChromiumDoctor } = await import('../../../browser/providers/playwright-doctor.js');
      return c.json({ ok: true, payload: await playwrightChromiumDoctor() });
    } catch (error) {
      return c.json({ ok: false, error: error instanceof Error ? error.message : String(error) }, 500);
    }
  });
}
