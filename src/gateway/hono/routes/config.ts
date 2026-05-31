import type { Hono } from 'hono';
import net from 'node:net';

import { type Config, BindingsConfigSchema, McpConfigSchema, type GatewayBindMode } from '../../../config/schema.js';
import {
  isValidIPv4,
} from '../../../config/gateway-bind.js';
import { assertGatewayRuntimeConfig } from '../../runtime-config.js';
import { resolveGatewayAuth, assertGatewayAuthConfigured } from '../../auth.js';
import { canonicalizeConfiguredMcpServer } from '../../../config/mcp-config-normalize.js';
import { CredentialResolver } from '../../../auth/credentials.js';
import { applyToolsWebPatch } from '../../config-tools-web.js';
import { mergeTunnelConfigPatch } from '../../../tunnel/tunnel-config.js';
import { mergeShareConfigPatch } from '../../../share/share-config.js';
import {
  mergeCronConfigPatch,
  mergeGatewaySkillsMarketplacePatch,
  mergeGoalsConfigPatch,
  mergeSessionConfigPatch,
  mergeUpdateConfigPatch,
} from '../../../config/web-patch.js';
import { buildSafeWebConfigPayload } from '../lib/config-payload.js';
import { mergeSttConfigPatch, mergeTtsConfigPatch } from '../lib/safe-voice-config.js';
import {
  normalizePatchAgentImageGenerationModel,
  normalizePatchAgentModel,
} from '../lib/agent-model.js';
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

export function registerConfigRoutes(authenticated: Hono, deps: AuthenticatedRouteDeps): void {
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

  authenticated.post('/api/config/reload', strictRateLimitMiddleware, async (c) => {
    const result = await service.reloadConfig();
    return c.json({ ok: true, payload: result });
  });

  authenticated.post('/api/heartbeat/trigger', strictRateLimitMiddleware, async (c) => {
    let reason = 'manual';
    try {
      const body = await c.req.json();
      if (body && typeof body === 'object' && typeof (body as { reason?: unknown }).reason === 'string') {
        const r = (body as { reason: string }).reason.trim();
        if (r) reason = r.slice(0, 120);
      }
    } catch {
      /* empty or invalid body */
    }
    service.requestHeartbeatNow({ reason });
    return c.json({ ok: true, payload: { scheduled: true } });
  });

  authenticated.get('/api/config', async (c) => {
    const safeConfig = await buildSafeWebConfigPayload(service);
    return c.json({ ok: true, payload: { config: safeConfig } });
  });

  authenticated.patch('/api/config', strictRateLimitMiddleware, async (c) => {
    const body = await c.req.json();
    
    // Merge updates into current config
    const config: Config = service.currentConfig as Config;
    
    // Update agent defaults
    if (body.agents?.defaults) {
      if (!config.agents) config.agents = { defaults: { workspace: '~/.xopc/workspace', model: 'anthropic/claude-sonnet-4-5', maxTokens: 8192, temperature: 0.7, maxToolIterations: 20, maxRequestsPerTurn: 50, maxToolFailuresPerTurn: 3, thinkingDefault: 'medium', reasoningDefault: 'stream', verboseDefault: 'full' } };
      if (!config.agents.defaults) config.agents.defaults = {} as any;
      
      if (body.agents.defaults.model !== undefined) {
        config.agents.defaults.model = normalizePatchAgentModel(body.agents.defaults.model) as Config['agents']['defaults']['model'];
      }
      if (body.agents.defaults.maxTokens !== undefined) {
        config.agents.defaults.maxTokens = body.agents.defaults.maxTokens;
      }
      if (body.agents.defaults.temperature !== undefined) {
        config.agents.defaults.temperature = body.agents.defaults.temperature;
      }
      if (body.agents.defaults.maxToolIterations !== undefined) {
        config.agents.defaults.maxToolIterations = body.agents.defaults.maxToolIterations;
      }
      if (body.agents.defaults.workspace !== undefined) {
        config.agents.defaults.workspace = body.agents.defaults.workspace;
      }
      if (body.agents.defaults.thinkingDefault !== undefined) {
        config.agents.defaults.thinkingDefault = body.agents.defaults.thinkingDefault;
      }
      if (body.agents.defaults.reasoningDefault !== undefined) {
        config.agents.defaults.reasoningDefault = body.agents.defaults.reasoningDefault;
      }
      if (body.agents.defaults.verboseDefault !== undefined) {
        config.agents.defaults.verboseDefault = body.agents.defaults.verboseDefault;
      }
      if (body.agents.defaults.imageModel !== undefined) {
        const v = body.agents.defaults.imageModel;
        if (v === '' || v === null) {
          delete (config.agents.defaults as Record<string, unknown>).imageModel;
        } else {
          config.agents.defaults.imageModel = normalizePatchAgentModel(v) as Config['agents']['defaults']['imageModel'];
        }
      }
      if (body.agents.defaults.imageGenerationModel !== undefined) {
        const v = body.agents.defaults.imageGenerationModel;
        if (v === '' || v === null) {
          delete (config.agents.defaults as Record<string, unknown>).imageGenerationModel;
        } else {
          const normalized = normalizePatchAgentImageGenerationModel(v);
          if (normalized === undefined) {
            delete (config.agents.defaults as Record<string, unknown>).imageGenerationModel;
          } else {
            config.agents.defaults.imageGenerationModel =
              normalized as Config['agents']['defaults']['imageGenerationModel'];
          }
        }
      }
      if (body.agents.defaults.mediaMaxMb !== undefined) {
        const v = body.agents.defaults.mediaMaxMb;
        if (v === null) {
          delete (config.agents.defaults as Record<string, unknown>).mediaMaxMb;
        } else {
          const n = typeof v === 'number' ? v : Number(v);
          if (!Number.isNaN(n) && n > 0) {
            config.agents.defaults.mediaMaxMb = n;
          }
        }
      }
      if (body.agents.defaults.browser !== undefined) {
        const b = body.agents.defaults.browser;
        if (b === null) {
          delete (config.agents.defaults as Record<string, unknown>).browser;
        } else if (typeof b === 'object' && !Array.isArray(b)) {
          const br = b as Record<string, unknown>;
          if (!config.agents.defaults.browser) {
            config.agents.defaults.browser = { enabled: false, headless: false };
          }
          const target = config.agents.defaults.browser as Record<string, unknown>;
          if (br.enabled !== undefined) {
            if (br.enabled === null) delete target.enabled;
            else target.enabled = Boolean(br.enabled);
          }
          if (br.headless !== undefined) {
            if (br.headless === null) delete target.headless;
            else target.headless = Boolean(br.headless);
          }
          if (br.allowPrivateUrls !== undefined) {
            if (br.allowPrivateUrls === null) delete target.allowPrivateUrls;
            else target.allowPrivateUrls = Boolean(br.allowPrivateUrls);
          }
          if (br.commandTimeout !== undefined) {
            if (br.commandTimeout === null) {
              delete target.commandTimeout;
            } else if (typeof br.commandTimeout === 'number' && Number.isFinite(br.commandTimeout)) {
              const n = Math.floor(br.commandTimeout);
              if (n >= 5 && n <= 900) {
                target.commandTimeout = n;
              }
            }
          }
          if (br.backend !== undefined) {
            if (br.backend === null || br.backend === '' || br.backend === 'extension') {
              delete target.backend;
            } else if (
              br.backend === 'local' ||
              br.backend === 'cdp' ||
              br.backend === 'cloud' ||
              br.backend === 'cloakbrowser'
            ) {
              target.backend = br.backend;
            }
          }
          if (br.cloudProvider !== undefined) {
            if (br.cloudProvider === null || br.cloudProvider === '') {
              delete target.cloudProvider;
            } else if (br.cloudProvider === 'browserbase' || br.cloudProvider === 'browser-use') {
              target.cloudProvider = br.cloudProvider;
            }
          }
          if (br.cloud !== undefined) {
            if (br.cloud === null) {
              delete target.cloud;
            } else if (typeof br.cloud === 'object' && !Array.isArray(br.cloud)) {
              const cloudPatch = br.cloud as Record<string, unknown>;
              const existingCloud =
                target.cloud && typeof target.cloud === 'object' && !Array.isArray(target.cloud)
                  ? (target.cloud as Record<string, unknown>)
                  : {};
              const cloudTarget: Record<string, unknown> = { ...existingCloud };
              if (cloudPatch.apiKey !== undefined) {
                if (cloudPatch.apiKey === null || cloudPatch.apiKey === '') {
                  delete cloudTarget.apiKey;
                } else if (cloudPatch.apiKey === '***') {
                  // Keep the existing stored key when the web UI sends the masked sentinel.
                } else if (typeof cloudPatch.apiKey === 'string') {
                  cloudTarget.apiKey = cloudPatch.apiKey.trim();
                }
              }
              for (const key of ['projectId', 'region']) {
                const value = cloudPatch[key];
                if (value === null || value === '') {
                  delete cloudTarget[key];
                } else if (typeof value === 'string' && value.trim()) {
                  cloudTarget[key] = value.trim();
                }
              }
              if (Object.keys(cloudTarget).length > 0) {
                target.cloud = cloudTarget;
              } else {
                delete target.cloud;
              }
            }
          }
          if (br.cdpUrl !== undefined) {
            if (br.cdpUrl === null || br.cdpUrl === '') {
              delete target.cdpUrl;
            } else if (typeof br.cdpUrl === 'string') {
              target.cdpUrl = br.cdpUrl.trim();
            }
          }
          if (br.extension !== undefined) {
            if (br.extension === null) {
              delete target.extension;
            } else if (typeof br.extension === 'object' && !Array.isArray(br.extension)) {
              const ext = br.extension as Record<string, unknown>;
              const extTarget: Record<string, unknown> = {};
              if (ext.port === null || ext.port === '') {
                // explicit clear: leave unset (consumers fall back to default)
              } else if (typeof ext.port === 'number' && ext.port >= 1024 && ext.port <= 65535) {
                extTarget.port = Math.floor(ext.port);
              }
              if (ext.host === null || ext.host === '') {
                // explicit clear
              } else if (typeof ext.host === 'string' && ext.host.trim()) {
                extTarget.host = ext.host.trim();
              }
              if (
                ext.connectionTimeout === null ||
                ext.connectionTimeout === ''
              ) {
                // explicit clear
              } else if (
                typeof ext.connectionTimeout === 'number' &&
                Number.isFinite(ext.connectionTimeout) &&
                ext.connectionTimeout >= 1000
              ) {
                extTarget.connectionTimeout = Math.floor(ext.connectionTimeout);
              }
              if (Object.keys(extTarget).length > 0) {
                target.extension = extTarget;
              } else {
                delete target.extension;
              }
            }
          }
          if (br.cloakbrowser !== undefined) {
            if (br.cloakbrowser === null) {
              delete target.cloakbrowser;
            } else if (typeof br.cloakbrowser === 'object' && !Array.isArray(br.cloakbrowser)) {
              const cloakbrowserPatch = br.cloakbrowser as Record<string, unknown>;
              const cloakbrowserTarget: Record<string, unknown> = {};
              if (typeof cloakbrowserPatch.keepOpen === 'boolean') {
                cloakbrowserTarget.keepOpen = cloakbrowserPatch.keepOpen;
              }
              if (typeof cloakbrowserPatch.temporaryProfile === 'boolean') {
                cloakbrowserTarget.temporaryProfile = cloakbrowserPatch.temporaryProfile;
              }
              for (const key of ['cacheDir', 'binaryPath', 'timezone', 'locale', 'webrtcIp', 'fingerprintPlatform']) {
                const value = cloakbrowserPatch[key];
                if (typeof value === 'string' && value.trim()) {
                  cloakbrowserTarget[key] = value.trim();
                }
              }
              if (
                Array.isArray(cloakbrowserPatch.extraArgs) &&
                cloakbrowserPatch.extraArgs.every((value) => typeof value === 'string')
              ) {
                cloakbrowserTarget.extraArgs = cloakbrowserPatch.extraArgs;
              }
              if (Object.keys(cloakbrowserTarget).length > 0) {
                target.cloakbrowser = cloakbrowserTarget;
              } else {
                delete target.cloakbrowser;
              }
            }
          }
          if (br.humanize !== undefined) {
            if (br.humanize === null) {
              delete target.humanize;
            } else {
              target.humanize = Boolean(br.humanize);
            }
          }
          if (br.humanPreset !== undefined) {
            if (br.humanPreset === null) {
              delete target.humanPreset;
            } else if (br.humanPreset === 'default' || br.humanPreset === 'careful') {
              target.humanPreset = br.humanPreset;
            }
          }
          if (br.dialogPolicy !== undefined) {
            if (br.dialogPolicy === null) {
              delete target.dialogPolicy;
            } else if (
              br.dialogPolicy === 'must_respond' ||
              br.dialogPolicy === 'auto_dismiss' ||
              br.dialogPolicy === 'auto_accept'
            ) {
              target.dialogPolicy = br.dialogPolicy;
            }
          }
          if (br.dialogTimeoutSeconds !== undefined) {
            if (br.dialogTimeoutSeconds === null) {
              delete target.dialogTimeoutSeconds;
            } else if (typeof br.dialogTimeoutSeconds === 'number' && Number.isFinite(br.dialogTimeoutSeconds)) {
              const n = Math.floor(br.dialogTimeoutSeconds);
              if (n >= 1 && n <= 86_400) {
                target.dialogTimeoutSeconds = n;
              }
            }
          }
        }
      }

      const dPatch = body.agents.defaults as Record<string, unknown>;
      const def = config.agents.defaults as Record<string, unknown>;

      if (dPatch.maxTaskDurationMs !== undefined) {
        const v = dPatch.maxTaskDurationMs;
        if (v === null) {
          delete def.maxTaskDurationMs;
        } else if (typeof v === 'number' && Number.isFinite(v)) {
          const ms = Math.floor(v);
          if (ms >= 60_000 && ms <= 14_400_000) {
            def.maxTaskDurationMs = ms;
          }
        }
      }
      if (dPatch.maxRequestsPerTurn !== undefined) {
        const v = dPatch.maxRequestsPerTurn;
        if (v === null) {
          delete def.maxRequestsPerTurn;
        } else if (typeof v === 'number' && Number.isFinite(v)) {
          const n = Math.floor(v);
          if (n >= 10 && n <= 200) {
            def.maxRequestsPerTurn = n;
          }
        }
      }
      if (dPatch.maxToolFailuresPerTurn !== undefined) {
        const v = dPatch.maxToolFailuresPerTurn;
        if (v === null) {
          delete def.maxToolFailuresPerTurn;
        } else if (typeof v === 'number' && Number.isFinite(v)) {
          const n = Math.floor(v);
          if (n >= 1 && n <= 20) {
            def.maxToolFailuresPerTurn = n;
          }
        }
      }

      if (dPatch.compaction !== undefined) {
        const c = dPatch.compaction;
        if (c === null) {
          delete def.compaction;
        } else if (typeof c === 'object' && !Array.isArray(c)) {
          const p = c as Record<string, unknown>;
          if (!def.compaction || typeof def.compaction !== 'object') {
            def.compaction = {};
          }
          const t = def.compaction as Record<string, unknown>;
          if (p.enabled !== undefined) t.enabled = Boolean(p.enabled);
          if (p.mode === 'default' || p.mode === 'safeguard') t.mode = p.mode;
          if (typeof p.reserveTokens === 'number' && Number.isFinite(p.reserveTokens)) {
            t.reserveTokens = Math.floor(p.reserveTokens);
          }
          if (typeof p.triggerThreshold === 'number' && Number.isFinite(p.triggerThreshold)) {
            const x = p.triggerThreshold;
            if (x >= 0.5 && x <= 0.95) t.triggerThreshold = x;
          }
          if (typeof p.minMessagesBeforeCompact === 'number' && Number.isFinite(p.minMessagesBeforeCompact)) {
            t.minMessagesBeforeCompact = Math.floor(p.minMessagesBeforeCompact);
          }
          if (typeof p.keepRecentMessages === 'number' && Number.isFinite(p.keepRecentMessages)) {
            t.keepRecentMessages = Math.floor(p.keepRecentMessages);
          }
          if (typeof p.evictionWindow === 'number' && Number.isFinite(p.evictionWindow)) {
            const x = p.evictionWindow;
            if (x >= 0.1 && x <= 0.5) t.evictionWindow = x;
          }
          if (typeof p.retentionWindow === 'number' && Number.isFinite(p.retentionWindow)) {
            const n = Math.floor(p.retentionWindow);
            if (n >= 3 && n <= 20) t.retentionWindow = n;
          }
        }
      }

      if (dPatch.pruning !== undefined) {
        const c = dPatch.pruning;
        if (c === null) {
          delete def.pruning;
        } else if (typeof c === 'object' && !Array.isArray(c)) {
          const p = c as Record<string, unknown>;
          if (!def.pruning || typeof def.pruning !== 'object') {
            def.pruning = {};
          }
          const t = def.pruning as Record<string, unknown>;
          if (p.enabled !== undefined) t.enabled = Boolean(p.enabled);
          if (typeof p.maxToolResultChars === 'number' && Number.isFinite(p.maxToolResultChars)) {
            t.maxToolResultChars = Math.floor(p.maxToolResultChars);
          }
          if (typeof p.headKeepRatio === 'number' && Number.isFinite(p.headKeepRatio)) {
            t.headKeepRatio = p.headKeepRatio;
          }
          if (typeof p.tailKeepRatio === 'number' && Number.isFinite(p.tailKeepRatio)) {
            t.tailKeepRatio = p.tailKeepRatio;
          }
        }
      }

      if (dPatch.memory !== undefined) {
        const c = dPatch.memory;
        if (c === null) {
          delete def.memory;
        } else if (typeof c === 'object' && !Array.isArray(c)) {
          const p = c as Record<string, unknown>;
          if (!def.memory || typeof def.memory !== 'object') {
            def.memory = {};
          }
          const t = def.memory as Record<string, unknown>;
          if (p.enabled !== undefined) {
            if (p.enabled === null) delete t.enabled;
            else t.enabled = Boolean(p.enabled);
          }
          if (p.useEnhancedSystem !== undefined) {
            if (p.useEnhancedSystem === null) delete t.useEnhancedSystem;
            else t.useEnhancedSystem = Boolean(p.useEnhancedSystem);
          }
          if (p.userProfileEnabled !== undefined) {
            if (p.userProfileEnabled === null) delete t.userProfileEnabled;
            else t.userProfileEnabled = Boolean(p.userProfileEnabled);
          }
          if (p.memoryCharLimit !== undefined) {
            if (p.memoryCharLimit === null) delete t.memoryCharLimit;
            else if (typeof p.memoryCharLimit === 'number' && p.memoryCharLimit > 0) {
              t.memoryCharLimit = Math.floor(p.memoryCharLimit);
            }
          }
          if (p.userCharLimit !== undefined) {
            if (p.userCharLimit === null) delete t.userCharLimit;
            else if (typeof p.userCharLimit === 'number' && p.userCharLimit > 0) {
              t.userCharLimit = Math.floor(p.userCharLimit);
            }
          }
          if (p.provider === 'none' || p.provider === 'stub') {
            t.provider = p.provider;
          } else if (p.provider === null) {
            delete t.provider;
          }
          if (p.injectionFrequency === 'every-turn' || p.injectionFrequency === 'first-turn') {
            t.injectionFrequency = p.injectionFrequency;
          } else if (p.injectionFrequency === null) {
            delete t.injectionFrequency;
          }
          if (p.contextCadence !== undefined) {
            if (p.contextCadence === null) delete t.contextCadence;
            else if (typeof p.contextCadence === 'number' && p.contextCadence >= 1) {
              t.contextCadence = Math.floor(p.contextCadence);
            }
          }
          if (p.dialecticCadence !== undefined) {
            if (p.dialecticCadence === null) delete t.dialecticCadence;
            else if (typeof p.dialecticCadence === 'number' && p.dialecticCadence >= 1) {
              t.dialecticCadence = Math.floor(p.dialecticCadence);
            }
          }

          // Dreaming (schemaless patch): agents.defaults.memory.dreaming
          if (p.dreaming !== undefined) {
            const d0 = p.dreaming;
            if (d0 === null) {
              delete (t as { dreaming?: unknown }).dreaming;
            } else if (typeof d0 === 'object' && d0 !== null && !Array.isArray(d0)) {
              if (!('dreaming' in t) || typeof (t as { dreaming?: unknown }).dreaming !== 'object') {
                (t as { dreaming?: Record<string, unknown> }).dreaming = {};
              }
              const dt = (t as { dreaming: Record<string, unknown> }).dreaming;
              const dp = d0 as Record<string, unknown>;

              if (dp.enabled !== undefined) {
                if (dp.enabled === null) delete dt.enabled;
                else dt.enabled = Boolean(dp.enabled);
              }
              if (dp.frequency !== undefined) {
                const v = dp.frequency;
                if (v === null || v === '') delete dt.frequency;
                else if (typeof v === 'string') dt.frequency = v;
              }
              if (dp.timezone !== undefined) {
                const v = dp.timezone;
                if (v === null || v === '') delete dt.timezone;
                else if (typeof v === 'string') dt.timezone = v;
              }

              // Accept either `phases.deep` or `deep`.
              if (dp.phases !== undefined || dp.deep !== undefined) {
                if (!('phases' in dt) || typeof (dt as { phases?: unknown }).phases !== 'object' || (dt as { phases?: unknown }).phases === null) {
                  dt.phases = {};
                }
                const phases = (dt as { phases: Record<string, unknown> }).phases;
                if (!('deep' in phases) || typeof phases.deep !== 'object' || phases.deep === null) {
                  phases.deep = {};
                }
                const deep = phases.deep as Record<string, unknown>;

                const deepPatchRaw =
                  typeof dp.phases === 'object' && dp.phases !== null && !Array.isArray(dp.phases)
                    ? (dp.phases as Record<string, unknown>).deep
                    : dp.deep;
                const deepPatch =
                  typeof deepPatchRaw === 'object' && deepPatchRaw !== null && !Array.isArray(deepPatchRaw)
                    ? (deepPatchRaw as Record<string, unknown>)
                    : null;

                if (deepPatch) {
                  if (deepPatch.enabled !== undefined) {
                    if (deepPatch.enabled === null) delete deep.enabled;
                    else deep.enabled = Boolean(deepPatch.enabled);
                  }
                  if (deepPatch.minScore !== undefined) {
                    const v = deepPatch.minScore;
                    if (v === null) delete deep.minScore;
                    else if (typeof v === 'number' && Number.isFinite(v)) deep.minScore = v;
                  }
                  if (deepPatch.minRecallCount !== undefined) {
                    const v = deepPatch.minRecallCount;
                    if (v === null) delete deep.minRecallCount;
                    else if (typeof v === 'number' && Number.isFinite(v)) deep.minRecallCount = Math.floor(v);
                  }
                  if (deepPatch.limit !== undefined) {
                    const v = deepPatch.limit;
                    if (v === null) delete deep.limit;
                    else if (typeof v === 'number' && Number.isFinite(v)) deep.limit = Math.floor(v);
                  }
                }
              }
            }
          }
        }
      }

      if (dPatch.sessionSearch !== undefined) {
        const c = dPatch.sessionSearch;
        if (c === null) {
          delete def.sessionSearch;
        } else if (typeof c === 'object' && !Array.isArray(c)) {
          const p = c as Record<string, unknown>;
          if (!def.sessionSearch || typeof def.sessionSearch !== 'object') {
            def.sessionSearch = {};
          }
          const t = def.sessionSearch as Record<string, unknown>;
          if (p.summaryModel !== undefined) {
            if (p.summaryModel === null || p.summaryModel === '') {
              delete t.summaryModel;
            } else if (typeof p.summaryModel === 'string') {
              t.summaryModel = p.summaryModel;
            }
          }
        }
      }

      if (dPatch.backgroundReview !== undefined) {
        const c = dPatch.backgroundReview;
        if (c === null) {
          delete def.backgroundReview;
        } else if (typeof c === 'object' && !Array.isArray(c)) {
          const p = c as Record<string, unknown>;
          if (!def.backgroundReview || typeof def.backgroundReview !== 'object') {
            def.backgroundReview = {};
          }
          const t = def.backgroundReview as Record<string, unknown>;
          if (p.enabled !== undefined) {
            if (p.enabled === null) delete t.enabled;
            else t.enabled = Boolean(p.enabled);
          }
          if (p.memoryNudgeInterval !== undefined) {
            if (p.memoryNudgeInterval === null) delete t.memoryNudgeInterval;
            else if (typeof p.memoryNudgeInterval === 'number' && p.memoryNudgeInterval >= 0) {
              t.memoryNudgeInterval = Math.floor(p.memoryNudgeInterval);
            }
          }
          if (p.skillNudgeInterval !== undefined) {
            if (p.skillNudgeInterval === null) delete t.skillNudgeInterval;
            else if (typeof p.skillNudgeInterval === 'number' && p.skillNudgeInterval >= 0) {
              t.skillNudgeInterval = Math.floor(p.skillNudgeInterval);
            }
          }
          if (p.maxToolRounds !== undefined) {
            if (p.maxToolRounds === null) delete t.maxToolRounds;
            else if (typeof p.maxToolRounds === 'number' && p.maxToolRounds >= 1 && p.maxToolRounds <= 32) {
              t.maxToolRounds = Math.floor(p.maxToolRounds);
            }
          }
          if (p.maxHistoryMessages !== undefined) {
            if (p.maxHistoryMessages === null) delete t.maxHistoryMessages;
            else if (typeof p.maxHistoryMessages === 'number' && p.maxHistoryMessages >= 10 && p.maxHistoryMessages <= 200) {
              t.maxHistoryMessages = Math.floor(p.maxHistoryMessages);
            }
          }
          if (p.maxDurationMs !== undefined) {
            if (p.maxDurationMs === null) delete t.maxDurationMs;
            else if (typeof p.maxDurationMs === 'number' && p.maxDurationMs >= 30_000 && p.maxDurationMs <= 600_000) {
              t.maxDurationMs = Math.floor(p.maxDurationMs);
            }
          }
        }
      }

      if (dPatch.webExtract !== undefined) {
        const c = dPatch.webExtract;
        if (c === null) {
          delete def.webExtract;
        } else if (typeof c === 'object' && !Array.isArray(c)) {
          const p = c as Record<string, unknown>;
          if (!def.webExtract || typeof def.webExtract !== 'object') {
            def.webExtract = {};
          }
          const t = def.webExtract as Record<string, unknown>;
          if (p.model !== undefined) {
            if (p.model === null || p.model === '') {
              delete t.model;
            } else if (typeof p.model === 'string') {
              t.model = p.model;
            }
          }
          if (p.maxLength !== undefined) {
            if (p.maxLength === null) delete t.maxLength;
            else if (typeof p.maxLength === 'number' && p.maxLength > 0) {
              t.maxLength = p.maxLength;
            }
          }
        }
      }

      if (dPatch.delegate !== undefined) {
        const c = dPatch.delegate;
        if (c === null) {
          delete def.delegate;
        } else if (typeof c === 'object' && !Array.isArray(c)) {
          const p = c as Record<string, unknown>;
          if (!def.delegate || typeof def.delegate !== 'object') {
            def.delegate = {};
          }
          const t = def.delegate as Record<string, unknown>;
          if (p.enabled !== undefined) {
            if (p.enabled === null) delete t.enabled;
            else t.enabled = Boolean(p.enabled);
          }
        }
      }

      if (dPatch.executeCode !== undefined) {
        const c = dPatch.executeCode;
        if (c === null) {
          delete def.executeCode;
        } else if (typeof c === 'object' && !Array.isArray(c)) {
          const p = c as Record<string, unknown>;
          if (!def.executeCode || typeof def.executeCode !== 'object') {
            def.executeCode = {};
          }
          const t = def.executeCode as Record<string, unknown>;
          if (p.enabled !== undefined) {
            if (p.enabled === null) delete t.enabled;
            else t.enabled = Boolean(p.enabled);
          }
        }
      }

      if (dPatch.systemPromptOverride !== undefined) {
        const v = dPatch.systemPromptOverride;
        if (v === null || v === '') {
          delete def.systemPromptOverride;
        } else if (typeof v === 'string') {
          def.systemPromptOverride = v;
        }
      }

      if (dPatch.skills !== undefined) {
        const v = dPatch.skills;
        if (v === null) {
          delete def.skills;
        } else if (Array.isArray(v) && v.every((x) => typeof x === 'string')) {
          def.skills = v;
        }
      }

      if (dPatch.tools !== undefined) {
        const t0 = dPatch.tools;
        if (t0 === null) {
          delete def.tools;
        } else if (typeof t0 === 'object' && !Array.isArray(t0)) {
          const p = t0 as { disable?: unknown };
          if (!def.tools || typeof def.tools !== 'object') {
            def.tools = {};
          }
          const t = def.tools as { disable?: string[] };
          if (p.disable !== undefined) {
            if (p.disable === null || (Array.isArray(p.disable) && p.disable.length === 0)) {
              delete t.disable;
            } else if (Array.isArray(p.disable) && p.disable.every((x) => typeof x === 'string')) {
              t.disable = p.disable;
            }
          }
        }
      }

      if (dPatch.params !== undefined) {
        const v = dPatch.params;
        if (v === null) {
          delete def.params;
        } else if (typeof v === 'object' && !Array.isArray(v) && v !== null) {
          def.params = v as Record<string, unknown>;
        }
      }
    }
    
    // Update channels — use `in` / null so `weixin: null` removes the block; avoid `if (ch.weixin)` missing null.
    const patchChannels = body.channels;
    if (patchChannels != null && typeof patchChannels === 'object' && !Array.isArray(patchChannels)) {
      if ('telegram' in patchChannels) {
        const tgRaw = patchChannels.telegram;
        if (tgRaw === null) {
          if (config.channels) delete config.channels.telegram;
        } else if (typeof tgRaw === 'object' && !Array.isArray(tgRaw)) {
          const bodyTg = tgRaw as Record<string, unknown>;
          if (!config.channels) {
            config.channels = {
              telegram: {
                enabled: false,
                allowFrom: [],
                groupAllowFrom: [],
                debug: false,
                accounts: {
                  default: {
                    accountId: 'default',
                    enabled: true,
                    botToken: '',
                    allowFrom: [],
                    dmPolicy: 'pairing' as const,
                    groupPolicy: 'open' as const,
                    replyToMode: 'off' as const,
                    historyLimit: 50,
                    textChunkLimit: 4000,
                    streamMode: 'partial' as const,
                  },
                },
                dmPolicy: 'pairing' as const,
                groupPolicy: 'open' as const,
                replyToMode: 'off' as const,
                historyLimit: 50,
                textChunkLimit: 4000,
              },
            };
          }
          if (!config.channels.telegram) config.channels.telegram = {} as any;
          const tg = config.channels.telegram as Record<string, unknown>;

          if (bodyTg.enabled !== undefined) {
            tg.enabled = bodyTg.enabled;
          }
          if (bodyTg.botToken !== undefined) {
            const accRaw = tg.accounts;
            const acc =
              accRaw && typeof accRaw === 'object' && !Array.isArray(accRaw)
                ? { ...(accRaw as Record<string, unknown>) }
                : {};
            const defRaw = acc.default;
            const def =
              defRaw && typeof defRaw === 'object' && !Array.isArray(defRaw)
                ? { ...(defRaw as Record<string, unknown>) }
                : {};
            acc.default = {
              ...def,
              accountId: 'default',
              botToken: bodyTg.botToken,
            };
            tg.accounts = acc;
          }
          if (bodyTg.allowFrom !== undefined) {
            tg.allowFrom = bodyTg.allowFrom;
          }
          if ('apiRoot' in bodyTg) {
            const ar = bodyTg.apiRoot;
            if (ar === null || ar === undefined || (typeof ar === 'string' && !ar.trim())) {
              delete tg.apiRoot;
            } else {
              tg.apiRoot = String(ar).trim();
            }
          }
          if (bodyTg.debug !== undefined) {
            tg.debug = bodyTg.debug;
          }
          if (bodyTg.streamMode !== undefined) {
            tg.streamMode = bodyTg.streamMode;
          }
          if ('groupAllowFrom' in bodyTg) {
            const ga = bodyTg.groupAllowFrom;
            if (ga === null || (Array.isArray(ga) && ga.length === 0)) {
              delete tg.groupAllowFrom;
            } else {
              tg.groupAllowFrom = ga;
            }
          }
          if (bodyTg.dmPolicy !== undefined) {
            tg.dmPolicy = bodyTg.dmPolicy;
          }
          if (bodyTg.groupPolicy !== undefined) {
            tg.groupPolicy = bodyTg.groupPolicy;
          }
          if (bodyTg.replyToMode !== undefined) {
            tg.replyToMode = bodyTg.replyToMode;
          }
          if (bodyTg.historyLimit !== undefined) {
            tg.historyLimit = bodyTg.historyLimit;
          }
          if (bodyTg.textChunkLimit !== undefined) {
            tg.textChunkLimit = bodyTg.textChunkLimit;
          }
          if ('proxy' in bodyTg) {
            const pr = bodyTg.proxy;
            if (pr === null || pr === undefined || (typeof pr === 'string' && !pr.trim())) {
              delete tg.proxy;
            } else {
              tg.proxy = String(pr).trim();
            }
          }
          if (bodyTg.accounts !== undefined) {
            tg.accounts = bodyTg.accounts;
          }
        }
      }

      if ('weixin' in patchChannels) {
        const wxRaw = patchChannels.weixin;
        if (wxRaw === null) {
          if (config.channels) delete config.channels.weixin;
        } else if (typeof wxRaw === 'object' && !Array.isArray(wxRaw)) {
          const wx = wxRaw as Record<string, unknown>;
          if (!config.channels) config.channels = {} as any;
          if (!config.channels.weixin) {
            config.channels.weixin = {
              enabled: false,
              dmPolicy: 'open',
              allowFrom: [],
              debug: false,
              historyLimit: 50,
              textChunkLimit: 4000,
            };
          }
          const wxTarget = config.channels.weixin as Record<string, unknown>;
          if (wx.enabled !== undefined) wxTarget.enabled = wx.enabled;
          if (wx.dmPolicy !== undefined) wxTarget.dmPolicy = wx.dmPolicy;
          if (wx.allowFrom !== undefined) wxTarget.allowFrom = wx.allowFrom;
          if (wx.debug !== undefined) wxTarget.debug = wx.debug;
          if (wx.streamMode !== undefined) wxTarget.streamMode = wx.streamMode;
          if (wx.historyLimit !== undefined) wxTarget.historyLimit = wx.historyLimit;
          if (wx.textChunkLimit !== undefined) wxTarget.textChunkLimit = wx.textChunkLimit;
          if ('routeTag' in wx) {
            const rt = wx.routeTag;
            if (rt === null || rt === undefined || rt === '') {
              delete wxTarget.routeTag;
            } else {
              wxTarget.routeTag = rt as string | number;
            }
          }
          if (wx.accounts !== undefined) wxTarget.accounts = wx.accounts;
        }
      }

      if ('feishu' in patchChannels) {
        const fsRaw = patchChannels.feishu;
        if (fsRaw === null) {
          if (config.channels) delete config.channels.feishu;
        } else if (typeof fsRaw === 'object' && !Array.isArray(fsRaw)) {
          const fs = fsRaw as Record<string, unknown>;
          if (!config.channels) config.channels = {} as any;
          if (!config.channels.feishu) {
            config.channels.feishu = {
              enabled: false,
              appId: '',
              appSecret: '',
              domain: 'feishu',
              connectionMode: 'websocket',
              dmPolicy: 'open',
              groupPolicy: 'allowlist',
              allowFrom: [],
              groupAllowFrom: [],
              requireMention: true,
              historyLimit: 50,
              textChunkLimit: 4000,
              accounts: {},
            };
          }
          const fsTarget = config.channels.feishu as Record<string, unknown>;

          if (fs.enabled !== undefined) fsTarget.enabled = fs.enabled;
          if (fs.defaultAccount !== undefined) {
            const da = fs.defaultAccount;
            if (da === null || da === '') delete fsTarget.defaultAccount;
            else fsTarget.defaultAccount = String(da);
          }
          if (fs.appId !== undefined) fsTarget.appId = fs.appId;
          if ('appSecret' in fs) {
            const v = fs.appSecret;
            if (v === null || (typeof v === 'string' && !String(v).trim())) {
              delete fsTarget.appSecret;
            } else {
              fsTarget.appSecret = v;
            }
          }
          if (fs.domain !== undefined) fsTarget.domain = fs.domain;
          if (fs.connectionMode !== undefined) fsTarget.connectionMode = fs.connectionMode;
          if (fs.verificationToken !== undefined) {
            const v = fs.verificationToken;
            if (v === null || (typeof v === 'string' && !String(v).trim())) delete fsTarget.verificationToken;
            else fsTarget.verificationToken = v;
          }
          if (fs.encryptKey !== undefined) {
            const v = fs.encryptKey;
            if (v === null || (typeof v === 'string' && !String(v).trim())) delete fsTarget.encryptKey;
            else fsTarget.encryptKey = v;
          }
          if (fs.webhookHost !== undefined) {
            const v = fs.webhookHost;
            if (v === null || (typeof v === 'string' && !String(v).trim())) delete fsTarget.webhookHost;
            else fsTarget.webhookHost = v;
          }
          if (fs.webhookPort !== undefined) fsTarget.webhookPort = fs.webhookPort;
          if (fs.webhookPath !== undefined) {
            const v = fs.webhookPath;
            if (v === null || (typeof v === 'string' && !String(v).trim())) delete fsTarget.webhookPath;
            else fsTarget.webhookPath = v;
          }
          if (fs.dmPolicy !== undefined) fsTarget.dmPolicy = fs.dmPolicy;
          if (fs.groupPolicy !== undefined) fsTarget.groupPolicy = fs.groupPolicy;
          if (fs.allowFrom !== undefined) fsTarget.allowFrom = fs.allowFrom;
          if (fs.groupAllowFrom !== undefined) {
            const ga = fs.groupAllowFrom;
            if (ga === null || (Array.isArray(ga) && ga.length === 0)) delete fsTarget.groupAllowFrom;
            else fsTarget.groupAllowFrom = ga;
          }
          if (fs.requireMention !== undefined) fsTarget.requireMention = fs.requireMention;
          if (fs.historyLimit !== undefined) fsTarget.historyLimit = fs.historyLimit;
          if (fs.textChunkLimit !== undefined) fsTarget.textChunkLimit = fs.textChunkLimit;
          if (fs.renderMode !== undefined) fsTarget.renderMode = fs.renderMode;
          if (fs.streaming !== undefined) fsTarget.streaming = fs.streaming;
          if (fs.reactionNotifications !== undefined) {
            fsTarget.reactionNotifications = fs.reactionNotifications;
          }
          if (fs.tools !== undefined) fsTarget.tools = fs.tools;
          if (fs.actions !== undefined) fsTarget.actions = fs.actions;
          if (fs.accounts !== undefined) fsTarget.accounts = fs.accounts;
        }
      }
    }
    
    // Update gateway heartbeat (partial merge)
    if (body.gateway?.heartbeat !== undefined && typeof body.gateway.heartbeat === 'object') {
      if (!config.gateway) {
        config.gateway = {
          bind: 'loopback',
          port: 18790,
          heartbeat: { enabled: true, intervalMs: 1_800_000, includeSystemPromptSection: false },
          maxSseConnections: 100,
          corsOrigins: ['*'],
        };
      }
      if (!config.gateway.heartbeat) {
        config.gateway.heartbeat = { enabled: true, intervalMs: 1_800_000, includeSystemPromptSection: false };
      }
      const h = config.gateway.heartbeat;
      const p = body.gateway.heartbeat as Record<string, unknown>;
      if (p.enabled !== undefined) h.enabled = Boolean(p.enabled);
      if (p.intervalMs !== undefined && typeof p.intervalMs === 'number' && Number.isFinite(p.intervalMs)) {
        h.intervalMs = p.intervalMs;
      }
      if (p.includeSystemPromptSection !== undefined) {
        h.includeSystemPromptSection = Boolean(p.includeSystemPromptSection);
      }
      if (p.target !== undefined) {
        if (p.target === null || p.target === '') delete (h as { target?: string }).target;
        else (h as { target?: string }).target = String(p.target);
      }
      if (p.targetChatId !== undefined) {
        if (p.targetChatId === null || p.targetChatId === '') delete (h as { targetChatId?: string }).targetChatId;
        else (h as { targetChatId?: string }).targetChatId = String(p.targetChatId);
      }
      if (p.prompt !== undefined) {
        if (p.prompt === null || p.prompt === '') delete (h as { prompt?: string }).prompt;
        else (h as { prompt?: string }).prompt = String(p.prompt);
      }
      if (p.ackMaxChars !== undefined) {
        if (p.ackMaxChars === null || p.ackMaxChars === '') delete (h as { ackMaxChars?: number }).ackMaxChars;
        else if (typeof p.ackMaxChars === 'number' && Number.isFinite(p.ackMaxChars)) {
          (h as { ackMaxChars?: number }).ackMaxChars = p.ackMaxChars;
        }
      }
      if (p.isolatedSession !== undefined) {
        if (p.isolatedSession === null || p.isolatedSession === false) {
          delete (h as { isolatedSession?: boolean }).isolatedSession;
        } else {
          (h as { isolatedSession?: boolean }).isolatedSession = Boolean(p.isolatedSession);
        }
      }
      if (p.activeHours !== undefined) {
        if (p.activeHours === null) {
          delete (h as { activeHours?: unknown }).activeHours;
        } else if (typeof p.activeHours === 'object' && p.activeHours !== null) {
          const ah = p.activeHours as Record<string, unknown>;
          const start = typeof ah.start === 'string' ? ah.start : '';
          const end = typeof ah.end === 'string' ? ah.end : '';
          if (start && end) {
            (h as { activeHours?: { start: string; end: string; timezone?: string } }).activeHours = {
              start,
              end,
              ...(typeof ah.timezone === 'string' && ah.timezone.trim() ? { timezone: ah.timezone } : {}),
            };
          } else {
            delete (h as { activeHours?: unknown }).activeHours;
          }
        }
      }
    }
    if (body.gateway?.bind !== undefined) {
      const bindModes = new Set(['auto', 'loopback', 'lan', 'tailnet', 'custom']);
      const bind = body.gateway.bind;
      if (typeof bind !== 'string' || !bindModes.has(bind)) {
        return c.json(
          { ok: false, error: { message: 'gateway.bind must be one of: auto, loopback, lan, tailnet, custom' } },
          400,
        );
      }
      if (!config.gateway) {
        config.gateway = {
          bind: bind as GatewayBindMode,
          port: 18790,
          heartbeat: { enabled: true, intervalMs: 1_800_000, includeSystemPromptSection: false },
          maxSseConnections: 100,
          corsOrigins: [],
        };
      } else {
        config.gateway.bind = bind as GatewayBindMode;
      }
      if (bind !== 'custom') {
        delete config.gateway.customBindHost;
      }
    }
    if (body.gateway?.customBindHost !== undefined) {
      if (body.gateway.customBindHost === null || body.gateway.customBindHost === '') {
        if (config.gateway) {
          delete config.gateway.customBindHost;
        }
      } else if (typeof body.gateway.customBindHost !== 'string' || !isValidIPv4(body.gateway.customBindHost.trim())) {
        return c.json(
          { ok: false, error: { message: 'gateway.customBindHost must be a valid IPv4 address' } },
          400,
        );
      } else if (config.gateway) {
        config.gateway.customBindHost = body.gateway.customBindHost.trim();
        config.gateway.bind = 'custom';
      }
    }
    if (body.gateway?.port !== undefined) {
      if (
        typeof body.gateway.port !== 'number' ||
        !Number.isFinite(body.gateway.port) ||
        body.gateway.port < 1 ||
        body.gateway.port > 65535
      ) {
        return c.json({ ok: false, error: { message: 'gateway.port must be an integer from 1 to 65535' } }, 400);
      }
      if (!config.gateway) {
        config.gateway = {
          bind: 'loopback',
          port: Math.floor(body.gateway.port),
          heartbeat: { enabled: true, intervalMs: 1_800_000, includeSystemPromptSection: false },
          maxSseConnections: 100,
          corsOrigins: [],
        };
      } else {
        config.gateway.port = Math.floor(body.gateway.port);
      }
    }
    if (body.gateway?.tailscale !== undefined && typeof body.gateway.tailscale === 'object') {
      const ts = body.gateway.tailscale as Record<string, unknown>;
      if (!config.gateway) {
        config.gateway = {
          bind: 'loopback',
          port: 18790,
          auth: { mode: 'token' },
          heartbeat: { enabled: true, intervalMs: 1_800_000, includeSystemPromptSection: false },
          maxSseConnections: 100,
          corsOrigins: [],
        };
      }
      config.gateway.tailscale = {
        ...(config.gateway.tailscale ?? { mode: 'off', resetOnExit: true }),
      };
      if (ts.mode !== undefined) {
        if (ts.mode !== 'off' && ts.mode !== 'serve' && ts.mode !== 'funnel') {
          return c.json(
            { ok: false, error: { message: 'gateway.tailscale.mode must be off, serve, or funnel' } },
            400,
          );
        }
        config.gateway.tailscale.mode = ts.mode as 'off' | 'serve' | 'funnel';
      }
      if (ts.resetOnExit !== undefined) {
        config.gateway.tailscale.resetOnExit = ts.resetOnExit === true;
      }
    }
    if (body.gateway?.auth !== undefined) {
      if (!config.gateway) {
        config.gateway = {
          bind: 'loopback',
          port: 18790,
          heartbeat: { enabled: true, intervalMs: 1_800_000, includeSystemPromptSection: false },
          maxSseConnections: 100,
          corsOrigins: [],
        };
      }
      if (!config.gateway.auth) config.gateway.auth = { mode: 'token' };
      const a = body.gateway.auth;
      if (a.mode !== undefined) {
        if (
          a.mode !== 'none' &&
          a.mode !== 'token' &&
          a.mode !== 'password' &&
          a.mode !== 'trusted-proxy'
        ) {
          return c.json(
            { ok: false, error: { message: 'gateway.auth.mode must be none, token, password, or trusted-proxy' } },
            400,
          );
        }
        config.gateway.auth.mode = a.mode;
      }
      if (a.token !== undefined) {
        if (a.token === null || (typeof a.token === 'string' && !a.token.trim())) {
          delete config.gateway.auth.token;
        } else if (typeof a.token === 'string') {
          config.gateway.auth.token = a.token;
        }
      }
      if (a.password !== undefined) {
        if (a.password === null || (typeof a.password === 'string' && !a.password.trim())) {
          delete config.gateway.auth.password;
        } else if (
          typeof a.password === 'string' &&
          a.password !== '***' &&
          a.password !== '••••••••••••'
        ) {
          config.gateway.auth.password = a.password;
        }
      }
      if (a.rateLimit !== undefined && typeof a.rateLimit === 'object' && a.rateLimit !== null) {
        const rlIn = a.rateLimit as Record<string, unknown>;
        if (!config.gateway.auth.rateLimit) {
          config.gateway.auth.rateLimit = {
            enabled: true,
            maxAttempts: 5,
            windowMs: 900_000,
            blockDurationMs: 300_000,
            exemptLoopback: true,
          };
        }
        const rl = config.gateway.auth.rateLimit!;
        if (rlIn.enabled !== undefined) rl.enabled = Boolean(rlIn.enabled);
        if (typeof rlIn.maxAttempts === 'number' && Number.isFinite(rlIn.maxAttempts)) {
          rl.maxAttempts = Math.max(1, Math.floor(rlIn.maxAttempts));
        }
        if (typeof rlIn.windowMs === 'number' && Number.isFinite(rlIn.windowMs) && rlIn.windowMs > 0) {
          rl.windowMs = Math.floor(rlIn.windowMs);
        }
        if (
          typeof rlIn.blockDurationMs === 'number' &&
          Number.isFinite(rlIn.blockDurationMs) &&
          rlIn.blockDurationMs > 0
        ) {
          rl.blockDurationMs = Math.floor(rlIn.blockDurationMs);
        }
        if (
          typeof rlIn.lockoutMs === 'number' &&
          Number.isFinite(rlIn.lockoutMs) &&
          rlIn.lockoutMs > 0
        ) {
          rl.blockDurationMs = Math.floor(rlIn.lockoutMs);
        }
        if (rlIn.exemptLoopback !== undefined) {
          rl.exemptLoopback = Boolean(rlIn.exemptLoopback);
        }
      }
      if (a.trustedProxy !== undefined) {
        if (a.trustedProxy === null) {
          delete config.gateway.auth.trustedProxy;
        } else if (typeof a.trustedProxy === 'object' && a.trustedProxy !== null) {
          const tpIn = a.trustedProxy as Record<string, unknown>;
          const userHeader =
            typeof tpIn.userHeader === 'string' ? tpIn.userHeader.trim() : '';
          if (!userHeader) {
            return c.json(
              { ok: false, error: { message: 'gateway.auth.trustedProxy.userHeader is required' } },
              400,
            );
          }
          const trustedProxy: NonNullable<(typeof config.gateway.auth)['trustedProxy']> = {
            userHeader,
          };
          if (tpIn.requiredHeaders !== undefined) {
            if (!Array.isArray(tpIn.requiredHeaders)) {
              return c.json(
                { ok: false, error: { message: 'gateway.auth.trustedProxy.requiredHeaders must be an array' } },
                400,
              );
            }
            trustedProxy.requiredHeaders = tpIn.requiredHeaders
              .filter((x): x is string => typeof x === 'string' && x.trim().length > 0)
              .map((x) => x.trim());
          }
          if (tpIn.allowUsers !== undefined) {
            if (!Array.isArray(tpIn.allowUsers)) {
              return c.json(
                { ok: false, error: { message: 'gateway.auth.trustedProxy.allowUsers must be an array' } },
                400,
              );
            }
            trustedProxy.allowUsers = tpIn.allowUsers
              .filter((x): x is string => typeof x === 'string' && x.trim().length > 0)
              .map((x) => x.trim());
          }
          if (tpIn.allowLoopback !== undefined) {
            trustedProxy.allowLoopback = Boolean(tpIn.allowLoopback);
          }
          config.gateway.auth.trustedProxy = trustedProxy;
        }
      }
    }
    if (body.gateway?.trustedProxies !== undefined) {
      if (!Array.isArray(body.gateway.trustedProxies)) {
        return c.json({ ok: false, error: { message: 'gateway.trustedProxies must be an array' } }, 400);
      }
      if (!config.gateway) {
        config.gateway = {
          bind: 'loopback',
          port: 18790,
          heartbeat: { enabled: true, intervalMs: 1_800_000, includeSystemPromptSection: false },
          maxSseConnections: 100,
          corsOrigins: [],
        };
      }
      config.gateway.trustedProxies = body.gateway.trustedProxies
        .filter((x): x is string => typeof x === 'string' && x.trim().length > 0)
        .map((x) => x.trim());
    }
    if (body.gateway?.allowRealIpFallback !== undefined) {
      if (!config.gateway) {
        config.gateway = {
          bind: 'loopback',
          port: 18790,
          heartbeat: { enabled: true, intervalMs: 1_800_000, includeSystemPromptSection: false },
          maxSseConnections: 100,
          corsOrigins: [],
        };
      }
      config.gateway.allowRealIpFallback = Boolean(body.gateway.allowRealIpFallback);
    }
    if (body.gateway?.dangerouslyAllowHostHeaderOriginFallback !== undefined) {
      if (!config.gateway) {
        config.gateway = {
          bind: 'loopback',
          port: 18790,
          heartbeat: { enabled: true, intervalMs: 1_800_000, includeSystemPromptSection: false },
          maxSseConnections: 100,
          corsOrigins: [],
        };
      }
      config.gateway.dangerouslyAllowHostHeaderOriginFallback = Boolean(
        body.gateway.dangerouslyAllowHostHeaderOriginFallback,
      );
    }
    if (body.gateway?.security !== undefined) {
      if (typeof body.gateway.security !== 'object' || body.gateway.security === null) {
        return c.json({ ok: false, error: { message: 'gateway.security must be an object' } }, 400);
      }
      if (!config.gateway) {
        config.gateway = {
          bind: 'loopback',
          port: 18790,
          heartbeat: { enabled: true, intervalMs: 1_800_000, includeSystemPromptSection: false },
          maxSseConnections: 100,
          corsOrigins: [],
        };
      }
      const secIn = body.gateway.security as Record<string, unknown>;
      if (!config.gateway.security) {
        config.gateway.security = {};
      }
      if (secIn.strict !== undefined) {
        config.gateway.security.strict = Boolean(secIn.strict);
      }
    }
    if (body.gateway?.share !== undefined) {
      if (typeof body.gateway.share !== 'object' || body.gateway.share === null || Array.isArray(body.gateway.share)) {
        return c.json({ ok: false, error: { message: 'gateway.share must be an object' } }, 400);
      }
      const shareResult = mergeShareConfigPatch(config, body.gateway.share as Record<string, unknown>);
      if (shareResult.ok === false) {
        return c.json({ ok: false, error: { message: shareResult.message } }, 400);
      }
    }
    if (body.gateway?.corsOrigins !== undefined) {
      if (!Array.isArray(body.gateway.corsOrigins)) {
        return c.json({ ok: false, error: { message: 'gateway.corsOrigins must be an array' } }, 400);
      }
      if (!config.gateway) {
        config.gateway = {
          bind: 'loopback',
          port: 18790,
          heartbeat: { enabled: true, intervalMs: 1_800_000, includeSystemPromptSection: false },
          maxSseConnections: 100,
          corsOrigins: [],
        };
      }
      config.gateway.corsOrigins = body.gateway.corsOrigins
        .filter((x): x is string => typeof x === 'string' && x.trim().length > 0)
        .map((x) => x.trim());
    }
    if (body.gateway?.maxSseConnections !== undefined) {
      if (
        typeof body.gateway.maxSseConnections !== 'number' ||
        !Number.isFinite(body.gateway.maxSseConnections) ||
        body.gateway.maxSseConnections < 1
      ) {
        return c.json(
          { ok: false, error: { message: 'gateway.maxSseConnections must be a positive integer' } },
          400,
        );
      }
      if (!config.gateway) {
        config.gateway = {
          bind: 'loopback',
          port: 18790,
          heartbeat: { enabled: true, intervalMs: 1_800_000, includeSystemPromptSection: false },
          maxSseConnections: Math.floor(body.gateway.maxSseConnections),
          corsOrigins: [],
        };
      } else {
        config.gateway.maxSseConnections = Math.floor(body.gateway.maxSseConnections);
      }
    }
    if (body.gateway?.channelConnectDeferMode !== undefined) {
      const mode = body.gateway.channelConnectDeferMode;
      if (mode !== 'auto' && mode !== 'off' && mode !== 'explicit') {
        return c.json(
          {
            ok: false,
            error: { message: 'gateway.channelConnectDeferMode must be auto, off, or explicit' },
          },
          400,
        );
      }
      if (!config.gateway) {
        config.gateway = {
          bind: 'loopback',
          port: 18790,
          heartbeat: { enabled: true, intervalMs: 1_800_000, includeSystemPromptSection: false },
          maxSseConnections: 100,
          corsOrigins: [],
        };
      }
      config.gateway.channelConnectDeferMode = mode;
    }
    const parseDeferIdList = (raw: unknown): string[] | null => {
      if (!Array.isArray(raw)) return null;
      const ids = raw
        .filter((x): x is string => typeof x === 'string' && x.trim().length > 0)
        .map((x) => x.trim());
      if (ids.length > 24) return null;
      return ids;
    };
    if (body.gateway?.channelConnectDeferIds !== undefined) {
      const ids = parseDeferIdList(body.gateway.channelConnectDeferIds);
      if (ids === null) {
        return c.json(
          { ok: false, error: { message: 'gateway.channelConnectDeferIds must be an array of up to 24 strings' } },
          400,
        );
      }
      if (!config.gateway) {
        config.gateway = {
          bind: 'loopback',
          port: 18790,
          heartbeat: { enabled: true, intervalMs: 1_800_000, includeSystemPromptSection: false },
          maxSseConnections: 100,
          corsOrigins: [],
        };
      }
      config.gateway.channelConnectDeferIds = ids;
    }
    if (body.gateway?.channelConnectDeferSkipIds !== undefined) {
      const ids = parseDeferIdList(body.gateway.channelConnectDeferSkipIds);
      if (ids === null) {
        return c.json(
          {
            ok: false,
            error: { message: 'gateway.channelConnectDeferSkipIds must be an array of up to 24 strings' },
          },
          400,
        );
      }
      if (!config.gateway) {
        config.gateway = {
          bind: 'loopback',
          port: 18790,
          heartbeat: { enabled: true, intervalMs: 1_800_000, includeSystemPromptSection: false },
          maxSseConnections: 100,
          corsOrigins: [],
        };
      }
      config.gateway.channelConnectDeferSkipIds = ids;
    }

    if (body.update !== undefined && typeof body.update === 'object' && body.update !== null) {
      const updateResult = mergeUpdateConfigPatch(config, body.update as Record<string, unknown>);
      if (updateResult.ok === false) {
        return c.json({ ok: false, error: { message: updateResult.message } }, 400);
      }
    }

    if (body.cron !== undefined) {
      if (typeof body.cron !== 'object' || body.cron === null || Array.isArray(body.cron)) {
        return c.json({ ok: false, error: { message: 'cron must be an object' } }, 400);
      }
      const cronResult = mergeCronConfigPatch(config, body.cron as Record<string, unknown>);
      if (cronResult.ok === false) {
        return c.json({ ok: false, error: { message: cronResult.message } }, 400);
      }
    }

    if (body.goals !== undefined) {
      if (typeof body.goals !== 'object' || body.goals === null || Array.isArray(body.goals)) {
        return c.json({ ok: false, error: { message: 'goals must be an object' } }, 400);
      }
      const goalsResult = mergeGoalsConfigPatch(config, body.goals as Record<string, unknown>);
      if (goalsResult.ok === false) {
        return c.json({ ok: false, error: { message: goalsResult.message } }, 400);
      }
    }

    if (body.session !== undefined) {
      if (typeof body.session !== 'object' || body.session === null || Array.isArray(body.session)) {
        return c.json({ ok: false, error: { message: 'session must be an object' } }, 400);
      }
      const sessionResult = mergeSessionConfigPatch(config, body.session as Record<string, unknown>);
      if (sessionResult.ok === false) {
        return c.json({ ok: false, error: { message: sessionResult.message } }, 400);
      }
    }

    if (
      body.gateway !== undefined &&
      typeof body.gateway === 'object' &&
      body.gateway !== null &&
      !Array.isArray(body.gateway)
    ) {
      const gwPatch = body.gateway as Record<string, unknown>;
      if (gwPatch.skillsMarketplaceProvider !== undefined || gwPatch.skillsStoreBaseUrl !== undefined) {
        const skillsResult = mergeGatewaySkillsMarketplacePatch(config, {
          ...(gwPatch.skillsMarketplaceProvider !== undefined
            ? { skillsMarketplaceProvider: gwPatch.skillsMarketplaceProvider }
            : {}),
          ...(gwPatch.skillsStoreBaseUrl !== undefined
            ? { skillsStoreBaseUrl: gwPatch.skillsStoreBaseUrl }
            : {}),
        });
        if (skillsResult.ok === false) {
          return c.json({ ok: false, error: { message: skillsResult.message } }, 400);
        }
      }
    }

    // Update providers config - save to credential system instead of config
    if (body.providers) {
      const resolver = new CredentialResolver();
      for (const [key, apiKey] of Object.entries(body.providers)) {
        if (
          apiKey !== undefined &&
          typeof apiKey === 'string' &&
          apiKey.trim() &&
          apiKey !== '***' &&
          apiKey !== '••••••••••••'
        ) {
          await resolver.saveApiKey(key, apiKey, { profileName: 'default' });
        }
      }
    }

    // Structured per-vendor provider config (cfg.providers.<id>) for capability
    // providers (image / audio / video). Distinct from `body.providers` above
    // which targets the LLM-side credential resolver.
    if (body.providersConfig && typeof body.providersConfig === 'object' && !Array.isArray(body.providersConfig)) {
      const cfgProviders = (config as { providers?: Record<string, Record<string, unknown>> }).providers ?? {};
      for (const [vendorId, raw] of Object.entries(body.providersConfig as Record<string, unknown>)) {
        if (!vendorId || typeof vendorId !== 'string') continue;
        if (raw === null) {
          delete cfgProviders[vendorId];
          continue;
        }
        if (!raw || typeof raw !== 'object' || Array.isArray(raw)) continue;
        const next = (cfgProviders[vendorId] ?? {}) as Record<string, unknown>;
        const patch = raw as Record<string, unknown>;
        for (const field of ['apiKey', 'baseUrl', 'region', 'imageBaseUrl'] as const) {
          if (patch[field] === null || patch[field] === '') {
            delete next[field];
          } else if (typeof patch[field] === 'string') {
            next[field] = (patch[field] as string).trim();
          }
        }
        if (patch.azure === null) {
          delete next.azure;
        } else if (patch.azure && typeof patch.azure === 'object' && !Array.isArray(patch.azure)) {
          next.azure = { ...(next.azure as Record<string, unknown> ?? {}), ...(patch.azure as Record<string, unknown>) };
        }
        if (patch.request === null) {
          delete next.request;
        } else if (patch.request && typeof patch.request === 'object' && !Array.isArray(patch.request)) {
          next.request = { ...(next.request as Record<string, unknown> ?? {}), ...(patch.request as Record<string, unknown>) };
        }
        cfgProviders[vendorId] = next;
      }
      (config as { providers?: Record<string, Record<string, unknown>> }).providers = cfgProviders;
    }

    // PATCH `stt` writes to tools.media.audio; PATCH `tts` writes to messages.tts.
    if (body.stt !== undefined) {
      config.tools = config.tools ?? {};
      config.tools.media = config.tools.media ?? {};
      (config.tools.media as Record<string, unknown>).audio = mergeSttConfigPatch(
        config.tools.media.audio,
        body.stt,
      );
    }
    if (body.tts !== undefined) {
      config.messages = config.messages ?? {};
      (config.messages as Record<string, unknown>).tts = mergeTtsConfigPatch(
        config.messages.tts,
        body.tts,
      );
    }

    const toolsPatchErr = applyToolsWebPatch(config, body as Record<string, unknown>);
    if (toolsPatchErr) {
      return c.json({ ok: false, error: { message: toolsPatchErr } }, 400);
    }

    if (body.tunnel !== undefined) {
      if (!body.tunnel || typeof body.tunnel !== 'object' || Array.isArray(body.tunnel)) {
        return c.json({ ok: false, error: { message: 'tunnel must be an object' } }, 400);
      }
      const tunnelResult = mergeTunnelConfigPatch(config, body.tunnel as Record<string, unknown>);
      if (tunnelResult.ok === false) {
        return c.json({ ok: false, error: { message: tunnelResult.message } }, 400);
      }
    }

    if (body.bindings !== undefined) {
      if (!Array.isArray(body.bindings)) {
        return c.json({ ok: false, error: { message: 'bindings must be an array' } }, 400);
      }
      const parsed = BindingsConfigSchema.safeParse(body.bindings);
      if (!parsed.success) {
        return c.json(
          { ok: false, error: { message: parsed.error.issues.map((i) => i.message).join('; ') } },
          400,
        );
      }
      config.bindings = parsed.data;
    }

    if (body.mcp !== undefined) {
      if (body.mcp === null) {
        delete config.mcp;
      } else if (typeof body.mcp !== 'object' || Array.isArray(body.mcp)) {
        return c.json({ ok: false, error: { message: 'mcp must be an object' } }, 400);
      } else {
        const parsed = McpConfigSchema.safeParse(body.mcp);
        if (!parsed.success) {
          return c.json(
            {
              ok: false,
              error: { message: parsed.error.issues.map((i) => i.message).join('; ') },
            },
            400,
          );
        }
        if (parsed.data === undefined) {
          delete config.mcp;
        } else {
          const next = { ...parsed.data };
          if (next.servers) {
            next.servers = Object.fromEntries(
              Object.entries(next.servers).map(([name, server]) => [
                name,
                canonicalizeConfiguredMcpServer(server as Record<string, unknown>),
              ]),
            );
          }
          config.mcp = next;
        }
      }
    }

    if (body.gateway !== undefined) {
      try {
        const auth = resolveGatewayAuth({ authConfig: config.gateway?.auth });
        assertGatewayAuthConfigured(auth);
        assertGatewayRuntimeConfig({
          cfg: config,
          auth,
          port: config.gateway?.port ?? 18790,
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return c.json({ ok: false, error: { message } }, 400);
      }
    }

    // Save config
    const result = await service.saveConfig(config);
    if (!result.saved) {
      return c.json({ ok: false, error: result.error }, 500);
    }

    if (body.gateway?.heartbeat !== undefined && typeof body.gateway.heartbeat === 'object') {
      service.reloadHeartbeatFromCurrentConfig();
    }

    const safeConfig = await buildSafeWebConfigPayload(service);
    return c.json({ ok: true, payload: { config: safeConfig } });
  });
}
