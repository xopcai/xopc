import { type ChildProcess, spawn, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { createServer } from 'node:net';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { app } from 'electron';

import type { GatewayBindMode } from '../src/config/schema.js';

/** Default listen port for the gateway subprocess when started by Electron (not CLI). Kept separate from CLI default (18790) so desktop + `xopc gateway` can run side by side. */
const DEFAULT_PORT = 28790;

let gatewayChild: ChildProcess | null = null;
let gatewayExitHandler: ((code: number | null, signal: string | null) => void) | null = null;

type EmbeddedGatewayRuntime = GatewayProcessOptions & { authToken: string };
let embeddedGatewayRuntime: EmbeddedGatewayRuntime | null = null;

export function registerEmbeddedGatewayRuntime(runtime: EmbeddedGatewayRuntime): void {
  embeddedGatewayRuntime = runtime;
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

export function getDefaultGatewayPort(): number {
  return DEFAULT_PORT;
}

/**
 * Find the first TCP port on `hostname` starting at `startPort` that can be bound.
 * Used before spawning the gateway so we do not collide with another process on the default port.
 */
export async function pickAvailablePort(
  hostname: string,
  startPort: number,
  maxAttempts: number,
): Promise<number> {
  for (let offset = 0; offset < maxAttempts; offset++) {
    const port = startPort + offset;
    const free = await tryListenOnce(hostname, port);
    if (free) return port;
  }
  throw new Error(
    `No free TCP port on ${hostname} in range ${startPort}–${startPort + maxAttempts - 1} (try closing other xopc gateway instances)`,
  );
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

/**
 * CLI entry for the gateway subprocess.
 * Packaged: esbuild bundle at `out/server/index.js` (self-contained).
 * Dev: tsdown output at `dist/src/cli/bin.js` (resolves deps from node_modules).
 */
export function resolveCliEntry(): string {
  if (app.isPackaged) {
    return join(app.getAppPath(), 'out/server/index.js');
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
        ELECTRON_RUN_AS_NODE: '1',
        XOPC_STATE_DIR: dirname(opts.configPath),
        XOPC_CONFIG_PATH: opts.configPath,
        XOPC_WORKSPACE: opts.workspacePath,
        ...(isPackaged
          ? {
              XOPC_UI_STATIC_ROOT: join(app.getAppPath(), 'dist/gateway/static/root'),
              XOPC_BROWSER_EXT_BUNDLED_ROOT: join(process.resourcesPath, 'browser-ext'),
              XOPC_TEMPLATE_PATH: join(app.getAppPath(), 'out/server/workspace-templates'),
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
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  const url = `http://127.0.0.1:${port}/api/config`;
  while (Date.now() < deadline) {
    if (child.exitCode !== null || child.signalCode !== null) {
      const logHint = gatewayLogSnippetForError();
      throw new Error(
        `Gateway process exited before becoming ready (code=${child.exitCode}, signal=${child.signalCode}). ` +
          (logHint ? `Output:\n${logHint}\n\n` : '') +
          `Port ${port} may be in use by another program, or the gateway failed to start.`,
      );
    }
    try {
      const res = await fetch(url, {
        headers: { Authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(2000),
      });
      if (res.ok) return;
    } catch {
      /* retry */
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  const logHint = gatewayLogSnippetForError();
  throw new Error(
    `Gateway did not become ready with expected auth at ${url} within ${timeoutMs}ms` +
      (logHint ? `\n\nRecent gateway output:\n${logHint}` : ''),
  );
}

export async function restartEmbeddedGatewayFromSavedConfig(params: {
  configPath: string;
  workspacePath: string;
  resolveCredentials: () => Promise<{ port: number; token: string; bind: GatewayBindMode }>;
}): Promise<{ port: number; token: string }> {
  if (!embeddedGatewayRuntime) {
    throw new Error('Embedded gateway is not registered');
  }
  stopGatewayProcess();
  const { port, token, bind } = await params.resolveCredentials();
  const opts: GatewayProcessOptions = {
    configPath: params.configPath,
    workspacePath: params.workspacePath,
    port,
    bind,
    onUnexpectedExit: embeddedGatewayRuntime.onUnexpectedExit,
  };
  const child = spawnGatewayProcess(opts);
  await waitForGatewayReady(port, token, child);
  embeddedGatewayRuntime = { ...opts, authToken: token };
  return { port, token };
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
