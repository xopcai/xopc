/**
 * CloakBrowser provider — anti-fingerprint Chromium with stealth capabilities.
 *
 * Manages CloakBrowser binary download, stealth launch, CDP connection,
 * keep-open process reuse, and temporary profile lifecycle.
 *
 * Ported from brocli's cloak.rs to TypeScript, using Playwright's connectOverCDP
 * to produce a standard Browser/BrowserContext pair.
 */

import { createHash } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, mkdtemp, readdir, rename, rm, stat } from 'node:fs/promises';
import { platform as osPlatform, arch as osArch, tmpdir } from 'node:os';
import { join } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';
import { ChildProcess, spawn } from 'node:child_process';

import AdmZip from 'adm-zip';
import type { Browser, BrowserContext } from 'playwright-core';

import type { BrowserInstallProgress } from '../install-progress.js';
import { createLogger } from '../../utils/logger.js';
import { resolveBinDir } from '../../config/paths.js';
import { assertCacheDir } from '../cache-dir-policy.js';
import { pickFreePort } from '../free-port.js';
import {
  buildStealthArgs,
  generateFingerprintSeed,
  makeExecutable,
  removeQuarantineAttr,
  WEBDRIVER_OVERRIDE_SCRIPT,
} from '../stealth.js';
import type { CloakBrowserConfig } from './types.js';

const log = createLogger('CloakBrowser');

// ── Platform info ───────────────────────────────────────────────────────────

interface PlatformInfo {
  tag: string;
  chromiumVersion: string;
  archiveExt: string;
  executableRelativePath: string;
  fingerprintPlatform: string;
  /**
   * Expected SHA-256 of the downloaded archive (lowercase hex). Empty string =
   * verification opt-out for this platform; warned but not fatal. To populate:
   * download the archive once, run `shasum -a 256 <file>`, paste here.
   */
  expectedSha256: string;
}

const DOWNLOAD_BASE_URL = 'https://cloakbrowser.dev';
const GITHUB_DOWNLOAD_BASE_URL = 'https://github.com/CloakHQ/CloakBrowser/releases/download';
const READY_TIMEOUT_MS = 45_000;
const READY_POLL_INTERVAL_MS = 300;
const DEFAULT_KEEP_OPEN_CDP_PORT = 9222;

const PLATFORMS: Record<string, PlatformInfo> = {
  'darwin-arm64': {
    tag: 'darwin-arm64',
    chromiumVersion: '145.0.7632.109.2',
    archiveExt: '.tar.gz',
    executableRelativePath: 'Chromium.app/Contents/MacOS/Chromium',
    fingerprintPlatform: 'macos',
    expectedSha256: '',
  },
  'darwin-x64': {
    tag: 'darwin-x64',
    chromiumVersion: '145.0.7632.109.2',
    archiveExt: '.tar.gz',
    executableRelativePath: 'Chromium.app/Contents/MacOS/Chromium',
    fingerprintPlatform: 'macos',
    expectedSha256: '',
  },
  'linux-arm64': {
    tag: 'linux-arm64',
    chromiumVersion: '146.0.7680.177.4',
    archiveExt: '.tar.gz',
    executableRelativePath: 'chrome',
    fingerprintPlatform: 'windows',
    expectedSha256: '',
  },
  'linux-x64': {
    tag: 'linux-x64',
    chromiumVersion: '146.0.7680.177.4',
    archiveExt: '.tar.gz',
    executableRelativePath: 'chrome',
    fingerprintPlatform: 'windows',
    expectedSha256: '',
  },
  'win32-x64': {
    tag: 'windows-x64',
    chromiumVersion: '146.0.7680.177.4',
    archiveExt: '.zip',
    executableRelativePath: 'chrome.exe',
    fingerprintPlatform: 'windows',
    expectedSha256: '',
  },
};

function detectPlatform(): PlatformInfo {
  const os = osPlatform();
  const architecture = osArch();
  const archMap: Record<string, string> = { arm64: 'arm64', x64: 'x64' };
  const key = `${os}-${archMap[architecture] ?? architecture}`;
  const info = PLATFORMS[key];
  if (!info) {
    throw new Error(`Unsupported CloakBrowser platform: ${os}/${architecture}`);
  }
  return info;
}

/** Test-only: enumerate platform manifests. */
export function listCloakBrowserPlatforms(): PlatformInfo[] {
  return Object.values(PLATFORMS);
}

function archiveDownloadUrls(platformInfo: PlatformInfo): string[] {
  const archiveName = `cloakbrowser-${platformInfo.tag}${platformInfo.archiveExt}`;
  return [
    `${GITHUB_DOWNLOAD_BASE_URL}/chromium-v${platformInfo.chromiumVersion}/${archiveName}`,
    `${DOWNLOAD_BASE_URL}/download/${archiveName}`,
  ];
}

async function sha256OfFile(path: string): Promise<string> {
  const hash = createHash('sha256');
  await pipeline(createReadStream(path), hash);
  return hash.digest('hex');
}

// ── Binary management ───────────────────────────────────────────────────────

const CLOAKBROWSER_DIR_NAME = 'cloakbrowser';

/** Default CloakBrowser home: ~/.xopc/bin/cloakbrowser (chromium-v*, profiles/, …). */
export function defaultCloakBrowserCacheDir(): string {
  return join(resolveBinDir(), CLOAKBROWSER_DIR_NAME);
}

/** Resolve configured or default CloakBrowser cache root. */
export function resolveCloakBrowserCacheDir(configured?: string): string {
  if (configured?.trim()) {
    return assertCacheDir(configured.trim());
  }
  return defaultCloakBrowserCacheDir();
}

/**
 * Move legacy layout (~/.xopc/bin/chromium-v* and profiles/) into ~/.xopc/bin/cloakbrowser/.
 * No-op when using a custom cacheDir or when the new layout already exists.
 */
export async function migrateLegacyCloakBrowserLayout(cacheDir: string): Promise<void> {
  if (cacheDir !== defaultCloakBrowserCacheDir()) return;

  const binDir = resolveBinDir();
  await mkdir(cacheDir, { recursive: true });

  let entries: string[];
  try {
    entries = await readdir(binDir);
  } catch {
    return;
  }

  for (const name of entries) {
    if (!name.startsWith('chromium-v')) continue;
    const from = join(binDir, name);
    const to = join(cacheDir, name);
    if (await fileExists(to)) continue;
    if (!(await fileExists(from))) continue;
    try {
      await rename(from, to);
      log.info({ from, to }, 'Migrated legacy CloakBrowser binary directory');
    } catch (err) {
      log.warn({ err, from, to }, 'Failed to migrate legacy CloakBrowser binary directory');
    }
  }

  const legacyProfiles = join(binDir, 'profiles');
  const newProfiles = join(cacheDir, 'profiles');
  if (await fileExists(newProfiles) || !(await fileExists(legacyProfiles))) return;

  try {
    await rename(legacyProfiles, newProfiles);
    log.info({ from: legacyProfiles, to: newProfiles }, 'Migrated legacy CloakBrowser profiles directory');
  } catch (err) {
    log.warn({ err, from: legacyProfiles, to: newProfiles }, 'Failed to migrate legacy CloakBrowser profiles');
  }
}

function binaryDir(cacheDir: string, platformInfo: PlatformInfo): string {
  return join(cacheDir, `chromium-v${platformInfo.chromiumVersion}`);
}

function binaryPath(cacheDir: string, platformInfo: PlatformInfo): string {
  return join(binaryDir(cacheDir, platformInfo), platformInfo.executableRelativePath);
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

function runCommand(command: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ['ignore', 'ignore', 'pipe'] });
    let stderr = '';
    child.stderr?.on('data', (data: Buffer) => {
      stderr += data.toString();
    });
    child.once('error', reject);
    child.once('exit', (code, signal) => {
      if (code === 0) {
        resolve();
        return;
      }
      const reason = signal ? `signal ${signal}` : `exit code ${code ?? 'unknown'}`;
      const detail = stderr.trim() ? `: ${stderr.trim().slice(0, 500)}` : '';
      reject(new Error(`${command} failed with ${reason}${detail}`));
    });
  });
}

async function extractArchive(archivePath: string, targetDir: string, platformInfo: PlatformInfo): Promise<void> {
  if (platformInfo.archiveExt === '.tar.gz') {
    await runCommand('tar', ['-xzf', archivePath, '-C', targetDir]);
    return;
  }

  if (platformInfo.archiveExt === '.zip') {
    const zip = new AdmZip(archivePath);
    zip.extractAllTo(targetDir, true);
    return;
  }

  throw new Error(`Unsupported CloakBrowser archive format: ${platformInfo.archiveExt}`);
}

/**
 * Download and extract CloakBrowser binary.
 *
 * After download, verifies SHA-256 against the platform manifest when one is
 * present. Set `XOPC_CLOAKBROWSER_SKIP_HASH=1` to bypass (development only;
 * the gateway logs a warning when the env var is honoured).
 */
async function downloadArchiveToFile(
  url: string,
  archivePath: string,
  onProgress?: (progress: BrowserInstallProgress) => void | Promise<void>,
): Promise<void> {
  const response = await fetch(url, { redirect: 'follow' });
  if (!response.ok || !response.body) {
    throw new Error(`download returned HTTP ${response.status}`);
  }

  const contentLength = response.headers.get('content-length');
  const totalBytes =
    contentLength && Number.isFinite(Number(contentLength)) ? Number(contentLength) : null;
  let bytesReceived = 0;

  const report = () => {
    void onProgress?.({
      phase: 'downloading',
      message: 'Downloading CloakBrowser archive',
      bytesReceived,
      totalBytes,
      percent:
        totalBytes && totalBytes > 0
          ? Math.min(100, Math.round((bytesReceived / totalBytes) * 100))
          : null,
    });
  };

  report();

  const nodeStream = Readable.fromWeb(response.body as Parameters<typeof Readable.fromWeb>[0]);
  nodeStream.on('data', (chunk: Buffer | string) => {
    bytesReceived += typeof chunk === 'string' ? Buffer.byteLength(chunk) : chunk.length;
    report();
  });

  await pipeline(nodeStream, createWriteStream(archivePath));
  report();
}

async function downloadBinary(
  cacheDir: string,
  platformInfo: PlatformInfo,
  onProgress?: (progress: BrowserInstallProgress) => void | Promise<void>,
): Promise<string> {
  const targetDir = binaryDir(cacheDir, platformInfo);
  const execPath = binaryPath(cacheDir, platformInfo);

  if (await fileExists(execPath)) {
    log.info({ path: execPath }, 'CloakBrowser binary already cached');
    await onProgress?.({ phase: 'ready', message: 'CloakBrowser binary already cached', percent: 100 });
    return execPath;
  }

  await mkdir(cacheDir, { recursive: true });
  await onProgress?.({ phase: 'starting', message: 'Preparing CloakBrowser download' });

  const archiveName = `cloakbrowser-${platformInfo.tag}${platformInfo.archiveExt}`;
  const urls = archiveDownloadUrls(platformInfo);
  const expectedSha256 = platformInfo.expectedSha256.trim().toLowerCase();
  const skipHash = process.env.XOPC_CLOAKBROWSER_SKIP_HASH === '1';

  log.info({ version: platformInfo.chromiumVersion, platform: platformInfo.tag }, 'Downloading CloakBrowser...');

  let downloadError: Error | undefined;
  for (const url of urls) {
    const stagingDir = await mkdtemp(join(cacheDir, '.download-'));
    const archivePath = join(stagingDir, archiveName);
    try {
      await downloadArchiveToFile(url, archivePath, onProgress);

      if (expectedSha256) {
        await onProgress?.({ phase: 'verifying', message: 'Verifying SHA-256 checksum' });
        const actual = await sha256OfFile(archivePath);
        if (actual !== expectedSha256) {
          throw new Error(
            `SHA-256 mismatch: expected ${expectedSha256}, got ${actual}. Aborted to avoid running unverified binary.`,
          );
        }
        log.info({ archivePath }, 'SHA-256 verified');
      } else if (skipHash) {
        log.warn(
          { platform: platformInfo.tag, version: platformInfo.chromiumVersion },
          'CloakBrowser SHA-256 verification skipped (XOPC_CLOAKBROWSER_SKIP_HASH=1)',
        );
      } else {
        log.warn(
          { platform: platformInfo.tag, version: platformInfo.chromiumVersion },
          'CloakBrowser manifest has no expectedSha256; integrity NOT verified',
        );
      }

      await onProgress?.({ phase: 'extracting', message: 'Extracting CloakBrowser archive' });
      log.info({ archivePath }, 'Extracting CloakBrowser archive...');
      await rm(targetDir, { recursive: true, force: true }).catch(() => {});
      await mkdir(targetDir, { recursive: true });
      await extractArchive(archivePath, targetDir, platformInfo);

      if (!(await fileExists(execPath))) {
        throw new Error(`archive did not contain expected executable: ${execPath}`);
      }

      await makeExecutable(execPath);
      await removeQuarantineAttr(execPath);
      await rm(stagingDir, { recursive: true, force: true }).catch(() => {});

      await onProgress?.({ phase: 'ready', message: 'CloakBrowser binary ready', percent: 100 });
      log.info({ path: execPath }, 'CloakBrowser binary ready');
      return execPath;
    } catch (e) {
      await rm(stagingDir, { recursive: true, force: true }).catch(() => {});
      await rm(targetDir, { recursive: true, force: true }).catch(() => {});
      downloadError = e instanceof Error ? e : new Error(String(e));
      log.debug({ url, errorMessage: downloadError.message }, 'Download attempt failed');
    }
  }

  throw new Error(
    `Failed to download CloakBrowser v${platformInfo.chromiumVersion} for ${platformInfo.tag}: ${downloadError?.message ?? 'all URLs failed'}`,
  );
}

// ── CDP endpoint discovery ──────────────────────────────────────────────────

async function waitForCdpEndpoint(port: number): Promise<string> {
  const deadline = Date.now() + READY_TIMEOUT_MS;

  while (Date.now() < deadline) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json/version`);
      if (response.ok) {
        const data = (await response.json()) as { webSocketDebuggerUrl?: string };
        if (data.webSocketDebuggerUrl) {
          return data.webSocketDebuggerUrl;
        }
      }
    } catch {
      // Not ready yet
    }
    await new Promise((resolve) => setTimeout(resolve, READY_POLL_INTERVAL_MS));
  }

  throw new Error(`CloakBrowser did not expose CDP page within ${READY_TIMEOUT_MS / 1000}s on port ${port}`);
}

/** Try to find an existing CDP page endpoint on the given port. */
async function reuseOrCreatePageEndpoint(port: number): Promise<string | null> {
  try {
    const response = await fetch(`http://127.0.0.1:${port}/json/list`, {
      signal: AbortSignal.timeout(2000),
    });
    if (!response.ok) return null;
    const pages = (await response.json()) as Array<{ webSocketDebuggerUrl?: string; type?: string }>;
    const page = pages.find((p) => p.type === 'page' && p.webSocketDebuggerUrl);
    if (page?.webSocketDebuggerUrl) return page.webSocketDebuggerUrl;

    // No pages — create one
    const newResponse = await fetch(`http://127.0.0.1:${port}/json/new`);
    if (newResponse.ok) {
      const newPage = (await newResponse.json()) as { webSocketDebuggerUrl?: string };
      if (newPage.webSocketDebuggerUrl) return newPage.webSocketDebuggerUrl;
    }
  } catch {
    // Not running
  }
  return null;
}

// ── Provider ────────────────────────────────────────────────────────────────

export interface CloakBrowserLaunchResult {
  browser: Browser;
  context: BrowserContext;
  childProcess: ChildProcess | null;
  temporaryProfileDir: string | null;
}

/**
 * Launch or connect to a CloakBrowser instance and return a Playwright Browser + Context.
 */
export async function launchCloakBrowser(
  config: CloakBrowserConfig = {},
): Promise<CloakBrowserLaunchResult> {
  const platformInfo = detectPlatform();
  const cacheDir = resolveCloakBrowserCacheDir(config.cacheDir);
  await migrateLegacyCloakBrowserLayout(cacheDir);
  const keepOpen = config.keepOpen ?? true;
  const reuseExisting = config.reuseExisting ?? keepOpen;

  // Resolve binary
  const execPath = config.binaryPath ?? await downloadBinary(cacheDir, platformInfo, config.onProgress);
  if (config.binaryPath) {
    await makeExecutable(execPath);
    await removeQuarantineAttr(execPath);
  }

  // Resolve CDP port
  const cdpPort = config.cdpPort ?? (keepOpen ? DEFAULT_KEEP_OPEN_CDP_PORT : await pickFreePort());

  // Try to reuse existing instance
  if (reuseExisting) {
    const existingEndpoint = await reuseOrCreatePageEndpoint(cdpPort);
    if (existingEndpoint) {
      log.info({ port: cdpPort }, 'Reusing existing CloakBrowser instance');
      const pw = await import('playwright-core');
      const chromium = pw.chromium ?? (pw as { default?: { chromium?: (typeof pw)['chromium'] } }).default?.chromium;
      if (!chromium?.connectOverCDP) throw new Error('playwright-core does not support connectOverCDP');

      const wsUrl = `ws://127.0.0.1:${cdpPort}`;
      // connectOverCDP wants the browser-level WS URL
      const versionResp = await fetch(`http://127.0.0.1:${cdpPort}/json/version`);
      const versionData = (await versionResp.json()) as { webSocketDebuggerUrl?: string };
      const browserWsUrl = versionData.webSocketDebuggerUrl ?? wsUrl;

      const browser = await chromium.connectOverCDP(browserWsUrl);
      const contexts = browser.contexts();
      const context = contexts.length > 0 ? contexts[0] : await browser.newContext();

      // Inject stealth script
      await context.addInitScript(WEBDRIVER_OVERRIDE_SCRIPT);

      return { browser, context, childProcess: null, temporaryProfileDir: null };
    }
  }

  // Resolve user data dir
  let userDataDir: string;
  let temporaryProfileDir: string | null = null;
  if (config.userDataDir) {
    userDataDir = config.userDataDir;
  } else if (config.temporaryProfile) {
    userDataDir = join(tmpdir(), `xopc-cloakbrowser-${process.pid}-${generateFingerprintSeed()}`);
    temporaryProfileDir = userDataDir;
  } else {
    userDataDir = join(cacheDir, 'profiles', 'default');
  }
  await mkdir(userDataDir, { recursive: true });

  // Build launch args
  const stealthArgs = buildStealthArgs(config.extraArgs ?? [], {
    timezone: config.timezone,
    locale: config.locale,
    webrtcIp: config.webrtcIp,
    fingerprintPlatform: config.fingerprintPlatform ?? platformInfo.fingerprintPlatform,
  });

  const launchArgs = [
    `--remote-debugging-address=127.0.0.1`,
    `--remote-debugging-port=${cdpPort}`,
    `--user-data-dir=${userDataDir}`,
    '--no-first-run',
    '--no-default-browser-check',
    ...stealthArgs,
  ];

  if (config.headless) {
    launchArgs.push('--headless=new');
  }

  // macOS keychain bypass
  if (osPlatform() === 'darwin') {
    launchArgs.push('--use-mock-keychain');
  }

  await config.onProgress?.({ phase: 'running', message: 'Launching CloakBrowser for verification' });

  log.info(
    { execPath, port: cdpPort, headless: !!config.headless, keepOpen },
    'Launching CloakBrowser',
  );

  // Spawn browser process
  const child = spawn(execPath, launchArgs, {
    stdio: ['ignore', 'ignore', 'ignore'],
    detached: keepOpen, // Detach so it survives parent exit if keep-open
  });

  let onLaunchError: ((error: Error) => void) | null = null;
  let onLaunchExit: ((code: number | null, signal: NodeJS.Signals | null) => void) | null = null;
  const launchFailure = new Promise<never>((_resolve, reject) => {
    onLaunchError = (error) => {
      reject(new Error(`Failed to launch CloakBrowser at ${execPath}: ${error.message}`));
    };
    onLaunchExit = (code, signal) => {
      const reason = signal ? `signal ${signal}` : `exit code ${code ?? 'unknown'}`;
      reject(new Error(`CloakBrowser exited before CDP became ready (${reason})`));
    };
    child.once('error', onLaunchError);
    child.once('exit', onLaunchExit);
  });

  if (keepOpen) {
    child.unref();
  }

  // Wait for CDP to become available
  let browserWsUrl: string;
  try {
    browserWsUrl = await Promise.race([waitForCdpEndpoint(cdpPort), launchFailure]);
    if (onLaunchError) child.off('error', onLaunchError);
    if (onLaunchExit) child.off('exit', onLaunchExit);
  } catch (e) {
    if (onLaunchError) child.off('error', onLaunchError);
    if (onLaunchExit) child.off('exit', onLaunchExit);
    child.kill();
    if (temporaryProfileDir) {
      await rm(temporaryProfileDir, { recursive: true, force: true }).catch(() => {});
    }
    throw e;
  }

  // Get browser-level WS URL
  let browserLevelWsUrl: string;
  try {
    const versionResp = await fetch(`http://127.0.0.1:${cdpPort}/json/version`);
    const versionData = (await versionResp.json()) as { webSocketDebuggerUrl?: string };
    browserLevelWsUrl = versionData.webSocketDebuggerUrl ?? browserWsUrl;
  } catch {
    browserLevelWsUrl = browserWsUrl;
  }

  // Connect Playwright over CDP
  const pw = await import('playwright-core');
  const chromium = pw.chromium ?? (pw as { default?: { chromium?: (typeof pw)['chromium'] } }).default?.chromium;
  if (!chromium?.connectOverCDP) {
    child.kill();
    throw new Error('playwright-core does not support connectOverCDP');
  }

  const browser = await chromium.connectOverCDP(browserLevelWsUrl);
  const contexts = browser.contexts();
  const context = contexts.length > 0 ? contexts[0] : await browser.newContext();

  // Inject stealth overrides
  await context.addInitScript(WEBDRIVER_OVERRIDE_SCRIPT);

  log.info({ port: cdpPort, pid: child.pid }, 'CloakBrowser launched and connected');

  return {
    browser,
    context,
    childProcess: keepOpen ? null : child, // Only track child if not detached
    temporaryProfileDir,
  };
}

/**
 * Cleanup a CloakBrowser session — kill process and remove temp profile if applicable.
 */
export async function cleanupCloakBrowser(
  childProcess: ChildProcess | null,
  temporaryProfileDir: string | null,
): Promise<void> {
  if (childProcess) {
    childProcess.kill();
    // Wait briefly for exit
    await new Promise<void>((resolve) => {
      const timer = setTimeout(resolve, 2000);
      childProcess.once('exit', () => {
        clearTimeout(timer);
        resolve();
      });
    });
  }
  if (temporaryProfileDir) {
    await rm(temporaryProfileDir, { recursive: true, force: true }).catch(() => {});
    log.debug({ dir: temporaryProfileDir }, 'Cleaned up temporary profile');
  }
}

// ── Doctor / status ─────────────────────────────────────────────────────────

export interface CloakBrowserDoctorResult {
  installed: boolean;
  version: string | null;
  binaryPath: string | null;
  platform: string;
  cacheDir: string;
  expectedSha256: string;
  /** Primary URL the install flow would fetch from. */
  downloadUrl: string;
  /** Fallback URLs (rendered as alternatives in the install confirm dialog). */
  fallbackUrls: string[];
  /** True when `binaryPath` was user-supplied (UI should surface a warning). */
  customBinaryPath: boolean;
}

/**
 * Download (if needed), launch headlessly to verify, then return doctor status.
 * Used by gateway install endpoints and CLI.
 */
export async function installCloakBrowser(
  config: CloakBrowserConfig = {},
): Promise<CloakBrowserDoctorResult> {
  const result = await launchCloakBrowser({
    headless: true,
    temporaryProfile: true,
    keepOpen: false,
    cacheDir: config.cacheDir,
    binaryPath: config.binaryPath,
    onProgress: config.onProgress,
  });
  await result.browser.close().catch(() => {});
  await cleanupCloakBrowser(result.childProcess, result.temporaryProfileDir);
  return cloakBrowserDoctor({ cacheDir: config.cacheDir, binaryPath: config.binaryPath });
}

/** Check CloakBrowser installation status. */
export async function cloakBrowserDoctor(
  config: CloakBrowserConfig = {},
): Promise<CloakBrowserDoctorResult> {
  const platformInfo = detectPlatform();
  const cacheDir = resolveCloakBrowserCacheDir(config.cacheDir);
  await migrateLegacyCloakBrowserLayout(cacheDir);
  const customBinaryPath = typeof config.binaryPath === 'string' && config.binaryPath.length > 0;
  const execPath = config.binaryPath ?? binaryPath(cacheDir, platformInfo);
  const installed = await fileExists(execPath);
  const [primary, ...fallbacks] = archiveDownloadUrls(platformInfo);

  return {
    installed,
    version: installed ? platformInfo.chromiumVersion : null,
    binaryPath: installed ? execPath : null,
    platform: platformInfo.tag,
    cacheDir,
    expectedSha256: platformInfo.expectedSha256,
    downloadUrl: primary ?? '',
    fallbackUrls: fallbacks,
    customBinaryPath,
  };
}
