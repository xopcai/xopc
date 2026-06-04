/**
 * Install bundled Chrome extension artifacts into {resolveBinDir()}/browser-ext/{version}/.
 * Single version directory per install — direct overwrite, no `current` symlink.
 */

import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { readFile, readdir, rm } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { PACKAGE_VERSION } from '../../package-version.js';
import { resolveBinDir } from '../../config/paths.js';
import { resolvePackageRoot } from '../../infra/update-check.js';
import { writeTextAtomic } from '../../infra/write-file-atomic.js';
import { createLogger } from '../../utils/logger.js';
import { assertCacheDir } from '../cache-dir-policy.js';

const log = createLogger('BrowserExtInstall');

const META_FILENAME = '.meta.json';
const STAGING_MAX_AGE_MS = 60 * 60 * 1000;
const VERSION_DIR_RE = /^\d+\.\d+\.\d+/;

export const BROWSER_EXT_REQUIRED_FILES = [
  'manifest.json',
  'popup.html',
  'dist/background.js',
  'dist/content.js',
  'dist/popup.js',
] as const;

export type BrowserExtBundledFrom = 'npm-dist' | 'git-dev' | 'electron-asar' | 'env-override';

export interface BrowserExtInstallMeta {
  xopcVersion: string;
  manifestVersion: string;
  source: 'bundled';
  bundledFrom: BrowserExtBundledFrom;
  installedAt: string;
  installPath: string;
}

export interface BrowserExtDoctor {
  bundledAvailable: boolean;
  installed: boolean;
  xopcVersion: string;
  installedVersion?: string;
  manifestVersion?: string;
  extensionDir?: string;
  cacheDir: string;
  needsRefresh: boolean;
  needsChromeReload?: boolean;
  bundledFrom?: BrowserExtBundledFrom;
  runtimeExtensionVersion?: string;
}

export interface EnsureBrowserExtResult {
  extensionDir: string;
  xopcVersion: string;
  copied: boolean;
}

function moduleDir(): string {
  return dirname(fileURLToPath(import.meta.url));
}

/** Validate a directory contains a loadable extension tree. */
export function validateBrowserExtLayout(dir: string): boolean {
  return BROWSER_EXT_REQUIRED_FILES.every((rel) => existsSync(join(dir, rel)));
}

function readManifestVersion(dir: string): string | undefined {
  try {
    const raw = readFileSync(join(dir, 'manifest.json'), 'utf8');
    const parsed = JSON.parse(raw) as { version?: unknown };
    return typeof parsed.version === 'string' ? parsed.version : undefined;
  } catch {
    return undefined;
  }
}

async function readMeta(metaPath: string): Promise<BrowserExtInstallMeta | null> {
  try {
    const raw = await readFile(metaPath, 'utf8');
    const parsed = JSON.parse(raw) as BrowserExtInstallMeta;
    if (parsed && typeof parsed === 'object' && typeof parsed.xopcVersion === 'string') {
      return parsed;
    }
    return null;
  } catch {
    return null;
  }
}

function browserExtRoot(cacheDir: string): string {
  return join(cacheDir, 'browser-ext');
}

function resolveMetaPath(cacheDir: string): string {
  return join(browserExtRoot(cacheDir), META_FILENAME);
}

function resolveVersionDir(cacheDir: string, version: string): string {
  return join(browserExtRoot(cacheDir), version);
}

/** Resolve the installed extension directory (version folder, not a symlink). */
export function resolveInstalledExtensionPath(
  cacheDir: string,
  meta: BrowserExtInstallMeta | null,
): string | null {
  if (meta?.installPath && validateBrowserExtLayout(meta.installPath)) {
    return meta.installPath;
  }

  const expectedDir = resolveVersionDir(cacheDir, PACKAGE_VERSION);
  if (validateBrowserExtLayout(expectedDir)) {
    return expectedDir;
  }

  return null;
}

function walkAncestorsForGitDevBundled(start: string): string | null {
  let dir = start;
  for (let i = 0; i < 12; i++) {
    const candidate = join(dir, 'packages/browser-ext');
    if (validateBrowserExtLayout(candidate)) {
      return candidate;
    }
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

/**
 * Resolve the bundled extension source directory (read-only).
 */
export async function resolveBundledBrowserExtDir(): Promise<{
  dir: string;
  bundledFrom: BrowserExtBundledFrom;
} | null> {
  const envOverride = process.env.XOPC_BROWSER_EXT_BUNDLED_ROOT?.trim();
  if (envOverride && validateBrowserExtLayout(envOverride)) {
    return { dir: envOverride, bundledFrom: 'env-override' };
  }

  const fromModule = join(moduleDir(), '../../../browser-ext');
  if (validateBrowserExtLayout(fromModule)) {
    const root = await resolvePackageRoot();
    const bundledFrom: BrowserExtBundledFrom =
      process.versions.electron && root && root.includes('app.asar') ? 'electron-asar' : 'npm-dist';
    return { dir: fromModule, bundledFrom };
  }

  const gitDev = walkAncestorsForGitDevBundled(moduleDir());
  if (gitDev) {
    return { dir: gitDev, bundledFrom: 'git-dev' };
  }

  const root = await resolvePackageRoot();
  if (root) {
    const distBundled = join(root, 'dist/browser-ext');
    if (validateBrowserExtLayout(distBundled)) {
      const bundledFrom: BrowserExtBundledFrom =
        process.versions.electron && root.includes('app.asar') ? 'electron-asar' : 'npm-dist';
      return { dir: distBundled, bundledFrom };
    }
  }

  return null;
}

export function computeNeedsRefresh(params: {
  force?: boolean;
  bundledManifestVersion: string;
  installedPath: string | null;
  meta: BrowserExtInstallMeta | null;
}): boolean {
  if (params.force) return true;
  if (!params.installedPath || !validateBrowserExtLayout(params.installedPath)) return true;

  const installedManifest = readManifestVersion(params.installedPath);
  if (!installedManifest || installedManifest !== params.bundledManifestVersion) return true;

  if (!params.meta || params.meta.xopcVersion !== PACKAGE_VERSION) return true;

  return false;
}

async function cleanupStaleStaging(root: string): Promise<void> {
  if (!existsSync(root)) return;
  let entries: string[];
  try {
    entries = await readdir(root);
  } catch {
    return;
  }
  const now = Date.now();
  for (const name of entries) {
    if (!name.startsWith('.staging-')) continue;
    const full = join(root, name);
    try {
      const st = statSync(full);
      if (now - st.mtimeMs > STAGING_MAX_AGE_MS) {
        await rm(full, { recursive: true, force: true });
      }
    } catch {
      /* */
    }
  }
}

async function cleanupSiblingVersionDirs(root: string, keepVersion: string): Promise<void> {
  if (!existsSync(root)) return;
  let entries: string[];
  try {
    entries = await readdir(root);
  } catch {
    return;
  }
  for (const name of entries) {
    if (name === META_FILENAME || name.startsWith('.')) continue;
    if (!VERSION_DIR_RE.test(name)) continue;
    if (name === keepVersion) continue;
    try {
      await rm(join(root, name), { recursive: true, force: true });
      log.info({ version: name }, 'Removed old browser extension version directory');
    } catch (err) {
      log.warn({ err, version: name }, 'Failed to remove old browser extension version');
    }
  }
}

/** Copy one bundled file (read/write works when src is inside Electron app.asar). */
function copyBundledFile(src: string, dest: string): void {
  mkdirSync(dirname(dest), { recursive: true });
  writeFileSync(dest, readFileSync(src));
}

const BROWSER_EXT_DIST_FILES = ['background.js', 'content.js', 'popup.js'] as const;
const BROWSER_EXT_ICON_FILES = ['icon-16.png', 'icon-32.png', 'icon-48.png', 'icon-128.png'] as const;

function copyBundledTree(src: string, dest: string): void {
  mkdirSync(dest, { recursive: true });
  for (const name of ['manifest.json', 'popup.html']) {
    copyBundledFile(join(src, name), join(dest, name));
  }
  for (const file of BROWSER_EXT_DIST_FILES) {
    copyBundledFile(join(src, 'dist', file), join(dest, 'dist', file));
  }
  for (const icon of BROWSER_EXT_ICON_FILES) {
    const iconSrc = join(src, 'icons', icon);
    if (existsSync(iconSrc)) {
      copyBundledFile(iconSrc, join(dest, 'icons', icon));
    }
  }
  if (!validateBrowserExtLayout(dest)) {
    throw new Error('Bundled browser extension copy failed validation');
  }
}

export async function browserExtDoctor(opts?: {
  cacheDir?: string;
  runtimeExtensionVersion?: string;
}): Promise<BrowserExtDoctor> {
  const resolvedCache = opts?.cacheDir?.trim()
    ? assertCacheDir(opts.cacheDir)
    : resolveBinDir();
  const cacheDir = resolvedCache || resolveBinDir();

  const bundled = await resolveBundledBrowserExtDir();
  const bundledManifestVersion = bundled ? readManifestVersion(bundled.dir) : undefined;
  const meta = await readMeta(resolveMetaPath(cacheDir));
  const installedPath = resolveInstalledExtensionPath(cacheDir, meta);

  const needsRefresh = bundled
    ? computeNeedsRefresh({
        force: false,
        bundledManifestVersion: bundledManifestVersion ?? PACKAGE_VERSION,
        installedPath,
        meta,
      })
    : false;

  const installed = Boolean(installedPath) && !needsRefresh;
  const manifestVersion = installedPath ? readManifestVersion(installedPath) : undefined;

  let needsChromeReload: boolean | undefined;
  const runtimeVer = opts?.runtimeExtensionVersion?.trim();
  if (runtimeVer && manifestVersion && runtimeVer !== manifestVersion) {
    needsChromeReload = true;
  }

  return {
    bundledAvailable: Boolean(bundled),
    installed,
    xopcVersion: PACKAGE_VERSION,
    installedVersion: meta?.xopcVersion,
    manifestVersion,
    extensionDir: installedPath ?? undefined,
    cacheDir,
    needsRefresh,
    needsChromeReload,
    bundledFrom: bundled?.bundledFrom,
    runtimeExtensionVersion: runtimeVer,
  };
}

export async function ensureBrowserExtensionArtifacts(opts?: {
  force?: boolean;
  cacheDir?: string;
}): Promise<EnsureBrowserExtResult> {
  const resolvedCache = opts?.cacheDir?.trim()
    ? assertCacheDir(opts.cacheDir)
    : resolveBinDir();
  const cacheDir = resolvedCache || resolveBinDir();

  const bundled = await resolveBundledBrowserExtDir();
  if (!bundled) {
    throw new Error(
      'Bundled browser extension not found. Reinstall xopc or run from a built checkout (pnpm run build).',
    );
  }

  const bundledManifestVersion = readManifestVersion(bundled.dir) ?? PACKAGE_VERSION;
  const root = browserExtRoot(cacheDir);
  mkdirSync(root, { recursive: true });
  await cleanupStaleStaging(root);

  const meta = await readMeta(resolveMetaPath(cacheDir));
  const installedPath = resolveInstalledExtensionPath(cacheDir, meta);
  const needsRefresh = computeNeedsRefresh({
    force: opts?.force,
    bundledManifestVersion,
    installedPath,
    meta,
  });

  const versionKey = bundledManifestVersion;

  if (!needsRefresh && installedPath) {
    await cleanupSiblingVersionDirs(root, versionKey);
    return {
      extensionDir: installedPath,
      xopcVersion: PACKAGE_VERSION,
      copied: false,
    };
  }

  const versionDir = join(root, versionKey);
  const stagingDir = join(root, `.staging-${versionKey}-${process.pid}`);

  if (existsSync(stagingDir)) {
    rmSync(stagingDir, { recursive: true, force: true });
  }
  copyBundledTree(bundled.dir, stagingDir);

  if (existsSync(versionDir)) {
    rmSync(versionDir, { recursive: true, force: true });
  }
  renameSync(stagingDir, versionDir);

  await cleanupSiblingVersionDirs(root, versionKey);

  const nextMeta: BrowserExtInstallMeta = {
    xopcVersion: PACKAGE_VERSION,
    manifestVersion: bundledManifestVersion,
    source: 'bundled',
    bundledFrom: bundled.bundledFrom,
    installedAt: new Date().toISOString(),
    installPath: versionDir,
  };
  await writeTextAtomic(resolveMetaPath(cacheDir), JSON.stringify(nextMeta, null, 2));

  log.info(
    { extensionDir: versionDir, xopcVersion: PACKAGE_VERSION, bundledFrom: bundled.bundledFrom },
    'Browser extension artifacts installed',
  );

  return {
    extensionDir: versionDir,
    xopcVersion: PACKAGE_VERSION,
    copied: true,
  };
}

/**
 * Gateway startup hook: ensure artifacts when extension backend is enabled or prior install exists.
 */
export async function ensureBrowserExtensionOnStartup(config: {
  agents?: { defaults?: { browser?: { backend?: string } } };
}): Promise<void> {
  const backend = config.agents?.defaults?.browser?.backend;
  const cacheDir = resolveBinDir();
  const metaExists = existsSync(resolveMetaPath(cacheDir));
  if (backend !== 'extension' && !metaExists) {
    return;
  }
  await ensureBrowserExtensionArtifacts();
}

export async function readInstalledExtensionDir(cacheDir?: string): Promise<string | null> {
  const dir = cacheDir?.trim() ? assertCacheDir(cacheDir) : resolveBinDir();
  const resolved = dir || resolveBinDir();
  const meta = await readMeta(resolveMetaPath(resolved));
  return resolveInstalledExtensionPath(resolved, meta);
}

export type BrowserExtensionOpenAction = 'chrome' | 'folder' | 'both';

function spawnDetached(command: string, args: readonly string[]): void {
  spawn(command, [...args], { stdio: 'ignore', detached: true }).unref();
}

function openChromeExtensionsPage(): void {
  const chromeUrl = 'chrome://extensions';
  if (process.platform === 'darwin') {
    spawnDetached('open', ['-a', 'Google Chrome', chromeUrl]);
    return;
  }
  if (process.platform === 'win32') {
    spawnDetached('cmd', ['/c', 'start', 'chrome', chromeUrl]);
    return;
  }
  spawnDetached('xdg-open', [chromeUrl]);
}

function revealFolderInFileManager(dir: string): void {
  if (process.platform === 'darwin') {
    spawnDetached('open', [dir]);
    return;
  }
  if (process.platform === 'win32') {
    spawnDetached('explorer', [dir]);
    return;
  }
  spawnDetached('xdg-open', [dir]);
}

/**
 * Open chrome://extensions and/or reveal the installed extension folder on the gateway host.
 */
export async function openBrowserExtensionInstallUi(opts: {
  action: BrowserExtensionOpenAction;
  cacheDir?: string;
}): Promise<{ extensionDir: string }> {
  const doctor = await browserExtDoctor({ cacheDir: opts.cacheDir });
  const dir = doctor.extensionDir;
  if (!dir) {
    throw new Error('Extension not installed. Run xopc browser extension install first.');
  }

  if (opts.action === 'chrome' || opts.action === 'both') {
    openChromeExtensionsPage();
  }
  if (opts.action === 'folder' || opts.action === 'both') {
    revealFolderInFileManager(dir);
  }

  return { extensionDir: dir };
}
