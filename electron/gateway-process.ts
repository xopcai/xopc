import { type ChildProcess, spawn, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { createServer } from 'node:net';
import { dirname, join } from 'node:path';
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
let gatewayExitHandler: ((code: number | null, signal: string | null) => void) | null = null;

type EmbeddedGatewayRuntime = GatewayProcessOptions & { authToken: string };
let embeddedGatewayRuntime: EmbeddedGatewayRuntime | null = null;
let gatewayRestartInProgress = false;
const gatewayConnections = new LocalGatewayConnectionRegistry();

export function registerGatewayConnection(connection: GatewayConnectionCredentials): void {
  gatewayConnections.register(connection);
  embeddedGatewayRuntime = null;
}

export function registerEmbeddedGatewayRuntime(runtime: EmbeddedGatewayRuntime): void {
  gatewayConnections.register({ port: runtime.port, token: runtime.authToken }, 'embedded');
  embeddedGatewayRuntime = { ...runtime };
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

async function checkGatewayCompatibility(connection: { port: number; token: string }): Promise<void> {
  try {
    await assertGatewayCompatibility(connection);
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
  /** Called when gateway process exits unexpectedly (non-zero or by signal). */
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
  gatewayExitHandler = opts.onUnexpectedExit ?? null;

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

    // Notify on abnormal exit (not clean code 0). Avoid `code !== 0` alone: `null !== 0` is true in JS.
    const isCleanExit = code === 0 && signal == null;
    if (wasCurrentChild && gatewayExitHandler && !isCleanExit) {
      gatewayExitHandler(code, signal);
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
    }
  });

  return child;
}

/**
 * Wait until our gateway accepts the configured token. `/health` is unauthenticated, so a stale
 * process on the same port would falsely pass a health-only check; `/api/config` validates auth.
 */
export async function waitForGatewayReady(
  port: number,
  token: string,
  child: ChildProcess,
  timeoutMs = 120_000,
): Promise<number> {
  const deadline = Date.now() + timeoutMs;
  const url = `${localGatewayOrigin({ port })}/api/config`;
  while (Date.now() < deadline) {
    if (child.exitCode !== null || child.signalCode !== null) {
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
      const res = await fetch(url, {
        headers: { Authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(2000),
      });
      if (res.ok) {
        await checkGatewayCompatibility({ port, token });
        return port;
      }
    } catch (error) {
      if (error instanceof GatewayStartupError) throw error;
      /* retry */
    }
    // Avoid adding a full 250ms startup quantum after the authenticated API becomes available.
    await new Promise((r) => setTimeout(r, 100));
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
  const assertRestartAuthority = () => {
    if (embeddedGatewayRuntime !== runtime || gatewayConnections.describe()?.epoch !== epoch) {
      throw new Error('Gateway connection changed during restart');
    }
  };
  gatewayRestartInProgress = true;
  try {
    await stopGatewayProcessAndWait();
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
      registerEmbeddedGatewayRuntime({ ...opts, port: readyPort, authToken: token });
      return { port: readyPort, token };
    } catch (error) {
      if (gatewayChild === child) await stopGatewayProcessAndWait();
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
  const child = gatewayChild;
  if (!child) return;
  stopGatewayProcess();
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
  if (!gatewayChild?.pid) return;

  const child = gatewayChild;
  gatewayChild = null;
  gatewayExitHandler = null;

  try {
    if (process.platform === 'win32') {
      // Synchronous tree kill so before-quit can finish before Electron exits; avoids orphaned
      // gateway processes that keep the HTTP port and make the next session exit with code 1.
      try {
        const killed = spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], {
          windowsHide: true,
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
