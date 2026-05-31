/**
 * Launches a Chromium / Chrome instance locally with `--remote-debugging-port`
 * so the user can wire CDP backend without typing the command themselves.
 *
 * Instances live for the lifetime of the gateway process (no on-disk state).
 * Launching binds the debug port to 127.0.0.1; the user-data-dir is rooted
 * under `~/.xopc/cdp-launch/` and removed on stop.
 */

import { existsSync } from 'node:fs';
import { mkdir, rm } from 'node:fs/promises';
import { homedir, platform as osPlatform } from 'node:os';
import { join } from 'node:path';
import { ChildProcess, spawn } from 'node:child_process';

import { createLogger } from '../utils/logger.js';

import { pickFreePort } from './free-port.js';
import { loadPlaywrightCoreModule } from './providers/playwright-doctor.js';

const log = createLogger('CdpLocalLauncher');

const READY_TIMEOUT_MS = 20_000;
const READY_POLL_INTERVAL_MS = 250;

export interface LaunchedCdpInstance {
  /** Debug port the instance listens on (loopback). */
  port: number;
  /** Browser-level WS endpoint, ready for Playwright `connectOverCDP`. */
  wsEndpoint: string;
  /** Browser process pid. */
  pid: number;
  /** Resolved Chrome / Chromium binary path used to spawn. */
  executablePath: string;
  /** Temporary `--user-data-dir`. Deleted on stop. */
  userDataDir: string;
  /** Wall-clock spawn time (ms epoch). */
  startedAt: number;
}

interface InstanceEntry extends LaunchedCdpInstance {
  child: ChildProcess;
}

const instances = new Map<number, InstanceEntry>();

function defaultUserDataRoot(): string {
  return join(homedir(), '.xopc', 'cdp-launch');
}

/** Resolve a Chrome / Chromium executable for the current platform. */
export async function resolveChromeBinary(override?: string): Promise<string> {
  if (override && override.trim()) {
    const candidate = override.trim();
    if (!existsSync(candidate)) {
      throw new Error(`Chrome executable not found at ${candidate}`);
    }
    return candidate;
  }

  try {
    const pw = await loadPlaywrightCoreModule();
    const chromium = pw.chromium
      ?? (pw as { default?: { chromium?: (typeof pw)['chromium'] } }).default?.chromium;
    const exec = chromium?.executablePath?.();
    if (exec && existsSync(exec)) {
      return exec;
    }
  } catch {
    // playwright-core unavailable — fall through to system probes
  }

  const os = osPlatform();
  const probes: string[] =
    os === 'darwin'
      ? [
          '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
          '/Applications/Chromium.app/Contents/MacOS/Chromium',
          '/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary',
        ]
      : os === 'win32'
        ? [
            'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
            'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
          ]
        : ['/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser', '/snap/bin/chromium'];

  for (const path of probes) {
    if (existsSync(path)) return path;
  }
  throw new Error(
    'No Chrome / Chromium binary found. Install Chrome or run `npx playwright install chromium` first.',
  );
}

async function waitForCdpEndpoint(port: number): Promise<string> {
  const deadline = Date.now() + READY_TIMEOUT_MS;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/json/version`, {
        signal: AbortSignal.timeout(1500),
      });
      if (res.ok) {
        const data = (await res.json()) as { webSocketDebuggerUrl?: string };
        if (data.webSocketDebuggerUrl) return data.webSocketDebuggerUrl;
      }
    } catch {
      // not ready yet
    }
    await new Promise((r) => setTimeout(r, READY_POLL_INTERVAL_MS));
  }
  throw new Error(`Chrome did not expose CDP within ${READY_TIMEOUT_MS / 1000}s on port ${port}`);
}

export interface LaunchOptions {
  /** Optional override for the Chrome / Chromium binary. */
  executablePath?: string;
  /** Run headless. Default false (visible window so user can interact). */
  headless?: boolean;
}

export async function launchLocalCdpChrome(opts: LaunchOptions = {}): Promise<LaunchedCdpInstance> {
  const executablePath = await resolveChromeBinary(opts.executablePath);
  const port = await pickFreePort();

  const root = defaultUserDataRoot();
  await mkdir(root, { recursive: true });
  const userDataDir = join(root, `${process.pid}-${port}`);
  await mkdir(userDataDir, { recursive: true });

  const args = [
    `--remote-debugging-address=127.0.0.1`,
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${userDataDir}`,
    '--no-first-run',
    '--no-default-browser-check',
  ];
  if (opts.headless) args.push('--headless=new');
  if (osPlatform() === 'darwin') args.push('--use-mock-keychain');

  log.info({ executablePath, port, userDataDir }, 'Spawning local debuggable Chrome');

  const child = spawn(executablePath, args, {
    stdio: ['ignore', 'ignore', 'ignore'],
    detached: false,
  });

  // Surface early launch failures before waitForCdpEndpoint times out.
  const launchFailure = new Promise<never>((_resolve, reject) => {
    const onErr = (err: Error) => reject(new Error(`spawn failed: ${err.message}`));
    const onExit = (code: number | null, signal: NodeJS.Signals | null) => {
      const reason = signal ? `signal ${signal}` : `exit ${code ?? 'unknown'}`;
      reject(new Error(`Chrome exited before CDP came up (${reason})`));
    };
    child.once('error', onErr);
    child.once('exit', onExit);
  });

  let wsEndpoint: string;
  try {
    wsEndpoint = await Promise.race([waitForCdpEndpoint(port), launchFailure]);
  } catch (e) {
    child.kill();
    await rm(userDataDir, { recursive: true, force: true }).catch(() => {});
    throw e;
  }

  const entry: InstanceEntry = {
    port,
    wsEndpoint,
    pid: child.pid ?? -1,
    executablePath,
    userDataDir,
    startedAt: Date.now(),
    child,
  };
  instances.set(port, entry);

  // If Chrome exits on its own, drop bookkeeping so /instances reflects truth.
  child.once('exit', () => {
    instances.delete(port);
    void rm(userDataDir, { recursive: true, force: true }).catch(() => {});
    log.info({ port }, 'Local CDP Chrome exited');
  });

  return toPublic(entry);
}

export async function stopLocalCdpChrome(port: number): Promise<boolean> {
  const entry = instances.get(port);
  if (!entry) return false;
  entry.child.kill();
  // exit handler will clean up the map and user-data-dir.
  return true;
}

export function listLocalCdpInstances(): LaunchedCdpInstance[] {
  return [...instances.values()].map(toPublic);
}

function toPublic(entry: InstanceEntry): LaunchedCdpInstance {
  const { child: _child, ...pub } = entry;
  return pub;
}

/** Graceful shutdown — call from gateway exit hooks. */
export async function stopAllLocalCdpChromes(): Promise<void> {
  for (const [port] of instances) {
    await stopLocalCdpChrome(port);
  }
}
