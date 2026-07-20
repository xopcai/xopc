import { type ChildProcess, spawn, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { createServer } from 'node:net';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { app } from 'electron';

import type { GatewayBindMode } from '../src/config/schema.js';

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

export function registerEmbeddedGatewayRuntime(runtime: EmbeddedGatewayRuntime): void {
  embeddedGatewayRuntime = runtime;
}

export function getEmbeddedGatewayCredential(): string | undefined {
  return embeddedGatewayRuntime?.authToken;
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
    const res = await fetch(`http://127.0.0.1:${port}/api/config`, {
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

function resolvePackagedAppPath(...segments: string[]): string {
  const appPath = app.getAppPath();
  const unpacked = join(dirname(appPath), 'app.asar.unpacked', ...segments);
  if (existsSync(unpacked)) return unpacked;
  return join(appPath, ...segments);
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
        XOPC_WORKSPACE: opts.workspacePath,
        ...(isPackaged
          ? {
              XOPC_UI_STATIC_ROOT: resolvePackagedStaticRoot(),
              XOPC_BUNDLED_EXTENSIONS_ROOT: resolvePackagedBundledExtensionsRoot(),
              XOPC_BUNDLED_SKILLS_ROOT: resolvePackagedBundledSkillsRoot(),
              XOPC_BROWSER_EXT_BUNDLED_ROOT: join(process.resourcesPath, 'browser-ext'),
              XOPC_TEMPLATE_PATH: resolvePackagedAppPath('out', 'server', 'workspace-templates'),
              XOPC_PLAYWRIGHT_CORE_ROOT: join(process.resourcesPath, 'playwright-core'),
              XOPC_RIPGREP_BIN: join(
                process.resourcesPath,
                'bin',
                process.platform === 'win32' ? 'rg.exe' : 'rg',
              ),
              XOPC_CBM_BUNDLED_PATH: join(
                process.resourcesPath,
                'bin',
                process.platform === 'win32' ? 'codebase-memory-mcp.exe' : 'codebase-memory-mcp',
              ),
              XOPC_CBM_BUNDLED_MANIFEST_PATH: join(
                process.resourcesPath,
                'bin',
                'codebase-memory-mcp.manifest.json',
              ),
              XOPC_VOICE_RUNTIME_ENTRY: resolvePackagedAppPath(
                'out',
                'server',
                'voice-runtime.js',
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

  gatewayChild = child;
  gatewayExitHandler = opts.onUnexpectedExit ?? null;

  // Drain stdout/stderr pipes to prevent Windows deadlock when buffers fill up.
  // In packaged mode, we capture logs but don't want to block the process.
  if (isPackaged && child.stdout && child.stderr) {
    child.stdout.on('data', (data: Buffer) => {
      const text = data.toString();
      appendGatewayLog(text);
      console.log(`[gateway:stdout] ${text.trimEnd()}`);
    });
    child.stderr.on('data', (data: Buffer) => {
      const text = data.toString();
      appendGatewayLog(text);
      console.error(`[gateway:stderr] ${text.trimEnd()}`);
    });
  }

  child.on('exit', (code, signal) => {
    const wasCurrentChild = gatewayChild === child;
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

  child.on('error', (err) => {
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
  const url = `http://127.0.0.1:${port}/api/config`;
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
      if (res.ok) return port;
    } catch {
      /* retry */
    }
    await new Promise((r) => setTimeout(r, 250));
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
  if (!embeddedGatewayRuntime) {
    throw new Error('Embedded gateway is not registered');
  }
  await stopGatewayProcessAndWait();
  const { port, token, bind } = await params.resolveCredentials();

  const opts: GatewayProcessOptions = {
    configPath: params.configPath,
    workspacePath: params.workspacePath,
    port,
    bind,
    proxyUrl: embeddedGatewayRuntime.proxyUrl,
    onUnexpectedExit: embeddedGatewayRuntime.onUnexpectedExit,
  };
  const child = spawnGatewayProcess(opts);
  const readyPort = await waitForGatewayReady(port, token, child);
  embeddedGatewayRuntime = { ...opts, port: readyPort, authToken: token };
  return { port: readyPort, token };
}

async function stopGatewayProcessAndWait(timeoutMs = 7000): Promise<void> {
  const child = gatewayChild;
  if (!child) return;
  stopGatewayProcess();
  if (child.exitCode !== null || child.signalCode !== null) return;

  await new Promise<void>((resolve) => {
    const timeout = setTimeout(resolve, timeoutMs);
    child.once('exit', () => {
      clearTimeout(timeout);
      resolve();
    });
  });
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
        spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], {
          windowsHide: true,
          encoding: 'utf8',
          stdio: 'ignore',
        });
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
      setTimeout(() => {
        try {
          if (child.exitCode === null && child.signalCode === null) {
            child.kill('SIGKILL');
          }
        } catch {
          /* ignore */
        }
      }, 5000);
    }
  } catch {
    /* ignore */
  }
}
