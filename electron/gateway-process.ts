import { type ChildProcess, spawn, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { createServer } from 'node:net';
import { dirname, join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';

import { app } from 'electron';

import { createProcessDiagnosticWriter } from '../src/infra/process-diagnostics.js';

import type { GatewayBindMode } from '../src/config/schema.js';
import { assertGatewayCompatibility, GATEWAY_PROTOCOL_INCOMPATIBLE } from './gateway-compatibility.js';
import { resolvePackagedAppPath } from './packaged-app-path.js';
import { LocalGatewayConnectionRegistry, localGatewayOrigin, type GatewayConnectionCredentials } from './gateway/local-connection.js';

import {
  GatewayStartupError,
  classifyGatewayStartupFailure,
  createGatewayTimeoutFailure,
  createPortInUseFailure,
} from './startup-failure.js';

let gatewayChild: ChildProcess | null = null;

type EmbeddedGatewayRuntime = GatewayProcessOptions & { authToken: string };
type GatewaySupervision = {
  runtime: EmbeddedGatewayRuntime;
  controller: AbortController;
  child: ChildProcess;
  timer?: ReturnType<typeof setTimeout>;
  attempts: number;
  readyAt: number;
  failedProbes: number;
};
let embeddedGatewayRuntime: EmbeddedGatewayRuntime | null = null;
let gatewaySupervision: GatewaySupervision | undefined;
let gatewayRestartInProgress = false;
let gatewayStopEpoch = 0;
let gatewayStopPromise: Promise<void> | undefined;
const gatewayConnections = new LocalGatewayConnectionRegistry();

export function registerGatewayConnection(connection: GatewayConnectionCredentials): void {
  gatewayConnections.register(connection);
  cancelGatewaySupervision();
  embeddedGatewayRuntime = null;
}

export function registerEmbeddedGatewayRuntime(runtime: EmbeddedGatewayRuntime, child = gatewayChild): void {
  if (child !== gatewayChild || child && (child.exitCode !== null || child.signalCode !== null)) {
    throw new Error('Gateway exited before registration completed');
  }
  gatewayConnections.register({ port: runtime.port, token: runtime.authToken }, 'embedded');
  cancelGatewaySupervision();
  embeddedGatewayRuntime = { ...runtime };
  if (gatewayChild) {
    gatewaySupervision = {
      runtime: embeddedGatewayRuntime,
      controller: new AbortController(),
      child: gatewayChild,
      attempts: 0,
      readyAt: performance.now(),
      failedProbes: 0,
    };
    scheduleGatewayHealthCheck(gatewaySupervision);
  }
}

const GATEWAY_HEALTH_INTERVAL_MS = 10_000;
const GATEWAY_HEALTH_FAILURE_LIMIT = 3;
const GATEWAY_RECOVERY_DELAYS_MS = [1_000, 3_000, 10_000];
const GATEWAY_STABLE_PERIOD_MS = 5 * 60_000;

function cancelGatewaySupervision(): void {
  if (!gatewaySupervision) return;
  clearTimeout(gatewaySupervision.timer);
  gatewaySupervision.controller.abort();
  gatewaySupervision = undefined;
}

function scheduleGatewayHealthCheck(supervision: GatewaySupervision): void {
  supervision.timer = setTimeout(() => { void checkGatewayHealth(supervision); }, GATEWAY_HEALTH_INTERVAL_MS);
}

async function checkGatewayHealth(supervision: GatewaySupervision): Promise<void> {
  const { child, controller, runtime } = supervision;
  if (controller.signal.aborted || gatewayChild !== child) return;
  const alive = await fetch(`${localGatewayOrigin(runtime)}/health`, {
    redirect: 'error',
    signal: AbortSignal.any([controller.signal, AbortSignal.timeout(2_000)]),
  }).then(async response => {
    const health = await response.json() as { status?: string };
    return response.ok && (health.status === 'ok' || health.status === 'starting');
  }).catch(() => false);
  if (controller.signal.aborted || gatewayChild !== child) return;
  supervision.failedProbes = alive ? 0 : supervision.failedProbes + 1;
  if (supervision.failedProbes < GATEWAY_HEALTH_FAILURE_LIMIT) {
    scheduleGatewayHealthCheck(supervision);
    return;
  }

  console.warn('[gateway] Local HTTP health check timed out repeatedly');
  try {
    await stopOwnedGatewayProcessAndWait();
  } catch (error) {
    console.error('[gateway] Could not stop the unresponsive process:', error);
    if (!controller.signal.aborted) runtime.onUnexpectedExit?.(null, null);
    return;
  }
  scheduleGatewayRecovery(supervision, null, null);
}

function scheduleGatewayRecovery(supervision: GatewaySupervision, code: number | null, signal: string | null): void {
  if (supervision.controller.signal.aborted) return;
  clearTimeout(supervision.timer);
  if (performance.now() - supervision.readyAt >= GATEWAY_STABLE_PERIOD_MS) supervision.attempts = 0;
  supervision.readyAt = Infinity;
  const retryDelay = GATEWAY_RECOVERY_DELAYS_MS[supervision.attempts];
  if (retryDelay === undefined) {
    supervision.runtime.onUnexpectedExit?.(code, signal);
    return;
  }
  supervision.attempts += 1;
  supervision.timer = setTimeout(() => {
    void recoverGateway(supervision, code, signal);
  }, retryDelay);
}

async function recoverGateway(supervision: GatewaySupervision, code: number | null, signal: string | null): Promise<void> {
  const { runtime, controller } = supervision;
  const recoverySignal = controller.signal;
  if (recoverySignal.aborted || gatewayChild) return;
  let child: ChildProcess | undefined;
  try {
    console.info(`[gateway] Recovering embedded process (attempt ${supervision.attempts})`);
    child = spawnGatewayProcess(runtime);
    await waitForGatewayReady(runtime.port, runtime.authToken, child, 120_000, recoverySignal);
    if (recoverySignal.aborted) return;
    if (gatewayChild !== child) throw new Error('Gateway exited during recovery');
    supervision.child = child;
    supervision.readyAt = performance.now();
    supervision.failedProbes = 0;
    console.info('[gateway] Embedded process recovered');
    scheduleGatewayHealthCheck(supervision);
  } catch (error) {
    if (recoverySignal.aborted) return;
    console.error('[gateway] Embedded recovery failed:', error instanceof Error ? error.message : String(error));
    try {
      if (child && gatewayChild === child) await stopOwnedGatewayProcessAndWait();
    } catch (stopError) {
      console.error('[gateway] Could not stop the failed recovery process:', stopError);
      if (!recoverySignal.aborted) runtime.onUnexpectedExit?.(code, signal);
      return;
    }
    if (error instanceof GatewayStartupError && error.failure.kind !== 'unknown' && error.failure.kind !== 'gateway_timeout') {
      if (!recoverySignal.aborted) runtime.onUnexpectedExit?.(code, signal);
      return;
    }
    scheduleGatewayRecovery(supervision, code, signal);
  }
}

export function getGatewayCredential(): string | undefined {
  return gatewayConnections.getCredentials()?.token;
}

export function getGatewayConnection(): GatewayConnectionCredentials | undefined {
  return gatewayConnections.getCredentials();
}

export function getGatewayConnectionDescriptor() {
  return gatewayConnections.describe();
}

export function isEmbeddedGatewayRegistered(): boolean {
  return embeddedGatewayRuntime !== null;
}

/** Recent stdout/stderr from the packaged gateway child (dev uses inherited stdio — usually empty). */
let gatewayLogBuffer = '';
const GATEWAY_LOG_BUFFER_MAX = 12_000;

function clearGatewayLogBuffer(): void {
  gatewayLogBuffer = '';
}

function appendGatewayLog(chunk: string): void {
  gatewayLogBuffer += chunk;
  if (gatewayLogBuffer.length > GATEWAY_LOG_BUFFER_MAX) {
    gatewayLogBuffer = gatewayLogBuffer.slice(-GATEWAY_LOG_BUFFER_MAX);
  }
}

function gatewayLogSnippetForError(): string {
  const s = gatewayLogBuffer.trim();
  if (!s) return '';
  const cap = 4000;
  return s.length > cap ? `…\n${s.slice(-cap)}` : s;
}

function tryListenOnce(hostname: string, port: number): Promise<boolean> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once('error', (err: NodeJS.ErrnoException) => {
      if (err.code === 'EADDRINUSE') {
        resolve(false);
      } else {
        reject(err);
      }
    });
    server.listen(port, hostname, () => {
      server.close((closeErr) => {
        if (closeErr) reject(closeErr);
        else resolve(true);
      });
    });
  });
}

async function acceptsConfiguredGatewayToken(port: number, token: string): Promise<boolean> {
  try {
    const res = await fetch(`${localGatewayOrigin({ port })}/api/config`, {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(1500),
    });
    return res.ok;
  } catch {
    return false;
  }
}

export async function resolveGatewayStartupMode(params: {
  port: number;
  token: string;
  bindHost: string;
}): Promise<'reuse' | 'spawn'> {
  if (await acceptsConfiguredGatewayToken(params.port, params.token)) {
    await checkGatewayCompatibility(params);
    return 'reuse';
  }

  const available = await tryListenOnce(params.bindHost, params.port);
  if (available) {
    return 'spawn';
  }

  throw new GatewayStartupError(
    createPortInUseFailure(
      params.port,
      `Gateway port ${params.port} is already in use, but the process on that port does not accept the configured xopc gateway token.`,
    ),
  );
}

async function checkGatewayCompatibility(connection: { port: number; token: string }, signal?: AbortSignal): Promise<void> {
  try {
    await assertGatewayCompatibility(connection, signal);
  } catch (error) {
    if (error instanceof Error && error.message === GATEWAY_PROTOCOL_INCOMPATIBLE) {
      throw new GatewayStartupError({ kind: 'gateway_protocol_incompatible', port: connection.port,
        message: 'Desktop and Gateway protocols differ. Update both to the same build and restart the Gateway.' });
    }
    throw error;
  }
}

/** Static UI root for the packaged gateway subprocess. Prefer a real unpacked path on Windows. */
function resolvePackagedStaticRoot(): string {
  return resolvePackagedAppPath('dist', 'gateway', 'static', 'root');
}

function resolvePackagedBundledExtensionsRoot(): string {
  return resolvePackagedAppPath('dist', 'electron', 'extensions');
}

function resolvePackagedBundledSkillsRoot(): string {
  return resolvePackagedAppPath('skills');
}

/**
 * CLI entry for the gateway subprocess.
 * Packaged: esbuild bundle at `out/server/index.js` (self-contained, asar-unpacked).
 * Dev: tsdown output at `dist/src/cli/bin.js` (resolves deps from node_modules).
 */
export function resolveCliEntry(): string {
  if (app.isPackaged) {
    return resolvePackagedAppPath('out', 'server', 'index.js');
  }
  const mainDir = dirname(fileURLToPath(import.meta.url));
  return join(mainDir, '../../dist/src/cli/bin.js');
}

export function isCliBundlePresent(): boolean {
  return existsSync(resolveCliEntry());
}

export interface GatewayProcessOptions {
  configPath: string;
  workspacePath: string;
  port: number;
  bind: GatewayBindMode;
  /** System proxy resolved by Electron for model downloads in the Node gateway subprocess. */
  proxyUrl?: string;
  /** Called when a running embedded Gateway cannot be recovered. */
  onUnexpectedExit?: (code: number | null, signal: string | null) => void;
}

export function spawnGatewayProcess(opts: GatewayProcessOptions): ChildProcess {
  const cli = resolveCliEntry();
  const isPackaged = app.isPackaged;
  clearGatewayLogBuffer();
  const logDir = process.env.XOPC_LOG_DIR || join(dirname(opts.configPath), 'logs');
  const writeDiagnostic = createProcessDiagnosticWriter(join(logDir, 'gateway-supervisor.log'));
  let stderrTail = '';
  let expectedExit = false;
  const child = spawn(
    process.execPath,
    [
      cli,
      '--config',
      opts.configPath,
      '--workspace',
      opts.workspacePath,
      'gateway',
      '--foreground',
      '--bind',
      opts.bind,
      '--port',
      String(opts.port),
      '--no-hot-reload',
    ],
    {
      env: {
        ...process.env,
        ...(!process.env.HTTPS_PROXY && !process.env.https_proxy && opts.proxyUrl
          ? { HTTPS_PROXY: opts.proxyUrl, HTTP_PROXY: opts.proxyUrl }
          : {}),
        ELECTRON_RUN_AS_NODE: '1',
        XOPC_SERVICE_MARKER: 'electron',
        XOPC_STATE_DIR: dirname(opts.configPath),
        XOPC_CONFIG_PATH: opts.configPath,
        XOPC_GATEWAY_DIAGNOSTIC_PATH: join(logDir, 'gateway-process.log'),
        XOPC_WORKSPACE: opts.workspacePath,
        ...(isPackaged
          ? {
              XOPC_UI_STATIC_ROOT: resolvePackagedStaticRoot(),
              XOPC_BUNDLED_EXTENSIONS_ROOT: resolvePackagedBundledExtensionsRoot(),
              XOPC_BUNDLED_SKILLS_ROOT: resolvePackagedBundledSkillsRoot(),
              XOPC_SQLITE_ASSET_ROOT: resolvePackagedAppPath('out', 'server'),
              XOPC_BROWSER_EXT_BUNDLED_ROOT: join(process.resourcesPath, 'browser-ext'),
              XOPC_TEMPLATE_PATH: resolvePackagedAppPath('out', 'server', 'workspace-templates'),
              XOPC_PLAYWRIGHT_CORE_ROOT: join(process.resourcesPath, 'playwright-core'),
              XOPC_RIPGREP_BIN: join(
                process.resourcesPath,
                'bin',
                process.platform === 'win32' ? 'rg.exe' : 'rg',
              ),
              NODE_PATH: process.resourcesPath,
            }
          : {}),
      },
      // app.getAppPath() is the app.asar archive — not a real directory; using it as cwd causes spawn ENOTDIR.
      cwd: isPackaged ? opts.workspacePath : dirname(dirname(dirname(cli))),
      // Use 'pipe' for packaged app to capture logs, but we must drain the pipes to prevent Windows deadlock.
      // Use 'inherit' in dev mode to see logs in terminal.
      stdio: isPackaged ? ['ignore', 'pipe', 'pipe'] : 'inherit',
      // Do not detach on Windows: detached children can outlive Electron when the main process
      // exits before async taskkill completes, leaving the gateway holding the port and causing
      // the next launch to exit(1) from "port in use" — surfaced as a false "unexpected exit" dialog.
      detached: false,
      // Hide the console window on Windows when packaged.
      windowsHide: isPackaged && process.platform === 'win32',
    },
  );

  writeDiagnostic('gateway_spawn', { childPid: child.pid, port: opts.port, packaged: isPackaged });
  gatewayChild = child;

  // Drain stdout/stderr pipes to prevent Windows deadlock when buffers fill up.
  // In packaged mode, we capture logs but don't want to block the process.
  if (isPackaged && child.stdout && child.stderr) {
    for (const [stream, name] of [[child.stdout, 'stdout'], [child.stderr, 'stderr']] as const) {
      stream.on('error', (err) => {
        writeDiagnostic('gateway_pipe_error', { childPid: child.pid, stream: name, err });
      });
    }
    child.stdout.on('data', (data: Buffer) => {
      const text = data.toString();
      appendGatewayLog(text);
      console.log(`[gateway:stdout] ${text.trimEnd()}`);
    });
    child.stderr.on('data', (data: Buffer) => {
      const text = data.toString();
      stderrTail = (stderrTail + text).slice(-64 * 1024);
      appendGatewayLog(text);
      console.error(`[gateway:stderr] ${text.trimEnd()}`);
    });
  }

  child.on('exit', (code, signal) => {
    const wasCurrentChild = gatewayChild === child;
    expectedExit = !wasCurrentChild;
    writeDiagnostic('gateway_exit', { childPid: child.pid, code, signal, expectedExit });
    if (wasCurrentChild) {
      gatewayChild = null;
    }

    if (code === 0) {
      console.log(`[gateway] process exited normally (code=0)`);
    } else if (code !== null) {
      console.error(`[gateway] process exited with error code=${code}`);
    } else if (signal) {
      console.error(`[gateway] process killed by signal=${signal}`);
    }

    if (wasCurrentChild && gatewaySupervision?.child === child) {
      scheduleGatewayRecovery(gatewaySupervision, code, signal);
    }
  });

  // 'close' follows stdio drain; 'exit' can arrive before the fatal stderr stack.
  child.on('close', (code, signal) => {
    if (stderrTail) writeDiagnostic('gateway_stderr', { childPid: child.pid, stderrTail });
    writeDiagnostic('gateway_closed', { childPid: child.pid, code, signal, expectedExit });
  });

  child.on('error', (err) => {
    writeDiagnostic('gateway_process_error', { childPid: child.pid, err });
    console.error('[gateway] process error:', err);
    if (gatewayChild === child) {
      gatewayChild = null;
      if (gatewaySupervision?.child === child) scheduleGatewayRecovery(gatewaySupervision, null, null);
    }
  });

  return child;
}

/**
 * Wait for startup readiness, then confirm the configured credential and protocol.
 */
export async function waitForGatewayReady(
  port: number,
  token: string,
  child: Pick<ChildProcess, 'pid' | 'exitCode' | 'signalCode'>,
  timeoutMs = 120_000,
  signal?: AbortSignal,
): Promise<number> {
  const startedAt = performance.now();
  const deadline = startedAt + timeoutMs;
  const origin = localGatewayOrigin({ port });
  const headers = { Authorization: `Bearer ${token}` };
  const requestSignal = () => signal
    ? AbortSignal.any([signal, AbortSignal.timeout(2000)])
    : AbortSignal.timeout(2000);
  while (performance.now() < deadline) {
    signal?.throwIfAborted();
    if (child.pid === undefined || child.exitCode !== null || child.signalCode !== null) {
      const logHint = gatewayLogSnippetForError();
      throw new GatewayStartupError(
        classifyGatewayStartupFailure({
          rawOutput: logHint,
          port,
          exitCode: child.exitCode,
          signal: child.signalCode,
          message: `Gateway process exited before becoming ready (code=${child.exitCode}, signal=${child.signalCode}).`,
        }),
      );
    }
    try {
      const health = await fetch(`${origin}/api/health`, { headers, redirect: 'error', signal: requestSignal() });
      if (health.ok && (await health.json() as { ready?: boolean }).ready === true) {
        const res = await fetch(`${origin}/api/config`, { headers, redirect: 'error', signal: requestSignal() });
        if (res.ok) {
          await checkGatewayCompatibility({ port, token }, signal);
          return port;
        }
      }
    } catch (error) {
      if (error instanceof GatewayStartupError) throw error;
      /* retry */
    }
    // Probe frequently during normal local startup, then back off for slow boots.
    await delay(performance.now() - startedAt < 1_000 ? 25 : 100, undefined, { signal });
  }
  const logHint = gatewayLogSnippetForError();
  throw new GatewayStartupError(
    createGatewayTimeoutFailure({
      port,
      timeoutMs,
      rawOutput: logHint,
    }),
  );
}

export async function restartEmbeddedGatewayFromSavedConfig(params: {
  configPath: string;
  workspacePath: string;
  resolveCredentials: () => Promise<{
    port: number;
    token: string;
    bind: GatewayBindMode;
    bindHost: string;
  }>;
}): Promise<{ port: number; token: string }> {
  const runtime = embeddedGatewayRuntime;
  if (!runtime) {
    throw new Error('Embedded gateway is not registered');
  }
  if (gatewayRestartInProgress) throw new Error('Gateway restart is already in progress');
  const epoch = gatewayConnections.describe()?.epoch;
  const stopEpoch = gatewayStopEpoch;
  const assertRestartAuthority = () => {
    if (gatewayStopEpoch !== stopEpoch || embeddedGatewayRuntime !== runtime || gatewayConnections.describe()?.epoch !== epoch) {
      throw new Error('Gateway connection changed during restart');
    }
  };
  gatewayRestartInProgress = true;
  try {
    cancelGatewaySupervision();
    await stopOwnedGatewayProcessAndWait();
    assertRestartAuthority();
    const { port, token, bind, bindHost } = await params.resolveCredentials();
    assertRestartAuthority();
    const mode = await resolveGatewayStartupMode({ port, token, bindHost });
    assertRestartAuthority();
    if (mode === 'reuse') {
      registerGatewayConnection({ port, token });
      return { port, token };
    }

    const opts: GatewayProcessOptions = {
      configPath: params.configPath,
      workspacePath: params.workspacePath,
      port,
      bind,
      proxyUrl: runtime.proxyUrl,
      onUnexpectedExit: runtime.onUnexpectedExit,
    };
    const child = spawnGatewayProcess(opts);
    try {
      const readyPort = await waitForGatewayReady(port, token, child);
      assertRestartAuthority();
      registerEmbeddedGatewayRuntime({ ...opts, port: readyPort, authToken: token }, child);
      return { port: readyPort, token };
    } catch (error) {
      if (gatewayChild === child) await stopOwnedGatewayProcessAndWait();
      throw error;
    }
  } finally {
    gatewayRestartInProgress = false;
  }
}

function waitForChildExit(child: ChildProcess, timeoutMs: number): Promise<boolean> {
  if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve(true);

  return new Promise<boolean>((resolve) => {
    const finish = (exited: boolean) => {
      clearTimeout(timeout);
      child.removeListener('exit', onExit);
      resolve(exited);
    };
    const onExit = () => finish(true);
    const timeout = setTimeout(() => finish(false), timeoutMs);
    child.once('exit', onExit);
  });
}

export async function stopGatewayProcessAndWait(timeoutMs = 7000): Promise<void> {
  gatewayStopEpoch += 1;
  cancelGatewaySupervision();
  await stopOwnedGatewayProcessAndWait(timeoutMs);
}

async function stopOwnedGatewayProcessAndWait(timeoutMs = 7000): Promise<void> {
  if (gatewayStopPromise) return gatewayStopPromise;
  const child = gatewayChild;
  if (!child) return;
  signalOwnedGatewayProcess();
  gatewayStopPromise = confirmGatewayStopped(child, timeoutMs);
  try {
    await gatewayStopPromise;
  } finally {
    gatewayStopPromise = undefined;
  }
}

async function confirmGatewayStopped(child: ChildProcess, timeoutMs: number): Promise<void> {
  if (await waitForChildExit(child, timeoutMs)) return;

  try {
    child.kill('SIGKILL');
  } catch {
    /* ignore */
  }
  if (!await waitForChildExit(child, 2000)) {
    // Retain the owned handle so shutdown can be retried instead of adopting it as external.
    if (!gatewayChild) gatewayChild = child;
    throw new Error('Gateway process did not exit after forced shutdown');
  }
}

export function stopGatewayProcess(): void {
  gatewayStopEpoch += 1;
  cancelGatewaySupervision();
  signalOwnedGatewayProcess();
}

function signalOwnedGatewayProcess(): void {
  if (!gatewayChild?.pid) return;

  const child = gatewayChild;
  gatewayChild = null;

  try {
    if (process.platform === 'win32') {
      // Synchronous tree kill so before-quit can finish before Electron exits; avoids orphaned
      // gateway processes that keep the HTTP port and make the next session exit with code 1.
      try {
        const killed = spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], {
          windowsHide: true,
          timeout: 5000,
          encoding: 'utf8',
          stdio: 'ignore',
        });
        if (killed.error || killed.status !== 0) throw killed.error ?? new Error(`taskkill exited ${killed.status}`);
      } catch {
        try {
          child.kill();
        } catch {
          /* ignore */
        }
      }
    } else {
      // Unix/Mac: SIGTERM for graceful shutdown.
      child.kill('SIGTERM');

      // Force kill after 5 seconds if still running.
      const forceKillTimer = setTimeout(() => {
        try {
          if (child.exitCode === null && child.signalCode === null) {
            child.kill('SIGKILL');
          }
        } catch {
          /* ignore */
        }
      }, 5000);
      forceKillTimer.unref?.();
    }
  } catch {
    /* ignore */
  }
}
