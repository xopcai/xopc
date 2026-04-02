import { type ChildProcess, spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { app } from 'electron';

const DEFAULT_PORT = 18790;

let gatewayChild: ChildProcess | null = null;

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

export function spawnGatewayProcess(opts: {
  configPath: string;
  workspacePath: string;
  port: number;
}): ChildProcess {
  const cli = resolveCliEntry();
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
        ...(app.isPackaged
          ? { XOPCBOT_UI_STATIC_ROOT: join(app.getAppPath(), 'dist/gateway/static/root') }
          : {}),
      },
      // app.getAppPath() is the app.asar archive — not a real directory; using it as cwd causes spawn ENOTDIR.
      cwd: app.isPackaged ? opts.workspacePath : dirname(dirname(dirname(cli))),
      stdio: app.isPackaged ? 'pipe' : 'inherit',
    },
  );

  gatewayChild = child;
  child.on('exit', (code, signal) => {
    if (gatewayChild === child) gatewayChild = null;
    if (code !== 0 && code !== null) {
      console.error(`[gateway] process exited code=${code} signal=${signal ?? ''}`);
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
  try {
    if (process.platform === 'win32') {
      gatewayChild.kill();
    } else {
      gatewayChild.kill('SIGTERM');
    }
  } catch {
    /* ignore */
  }
  gatewayChild = null;
}
