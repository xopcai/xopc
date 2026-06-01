/**
 * Browser/extension settings routes: `/api/browser/*` except for the
 * long-running install streams under `/api/browser/{playwright,cloakbrowser}/install/stream`
 * (those live in `browser-install.ts` so the SSE pump doesn't have to load
 * with the rest of settings).
 *
 * Four backend families:
 *   - **Extension WS bridge** — pair Chrome via the xopc browser extension.
 *     Owns a module-scoped manual handle so the bridge can outlive a config
 *     save (UI flow: Start → pair → Save).
 *   - **CloakBrowser** — install / launch / probe runtime status.
 *   - **Playwright Chromium** — doctor + on-demand install of bundled browser.
 *   - **Local CDP** — launch / list / stop user-driven debug Chrome instances.
 *   - **Cloud providers** (browserbase / browser-use) — connection test.
 *
 * Extracted from `config.ts` (which was 2237 lines and 80% browser routes).
 */
import type { Hono } from 'hono';
import net from 'node:net';

import type { Config } from '../../../config/schema.js';
import type { AuthenticatedRouteDeps } from './deps.js';

const DEFAULT_EXTENSION_PORT = 19820;
const DEFAULT_EXTENSION_HOST = '127.0.0.1';

/**
 * Optional manual hold on the extension WS server kept alive from the UI so
 * users can pair the extension before saving config / running a browser tool.
 * Module-scoped so repeat Start calls are idempotent and the bridge survives
 * config patches.
 */
type ManualHandle = { release: () => Promise<void>; host: string; port: number };
let manualExtensionHandle: ManualHandle | null = null;

function loopbackHostnameFromUrl(input: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(input);
  } catch {
    return null;
  }
  const proto = parsed.protocol;
  if (proto !== 'ws:' && proto !== 'wss:' && proto !== 'http:' && proto !== 'https:') {
    return null;
  }
  const host = parsed.hostname.toLowerCase();
  if (host === '127.0.0.1' || host === 'localhost' || host === '::1') return host;
  return null;
}

function isLoopbackHost(host: string): boolean {
  const h = host.trim().toLowerCase();
  return h === '127.0.0.1' || h === 'localhost' || h === '::1' || h === '[::1]';
}

function parseExtensionProbePort(raw: string | undefined): number | undefined {
  if (!raw) return undefined;
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n) || n < 1024 || n > 65_535) return undefined;
  return n;
}

function isLoopbackPortOpen(host: string, port: number, timeoutMs = 500): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = net.connect({ host, port });
    const finish = (open: boolean) => {
      socket.removeAllListeners();
      try {
        socket.destroy();
      } catch {
        /* */
      }
      resolve(open);
    };
    socket.setTimeout(timeoutMs);
    socket.once('connect', () => finish(true));
    socket.once('timeout', () => finish(false));
    socket.once('error', () => finish(false));
  });
}

async function readExtensionBridgeSnapshot() {
  const { getExtensionBrowserServerSnapshot } = await import(
    '../../../browser/providers/extension-ws-acquire.js'
  );
  return getExtensionBrowserServerSnapshot();
}

async function stopExtensionBridgeFromSettings(service: AuthenticatedRouteDeps['service']): Promise<{
  forcedShutdown: boolean;
}> {
  if (manualExtensionHandle) {
    try {
      await manualExtensionHandle.release();
    } catch {
      /* refcount underflow should not surface */
    }
    manualExtensionHandle = null;
  }
  await service.releaseBrowserExtensionBridge();
  const { forceShutdownExtensionBrowserServer } = await import(
    '../../../browser/providers/extension-ws-acquire.js'
  );
  const forcedShutdown = await forceShutdownExtensionBrowserServer();
  return { forcedShutdown };
}

function resolveExtensionStatusTarget(
  browser: Record<string, unknown> | undefined,
  query: { probe?: string; host?: string; port?: string },
): { host: string; port: number; backend: string } | null {
  const backend = typeof browser?.backend === 'string' ? browser.backend : 'extension';
  const probe = query.probe === '1' || query.probe === 'true';
  if (!probe && backend !== 'extension') {
    return null;
  }

  const ext = browser?.extension as Record<string, unknown> | undefined;
  const configPort =
    typeof ext?.port === 'number' && ext.port >= 1024 && ext.port <= 65_535
      ? Math.floor(ext.port)
      : DEFAULT_EXTENSION_PORT;
  const configHost =
    typeof ext?.host === 'string' && ext.host.trim() ? ext.host.trim() : DEFAULT_EXTENSION_HOST;

  const port = parseExtensionProbePort(query.port) ?? configPort;
  const host =
    typeof query.host === 'string' && query.host.trim() ? query.host.trim() : configHost;
  if (!isLoopbackHost(host)) {
    return null;
  }

  return { host, port, backend: probe && backend !== 'extension' ? 'extension' : backend };
}

export function registerBrowserRoutes(authenticated: Hono, deps: AuthenticatedRouteDeps): void {
  const { service, strictRateLimitMiddleware } = deps;

  // Browser extension bridge status — gateway-side check so frontend doesn't cross-origin fetch.
  authenticated.get('/api/browser/extension-status', async (c) => {
    const config: Config = service.currentConfig as Config;
    const browser = config?.agents?.defaults?.browser as Record<string, unknown> | undefined;
    const target = resolveExtensionStatusTarget(browser, {
      probe: c.req.query('probe'),
      host: c.req.query('host'),
      port: c.req.query('port'),
    });

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
      /* optional */
    }

    if (!target) {
      const backend = typeof browser?.backend === 'string' ? browser.backend : 'extension';
      return c.json({ running: false, connected: false, backend, artifacts });
    }
    const snapshot = await readExtensionBridgeSnapshot();
    let probeRunning = false;
    let probeConnected = false;
    try {
      const res = await fetch(`http://${target.host}:${target.port}/`, { signal: AbortSignal.timeout(2000) });
      const data = (await res.json()) as { ok?: boolean; connected?: boolean };
      probeRunning = Boolean(data.ok);
      probeConnected = Boolean(data.connected);
    } catch {
      /* probe failed — fall through to snapshot / port check */
    }
    const running = probeRunning || snapshot.active;
    const portConflict =
      !running && !snapshot.active
        ? await isLoopbackPortOpen(target.host, target.port)
        : false;
    return c.json({
      running,
      connected: probeConnected,
      backend: target.backend,
      artifacts,
      bridgeHeld: snapshot.active,
      refCount: snapshot.refCount,
      manualBridge: manualExtensionHandle !== null,
      portConflict,
    });
  });

  authenticated.get('/api/browser/extension/doctor', async (c) => {
    const cacheDirRaw = c.req.query('cacheDir');
    try {
      const { browserExtDoctor } = await import('../../../browser/providers/browser-ext-install.js');
      const status = await browserExtDoctor({
        cacheDir: cacheDirRaw && cacheDirRaw.trim() ? cacheDirRaw.trim() : undefined,
      });
      return c.json({ ok: true, payload: status });
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      return c.json({ ok: false, error: message }, 400);
    }
  });

  authenticated.post('/api/browser/extension/install', strictRateLimitMiddleware, async (c) => {
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      body = {};
    }
    const input = body && typeof body === 'object' && !Array.isArray(body)
      ? (body as Record<string, unknown>)
      : {};
    const cacheDir = typeof input.cacheDir === 'string' && input.cacheDir.trim()
      ? input.cacheDir.trim()
      : undefined;
    const force = input.force === true;

    try {
      const { ensureBrowserExtensionArtifacts, browserExtDoctor } = await import(
        '../../../browser/providers/browser-ext-install.js'
      );
      const result = await ensureBrowserExtensionArtifacts({ cacheDir, force });
      const doctor = await browserExtDoctor({ cacheDir });
      return c.json({ ok: true, payload: { ...result, doctor } });
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      return c.json({ ok: false, error: message }, 500);
    }
  });

  authenticated.post('/api/browser/extension/open', strictRateLimitMiddleware, async (c) => {
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      body = {};
    }
    const input = body && typeof body === 'object' && !Array.isArray(body)
      ? (body as Record<string, unknown>)
      : {};
    const cacheDir = typeof input.cacheDir === 'string' && input.cacheDir.trim()
      ? input.cacheDir.trim()
      : undefined;
    const actionRaw = typeof input.action === 'string' ? input.action.trim() : 'both';
    const action =
      actionRaw === 'chrome' || actionRaw === 'folder' || actionRaw === 'both' ? actionRaw : 'both';

    try {
      const { openBrowserExtensionInstallUi } = await import(
        '../../../browser/providers/browser-ext-install.js'
      );
      const result = await openBrowserExtensionInstallUi({ action, cacheDir });
      return c.json({ ok: true, payload: result });
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      return c.json({ ok: false, error: message }, 500);
    }
  });

  // Start the extension WS bridge eagerly so the user can pair the extension
  // before saving config / running any tool. Idempotent (returns current state
  // if already running).
  authenticated.post('/api/browser/extension/start', strictRateLimitMiddleware, async (c) => {
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      body = {};
    }
    const input = body && typeof body === 'object' && !Array.isArray(body)
      ? (body as Record<string, unknown>)
      : {};
    const port =
      typeof input.port === 'number' && input.port >= 1024 && input.port <= 65535
        ? Math.floor(input.port)
        : DEFAULT_EXTENSION_PORT;
    const hostRaw = typeof input.host === 'string' && input.host.trim() ? input.host.trim() : DEFAULT_EXTENSION_HOST;
    if (!isLoopbackHost(hostRaw)) {
      return c.json({ ok: false, error: 'extension bridge host must be loopback' }, 400);
    }

    try {
      if (manualExtensionHandle && (manualExtensionHandle.host !== hostRaw || manualExtensionHandle.port !== port)) {
        await manualExtensionHandle.release();
        manualExtensionHandle = null;
      }
      if (!manualExtensionHandle) {
        const { acquireExtensionBrowserServer } = await import(
          '../../../browser/providers/extension-ws-acquire.js'
        );
        const { release } = await acquireExtensionBrowserServer({ host: hostRaw, port });
        manualExtensionHandle = { release, host: hostRaw, port };
      }
      return c.json({ ok: true, payload: { running: true, host: hostRaw, port } });
    } catch (e) {
      return c.json({ ok: false, error: e instanceof Error ? e.message : String(e) }, 500);
    }
  });

  authenticated.post('/api/browser/extension/stop', strictRateLimitMiddleware, async (c) => {
    try {
      const { forcedShutdown } = await stopExtensionBridgeFromSettings(service);
      return c.json({
        ok: true,
        payload: { running: false, forcedShutdown },
      });
    } catch (e) {
      return c.json({ ok: false, error: e instanceof Error ? e.message : String(e) }, 500);
    }
  });

  authenticated.post('/api/browser/extension/disconnect', strictRateLimitMiddleware, async (c) => {
    try {
      const { getExtensionBrowserProvider } = await import(
        '../../../browser/providers/extension-ws-acquire.js'
      );
      const provider = getExtensionBrowserProvider();
      if (!provider?.isConnected()) {
        return c.json({
          ok: true,
          payload: { connected: false, alreadyDisconnected: true },
        });
      }
      provider.disconnectClient();
      return c.json({ ok: true, payload: { connected: false } });
    } catch (e) {
      return c.json({ ok: false, error: e instanceof Error ? e.message : String(e) }, 500);
    }
  });

  // Doctor: does Playwright have a runnable Chromium on disk?
  authenticated.get('/api/browser/playwright/doctor', async (c) => {
    try {
      const { playwrightChromiumDoctor } = await import('../../../browser/providers/playwright-doctor.js');
      const payload = await playwrightChromiumDoctor();
      return c.json({ ok: true, payload });
    } catch (e) {
      return c.json(
        { ok: false, error: e instanceof Error ? e.message : String(e) },
        500,
      );
    }
  });

  // Doctor: CloakBrowser installed?
  authenticated.get('/api/browser/cloakbrowser/doctor', async (c) => {
    const cacheDirRaw = c.req.query('cacheDir');
    const binaryPathRaw = c.req.query('binaryPath');
    try {
      const { cloakBrowserDoctor } = await import('../../../browser/providers/cloakbrowser.js');
      const status = await cloakBrowserDoctor({
        cacheDir: cacheDirRaw && cacheDirRaw.trim() ? cacheDirRaw.trim() : undefined,
        binaryPath: binaryPathRaw && binaryPathRaw.trim() ? binaryPathRaw.trim() : undefined,
      });
      return c.json({ ok: true, payload: status });
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      return c.json({ ok: false, error: message }, 400);
    }
  });

  // Runtime status for CloakBrowser (CDP port + profile dir from saved agent defaults).
  authenticated.get('/api/browser/cloakbrowser/status', async (c) => {
    try {
      const { cloakBrowserConfigFromAgentDefaults } = await import('../../../browser/backend-from-config.js');
      const { probeCloakBrowserRuntime } = await import('../../../browser/providers/cloakbrowser.js');
      const config = cloakBrowserConfigFromAgentDefaults(service.currentConfig as Config);
      const status = await probeCloakBrowserRuntime(config);
      return c.json({ ok: true, payload: status });
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      return c.json({ ok: false, error: message }, 500);
    }
  });

  // Open CloakBrowser with the same profile/settings agents use (saved config, headed).
  authenticated.post('/api/browser/cloakbrowser/launch', strictRateLimitMiddleware, async (c) => {
    try {
      const { cloakBrowserConfigFromAgentDefaults } = await import('../../../browser/backend-from-config.js');
      const { launchCloakBrowser } = await import('../../../browser/providers/cloakbrowser.js');
      const config = cloakBrowserConfigFromAgentDefaults(service.currentConfig as Config);
      const result = await launchCloakBrowser({
        ...config,
        skipPlaywrightConnect: true,
      });
      return c.json({
        ok: true,
        payload: {
          running: true,
          reused: result.reused,
          port: result.cdpPort,
          pid: result.pid,
          userDataDir: result.userDataDir,
          temporaryProfile: config.temporaryProfile === true,
        },
      });
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      return c.json({ ok: false, error: message }, 500);
    }
  });

  // Ping a user-supplied CDP endpoint — loopback only (SSRF guard).
  authenticated.post('/api/browser/cdp/ping', strictRateLimitMiddleware, async (c) => {
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ ok: false, error: 'invalid JSON body' }, 400);
    }
    const input = body && typeof body === 'object' && !Array.isArray(body)
      ? (body as Record<string, unknown>)
      : {};
    const cdpUrl = typeof input.cdpUrl === 'string' ? input.cdpUrl.trim() : '';
    if (!cdpUrl) return c.json({ ok: false, error: 'cdpUrl is required' }, 400);

    const loopback = loopbackHostnameFromUrl(cdpUrl);
    if (!loopback) {
      return c.json(
        { ok: false, error: 'CDP ping only allowed for loopback hosts (127.0.0.1 / localhost / ::1)' },
        403,
      );
    }
    let httpBase: URL;
    try {
      httpBase = new URL(cdpUrl);
      httpBase.protocol = httpBase.protocol === 'wss:' ? 'https:' : 'http:';
      httpBase.pathname = '/json/version';
      httpBase.search = '';
      httpBase.hash = '';
    } catch (e) {
      return c.json({ ok: false, error: e instanceof Error ? e.message : 'invalid cdpUrl' }, 400);
    }
    try {
      const res = await fetch(httpBase.toString(), { signal: AbortSignal.timeout(2000) });
      if (!res.ok) {
        return c.json({ ok: true, payload: { reachable: false, status: res.status } });
      }
      const data = (await res.json()) as { Browser?: string; 'Protocol-Version'?: string; webSocketDebuggerUrl?: string };
      return c.json({
        ok: true,
        payload: {
          reachable: true,
          browser: data.Browser ?? null,
          protocolVersion: data['Protocol-Version'] ?? null,
          webSocketDebuggerUrl: data.webSocketDebuggerUrl ?? null,
        },
      });
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      return c.json({ ok: true, payload: { reachable: false, error: message } });
    }
  });

  // Spawn a local debuggable Chrome and return its WS endpoint.
  authenticated.post('/api/browser/cdp/launch', strictRateLimitMiddleware, async (c) => {
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      body = {};
    }
    const input = body && typeof body === 'object' && !Array.isArray(body)
      ? (body as Record<string, unknown>)
      : {};
    const executablePath =
      typeof input.executablePath === 'string' && input.executablePath.trim()
        ? input.executablePath.trim()
        : undefined;
    try {
      const { launchLocalCdpChrome } = await import('../../../browser/cdp-local-launcher.js');
      const result = await launchLocalCdpChrome({ executablePath });
      return c.json({ ok: true, payload: result });
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      return c.json({ ok: false, error: message }, 500);
    }
  });

  authenticated.post('/api/browser/cdp/stop', strictRateLimitMiddleware, async (c) => {
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ ok: false, error: 'invalid JSON body' }, 400);
    }
    const input = body && typeof body === 'object' && !Array.isArray(body)
      ? (body as Record<string, unknown>)
      : {};
    const port = typeof input.port === 'number' && Number.isInteger(input.port) ? input.port : NaN;
    if (!Number.isFinite(port) || port < 1024 || port > 65535) {
      return c.json({ ok: false, error: 'port must be an integer in [1024, 65535]' }, 400);
    }
    const { stopLocalCdpChrome } = await import('../../../browser/cdp-local-launcher.js');
    const stopped = await stopLocalCdpChrome(port);
    return c.json({ ok: true, payload: { stopped } });
  });

  authenticated.get('/api/browser/cdp/instances', async (c) => {
    const { listLocalCdpInstances } = await import('../../../browser/cdp-local-launcher.js');
    return c.json({ ok: true, payload: { instances: listLocalCdpInstances() } });
  });

  // Cloud provider connection test.
  authenticated.post('/api/browser/cloud/test-connection', strictRateLimitMiddleware, async (c) => {
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ ok: false, error: 'invalid JSON body' }, 400);
    }
    const input = body && typeof body === 'object' && !Array.isArray(body)
      ? (body as Record<string, unknown>)
      : {};
    const provider = input.provider;
    const apiKeyRaw = typeof input.apiKey === 'string' ? input.apiKey.trim() : '';

    // The masked sentinel means "use the stored config key".
    let apiKey = apiKeyRaw;
    if (apiKey === '***' || apiKey === '••••••••••••') {
      const stored =
        (service.currentConfig as Config)?.agents?.defaults?.browser?.cloud?.apiKey;
      apiKey = typeof stored === 'string' ? stored.trim() : '';
    }
    if (!apiKey) {
      if (provider === 'browserbase') apiKey = process.env.BROWSERBASE_API_KEY ?? '';
      else if (provider === 'browser-use') apiKey = process.env.BROWSER_USE_API_KEY ?? '';
    }
    if (!apiKey) {
      return c.json({ ok: true, payload: { reachable: false, error: 'No API key configured' } });
    }

    try {
      if (provider === 'browserbase') {
        const res = await fetch('https://api.browserbase.com/v1/projects', {
          headers: { 'x-bb-api-key': apiKey },
          signal: AbortSignal.timeout(5000),
        });
        if (!res.ok) {
          return c.json({
            ok: true,
            payload: { reachable: false, status: res.status, error: await res.text().catch(() => '') },
          });
        }
        const data = (await res.json().catch(() => null)) as unknown;
        const projects = Array.isArray(data) ? data : Array.isArray((data as { data?: unknown[] })?.data) ? (data as { data: unknown[] }).data : [];
        return c.json({ ok: true, payload: { reachable: true, projectCount: projects.length } });
      }
      if (provider === 'browser-use') {
        const res = await fetch('https://api.browser-use.com/api/v1/users/me', {
          headers: { Authorization: `Bearer ${apiKey}` },
          signal: AbortSignal.timeout(5000),
        });
        if (!res.ok) {
          return c.json({
            ok: true,
            payload: { reachable: false, status: res.status, error: await res.text().catch(() => '') },
          });
        }
        return c.json({ ok: true, payload: { reachable: true } });
      }
      return c.json({ ok: false, error: 'provider must be browserbase or browser-use' }, 400);
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      return c.json({ ok: true, payload: { reachable: false, error: message } });
    }
  });

  authenticated.post('/api/browser/playwright/install', strictRateLimitMiddleware, async (c) => {
    try {
      const { installPlaywrightChromium } = await import('../../../browser/providers/playwright-install.js');
      const payload = await installPlaywrightChromium();
      return c.json({ ok: true, payload });
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      return c.json({ ok: false, error: message || 'Failed to install Playwright Chromium' }, 500);
    }
  });

  authenticated.post('/api/browser/cloakbrowser/install', strictRateLimitMiddleware, async (c) => {
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      body = {};
    }
    const input = body && typeof body === 'object' && !Array.isArray(body)
      ? (body as Record<string, unknown>)
      : {};
    const cacheDir = typeof input.cacheDir === 'string' && input.cacheDir.trim()
      ? input.cacheDir.trim()
      : undefined;
    const binaryPath = typeof input.binaryPath === 'string' && input.binaryPath.trim()
      ? input.binaryPath.trim()
      : undefined;

    try {
      const { installCloakBrowser } = await import('../../../browser/providers/cloakbrowser.js');
      const status = await installCloakBrowser({ cacheDir, binaryPath });
      return c.json({ ok: true, payload: status });
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      return c.json({ ok: false, error: message }, 500);
    }
  });
}
