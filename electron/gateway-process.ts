import { type ChildProcess, spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { app } from 'electron';

const DEFAULT_PORT = 18790;

let gatewayChild: ChildProcess | null = null;
let gatewayExitHandler: ((code: number | null, signal: string | null) => void) | null = null;

export function getDefaultGatewayPort(): number {
  return DEFAULT_PORT;
}

/**
 * CLI entry for the gateway subprocess.
 * Packaged: esbuild bundle at `out/server/index.js` (self-contained).
 * Dev: tsdown output at `dist/src/cli/index.js` (resolves deps from node_modules).
 */
export function resolveCliEntry(): string {
  if (app.isPackaged) {
    return join(app.getAppPath(), 'out/server/index.js');
  }
  const mainDir = dirname(fileURLToPath(import.meta.url));
  return join(mainDir, '../../dist/src/cli/index.js');
}

export function isCliBundlePresent(): boolean {
  return existsSync(resolveCliEntry());
}

export interface GatewayProcessOptions {
  configPath: string;
  workspacePath: string;
  port: number;
  /** Called when gateway process exits unexpectedly (non-zero or by signal). */
  onUnexpectedExit?: (code: number | null, signal: string | null) => void;
}

export function spawnGatewayProcess(opts: GatewayProcessOptions): ChildProcess {
  const cli = resolveCliEntry();
  const isPackaged = app.isPackaged;
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
      '--host',
      '127.0.0.1',
      '--port',
      String(opts.port),
      '--no-hot-reload',
    ],
    {
      env: {
        ...process.env,
        ELECTRON_RUN_AS_NODE: '1',
        XOPCBOT_STATE_DIR: dirname(opts.configPath),
        XOPCBOT_CONFIG_PATH: opts.configPath,
        XOPCBOT_WORKSPACE: opts.workspacePath,
        ...(isPackaged
          ? { XOPCBOT_UI_STATIC_ROOT: join(app.getAppPath(), 'dist/gateway/static/root') }
          : {}),
      },
      // app.getAppPath() is the app.asar archive — not a real directory; using it as cwd causes spawn ENOTDIR.
      cwd: isPackaged ? opts.workspacePath : dirname(dirname(dirname(cli))),
      // Use 'pipe' for packaged app to capture logs, but we must drain the pipes to prevent Windows deadlock.
      // Use 'inherit' in dev mode to see logs in terminal.
      stdio: isPackaged ? ['ignore', 'pipe', 'pipe'] : 'inherit',
      // On Windows, detach the child process so it doesn't die with the parent window.
      // But we still manage its lifecycle manually via gatewayChild reference.
      detached: process.platform === 'win32',
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
      // Forward to console for debugging (optional, can be removed in production)
      console.log(`[gateway:stdout] ${data.toString().trimEnd()}`);
    });
    child.stderr.on('data', (data: Buffer) => {
      console.error(`[gateway:stderr] ${data.toString().trimEnd()}`);
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

    // Notify if this was an unexpected exit and we have a handler.
    if (wasCurrentChild && gatewayExitHandler && (code !== 0 || signal)) {
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

export async function waitForGatewayHealth(port: number, timeoutMs = 120_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  const url = `http://127.0.0.1:${port}/health`;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(2000) });
      if (res.ok) return;
    } catch {
      /* retry */
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`Gateway did not become healthy at ${url} within ${timeoutMs}ms`);
}

export function stopGatewayProcess(): void {
  if (!gatewayChild?.pid) return;

  const child = gatewayChild;
  gatewayChild = null;
  gatewayExitHandler = null;

  try {
    // On Windows, we need to be more forceful since SIGTERM doesn't work the same way.
    // First try graceful shutdown via SIGTERM (works on Unix, ignored on Windows).
    // Then kill the process tree on Windows if needed.
    if (process.platform === 'win32') {
      // Windows: use taskkill to gracefully terminate the process tree.
      // /T = terminate process tree, /F = force (use only if graceful fails).
      const { spawn: spawnCmd } = require('node:child_process');
      const taskkill = spawnCmd('taskkill', ['/PID', String(child.pid), '/T'], {
        windowsHide: true,
        detached: true,
      });
      taskkill.on('error', () => {
        // Fallback to kill() if taskkill fails.
        try {
          child.kill();
        } catch {
          /* ignore */
        }
      });

      // Give it 5 seconds, then force kill if still running.
      setTimeout(() => {
        try {
          // Check if process is still alive by checking exitCode
          if (child.exitCode === null && child.signalCode === null) {
            const forceKill = spawnCmd('taskkill', ['/PID', String(child.pid), '/T', '/F'], {
              windowsHide: true,
              detached: true,
            });
            forceKill.on('error', () => {
              try {
                child.kill('SIGKILL');
              } catch {
                /* ignore */
              }
            });
          }
        } catch {
          /* ignore */
        }
      }, 5000);
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
