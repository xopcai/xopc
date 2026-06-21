/**
 * Extension Installation Module
 * Supports installing from npm packages, local directories, and xopc-store zips
 * Supports three-tier storage: workspace, global, bundled
 */

import { execSync } from 'child_process';
import AdmZip from 'adm-zip';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  cpSync,
  rmSync,
  readdirSync,
  mkdtempSync,
  writeFileSync,
} from 'fs';
import { dirname, join, isAbsolute, resolve, sep } from 'path';
import { tmpdir } from 'os';
import {
  resolveExtensionsDir as resolveGlobalExtensionsDir,
  resolveBundledExtensionsDir,
} from '../config/paths.js';
import { PACKAGE_VERSION } from '../package-version.js';
import { createLogger } from '../utils/logger.js';
import { checkEngineCompatibility } from './engine-check.js';
import { collectExtensionPackageDependencyIssues } from './package-contract.js';
import { MAX_EXTENSION_STORE_ZIP_BYTES } from './store-zip-limits.js';

const log = createLogger('ExtensionInstall');

const NPM_INSTALL_ENV = process.env.XOPC_EXTENSION_NPM_INSTALL?.trim().toLowerCase();

function extractExecSyncOutput(error: unknown): string {
  if (!error || typeof error !== 'object') return '';
  const o = error as { stderr?: Buffer | string; stdout?: Buffer | string; message?: string };
  const read = (x?: Buffer | string | null) => {
    if (x == null) return '';
    return Buffer.isBuffer(x) ? x.toString('utf8') : x;
  };
  const stderr = read(o.stderr).trim();
  const stdout = read(o.stdout).trim();
  if (stderr) return stderr;
  if (stdout) return stdout;
  return typeof o.message === 'string' ? o.message.trim() : '';
}

function truncateOutput(text: string, max = 4500): string {
  const t = text.trim();
  if (t.length <= max) return t;
  return `…${t.slice(-max)}`;
}

/**
 * Install production `node_modules` for an unpacked extension (package.json dependencies).
 * Uses pnpm when `pnpm-lock.yaml` is present, otherwise npm. Set `XOPC_EXTENSION_NPM_INSTALL=skip`
 * to skip (extensions must ship runnable code or you install deps manually).
 */
function installExtensionProdDependencies(extensionDir: string): { ok: true } | { ok: false; error: string } {
  if (NPM_INSTALL_ENV === 'skip' || NPM_INSTALL_ENV === '0' || NPM_INSTALL_ENV === 'false') {
    log.warn(
      { extensionDir, XOPC_EXTENSION_NPM_INSTALL: process.env.XOPC_EXTENSION_NPM_INSTALL },
      'Skipping extension dependency install (XOPC_EXTENSION_NPM_INSTALL)',
    );
    return { ok: true };
  }

  const execOpts = {
    cwd: extensionDir,
    timeout: 300_000,
    encoding: 'utf-8' as const,
    stdio: ['ignore', 'pipe', 'pipe'] as ('ignore' | 'pipe')[],
    maxBuffer: 20 * 1024 * 1024,
    env: process.env,
    ...(process.platform === 'win32'
      ? { shell: (process.env.ComSpec && process.env.ComSpec.trim()) || 'cmd.exe' }
      : {}),
  };

  const run = (label: string, command: string): { ok: true } | { ok: false; error: string } => {
    try {
      execSync(command, execOpts);
      return { ok: true };
    } catch (err) {
      const out = truncateOutput(extractExecSyncOutput(err));
      const hint =
        label === 'npm'
          ? ' Check that Node.js/npm is on PATH, the registry is reachable, and peer/engine rules allow install.'
          : ' Check that pnpm is on PATH or remove pnpm-lock.yaml to use npm instead.';
      return {
        ok: false,
        error: `${label} install failed.${hint}${out ? `\n\n${out}` : ''}`,
      };
    }
  };

  const usePnpm = existsSync(join(extensionDir, 'pnpm-lock.yaml'));
  if (usePnpm) {
    const pnpm = run('pnpm', 'pnpm install --prod --no-frozen-lockfile');
    if (pnpm.ok) return pnpm;
    const npmFallback = run('npm', 'npm install --omit=dev --no-audit --no-fund');
    if (npmFallback.ok) {
      log.warn({ extensionDir }, 'pnpm failed; extension dependencies installed with npm instead');
      return { ok: true };
    }
    return npmFallback;
  }

  return run('npm', 'npm install --omit=dev --no-audit --no-fund');
}

export interface InstallOptions {
  source: 'npm' | 'local';
  targetDir: string;
  timeoutMs?: number;
  global?: boolean;
}

export interface InstallResult {
  ok: boolean;
  extensionId?: string;
  targetDir?: string;
  origin?: 'workspace' | 'global';
  error?: string;
}

export interface ListedExtension {
  id: string;
  name?: string;
  version?: string;
  kind?: string;
  path: string;
  origin: 'workspace' | 'global' | 'bundled';
}

interface ExtensionManifest {
  id: string;
  name?: string;
  version?: string;
  main?: string;
  engines?: {
    xopc?: string;
    extensionApi?: string;
    extensionUiApi?: string;
  };
}

function isSafeZipPath(name: string): boolean {
  if (!name) return false;
  const normalized = name.replace(/\\/g, '/');
  if (normalized.includes('..')) return false;
  if (normalized.startsWith('/') || /^\w:/.test(normalized)) return false;
  for (const p of normalized.split('/')) {
    if (p === '..') return false;
  }
  return true;
}

function isIgnorableZipEntry(name: string): boolean {
  const n = name.replace(/\\/g, '/');
  if (n.startsWith('__MACOSX/')) return true;
  const segments = n.split('/').filter(Boolean);
  for (const s of segments) {
    if (s === '.DS_Store' || s === 'Thumbs.db' || s === 'desktop.ini') return true;
    if (s.startsWith('._')) return true;
  }
  return false;
}

function inferExtensionStripPrefix(primaryManifestPath: string): string {
  const norm = primaryManifestPath.replace(/\\/g, '/');
  const lower = norm.toLowerCase();
  const suff = 'xopc.extension.json';
  if (lower === suff) return '';
  if (!lower.endsWith(suff)) return '';
  return norm.slice(0, norm.length - suff.length);
}

function readShallowestExtensionManifestFromZip(buffer: Buffer): Record<string, unknown> | undefined {
  if (buffer.length > MAX_EXTENSION_STORE_ZIP_BYTES) return undefined;
  let zip: AdmZip;
  try {
    zip = new AdmZip(buffer);
  } catch {
    return undefined;
  }
  const entries = zip
    .getEntries()
    .filter((e) => !e.isDirectory && e.entryName && !isIgnorableZipEntry(e.entryName));
  const safeEntries = entries.filter((e) => isSafeZipPath(e.entryName));
  const names = safeEntries.map((e) => e.entryName.replace(/\\/g, '/'));
  const manifestPaths = names.filter((n) => /(^|\/)xopc\.extension\.json$/i.test(n));
  const shallow = manifestPaths.filter((n) => n.split('/').filter(Boolean).length <= 2);
  if (shallow.length === 0) return undefined;
  shallow.sort((a, b) => a.length - b.length);
  const path = shallow[0];
  const entry = safeEntries.find((e) => e.entryName.replace(/\\/g, '/') === path);
  if (!entry) return undefined;
  try {
    const raw = entry.getData().toString('utf8');
    const parsed = JSON.parse(raw) as unknown;
    return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : undefined;
  } catch {
    return undefined;
  }
}

export function peekExtensionManifestFromStoreZip(buffer: Buffer): Record<string, unknown> | undefined {
  return readShallowestExtensionManifestFromZip(buffer);
}

/** Read `id` from the shallowest xopc.extension.json in a store zip (for --force / preflight). */
export function peekExtensionIdFromStoreZip(buffer: Buffer): string | undefined {
  const m = readShallowestExtensionManifestFromZip(buffer) as { id?: string } | undefined;
  const id = typeof m?.id === 'string' ? m.id.trim() : '';
  if (!id || id.includes('/') || id.includes('\\')) return undefined;
  return id;
}

/**
 * Install an extension from an xopc-store zip buffer (layout: manifest at archive root
 * or under a single top-level folder).
 */
export async function installExtensionFromStoreZip(
  buffer: Buffer,
  extensionsDir: string,
): Promise<InstallResult> {
  if (buffer.length > MAX_EXTENSION_STORE_ZIP_BYTES) {
    return {
      ok: false,
      error: `Extension zip exceeds maximum size (${MAX_EXTENSION_STORE_ZIP_BYTES} bytes)`,
    };
  }

  const zip = new AdmZip(buffer);
  const entries = zip
    .getEntries()
    .filter((e) => !e.isDirectory && e.entryName && !isIgnorableZipEntry(e.entryName));
  const safeEntries = entries.filter((e) => isSafeZipPath(e.entryName));
  if (safeEntries.length === 0) {
    return { ok: false, error: 'Zip is empty or invalid' };
  }

  const names = safeEntries.map((e) => e.entryName.replace(/\\/g, '/'));
  const manifestPaths = names.filter((n) => /(^|\/)xopc\.extension\.json$/i.test(n));
  if (manifestPaths.length === 0) {
    return { ok: false, error: 'Zip must contain xopc.extension.json' };
  }
  const shallow = manifestPaths.filter((n) => n.split('/').filter(Boolean).length <= 2);
  if (shallow.length === 0) {
    return {
      ok: false,
      error:
        'xopc.extension.json is nested too deeply; use a zip with manifest at archive root or one folder (e.g. my-ext/xopc.extension.json)',
    };
  }
  shallow.sort((a, b) => a.length - b.length);
  const stripPrefix = inferExtensionStripPrefix(shallow[0]);
  if (stripPrefix) {
    const prefixNorm = stripPrefix.replace(/\\/g, '/');
    const outside = names.filter((n) => !n.startsWith(prefixNorm) && !isIgnorableZipEntry(n));
    if (outside.length > 0) {
      return {
        ok: false,
        error: `Invalid zip: expected all files under "${prefixNorm.replace(/\/$/, '')}/", but found "${outside[0]}".`,
      };
    }
  }

  const tmpRoot = mkdtempSync(join(tmpdir(), 'xopc-ext-zip-'));
  const destResolved = resolve(tmpRoot);
  try {
    for (const e of safeEntries) {
      const norm = e.entryName.replace(/\\/g, '/');
      let rel: string;
      if (stripPrefix) {
        const prefixNorm = stripPrefix.replace(/\\/g, '/');
        if (!norm.startsWith(prefixNorm)) {
          return {
            ok: false,
            error: `Zip entry outside extension prefix "${prefixNorm.replace(/\/$/, '')}": ${norm}`,
          };
        }
        rel = norm.slice(prefixNorm.length).replace(/^\//, '');
      } else {
        rel = norm;
      }
      if (!rel || rel.includes('..')) {
        return { ok: false, error: `Refusing unsafe zip entry path: ${e.entryName}` };
      }
      const targetPath = join(tmpRoot, rel);
      const resolvedTarget = resolve(targetPath);
      if (!resolvedTarget.startsWith(destResolved + sep) && resolvedTarget !== destResolved) {
        return {
          ok: false,
          error: `Refusing unsafe zip path (possible traversal): ${e.entryName}`,
        };
      }
      mkdirSync(dirname(targetPath), { recursive: true });
      writeFileSync(targetPath, e.getData());
    }

    if (!existsSync(join(tmpRoot, 'xopc.extension.json'))) {
      return { ok: false, error: 'Extracted content is missing xopc.extension.json' };
    }

    return await installFromDirectory(tmpRoot, extensionsDir);
  } finally {
    try {
      rmSync(tmpRoot, { recursive: true, force: true });
    } catch {
      // ignore
    }
  }
}

/**
 * Resolve target extensions directory based on options
 */
export function resolveExtensionsDir(
  workspaceDir: string,
  global = false,
): string {
  if (global) {
    const globalDir = resolveGlobalExtensionsDir();
    mkdirSync(globalDir, { recursive: true });
    return globalDir;
  }
  return join(workspaceDir, '.extensions');
}

/**
 * Install extension from npm package
 */
export async function installFromNpm(
  packageSpec: string,
  extensionsDir: string,
  timeoutMs = 120000,
): Promise<InstallResult> {
  const tmpDir = join(tmpdir(), `xopc-install-${Date.now()}`);

  try {
    console.log(`📦 Downloading ${packageSpec} from npm...`);

    // Create temp directory
    mkdirSync(tmpDir, { recursive: true });

    // Use npm pack to download package
    const result = execSync(`npm pack ${packageSpec} --pack-destination ${tmpDir}`, {
      timeout: timeoutMs,
      encoding: 'utf-8',
      stdio: 'pipe',
    });

    const packedFile = result.trim().split('\n').pop()?.trim();
    if (!packedFile) {
      return { ok: false, error: 'Failed to download package from npm' };
    }

    const archivePath = join(tmpDir, packedFile);

    // Extract tarball
    console.log(`📂 Extracting ${packedFile}...`);
    execSync(`tar -xzf ${archivePath} -C ${tmpDir}`, {
      timeout: 30000,
      stdio: 'pipe',
    });

    // npm pack extracts to 'package' directory
    const extractDir = join(tmpDir, 'package');

    // Validate and install
    return await installFromDirectory(extractDir, extensionsDir);
  } catch (error) {
    return {
      ok: false,
      error: `Failed to install from npm: ${error instanceof Error ? error.message : String(error)}`,
    };
  } finally {
    // Cleanup temp directory
    try {
      rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  }
}

/**
 * Install extension from local directory
 */
export async function installFromLocal(
  localPath: string,
  extensionsDir: string,
): Promise<InstallResult> {
  // Resolve to absolute path
  const sourceDir = isAbsolute(localPath) ? localPath : resolve(process.cwd(), localPath);

  if (!existsSync(sourceDir)) {
    return { ok: false, error: `Directory not found: ${sourceDir}` };
  }

  console.log(`📂 Installing from local directory: ${sourceDir}...`);

  return await installFromDirectory(sourceDir, extensionsDir);
}

/**
 * Install extension from extracted directory
 */
async function installFromDirectory(
  sourceDir: string,
  extensionsDir: string,
): Promise<InstallResult> {
  // Validate manifest
  const manifestPath = join(sourceDir, 'xopc.extension.json');
  const packagePath = join(sourceDir, 'package.json');

  let manifest: ExtensionManifest | null = null;
  let packageJson: { name?: string; version?: string; dependencies?: Record<string, string> } | null =
    null;

  // Try to load xopc.extension.json first
  if (existsSync(manifestPath)) {
    try {
      manifest = JSON.parse(readFileSync(manifestPath, 'utf-8')) as ExtensionManifest;
    } catch {
      return { ok: false, error: 'Invalid xopc.extension.json manifest file' };
    }
  }

  // Also try package.json for metadata
  if (existsSync(packagePath)) {
    try {
      packageJson = JSON.parse(readFileSync(packagePath, 'utf-8')) as typeof packageJson;
    } catch {
      // Ignore package.json parse errors
    }
  }

  if (packageJson) {
    const packageIssues = collectExtensionPackageDependencyIssues(
      packageJson as Record<string, unknown>,
      { strictRuntimeSdkDeps: true },
    );
    if (packageIssues.length > 0) {
      return {
        ok: false,
        error: `Extension package is not installable as an independent package:\n${packageIssues
          .map((issue) => `- ${issue.message}`)
          .join('\n')}`,
      };
    }
  }

  // Determine extension ID
  const extensionId = manifest?.id || packageJson?.name;
  if (!extensionId) {
    return {
      ok: false,
      error: 'Extension must have an id in xopc.extension.json or name in package.json',
    };
  }

  // Validate extension ID (no path separators)
  if (extensionId.includes('/') || extensionId.includes('\\')) {
    return { ok: false, error: 'Extension ID cannot contain path separators' };
  }

  // Check if already exists
  const targetDir = join(extensionsDir, extensionId);
  if (existsSync(targetDir)) {
    return { ok: false, error: `Extension already exists at ${targetDir}. Use update instead.` };
  }

  if (!manifest) {
    return { ok: false, error: 'Extension must include xopc.extension.json' };
  }

  if (!manifest.engines?.xopc) {
    return { ok: false, error: 'Extension manifest must declare engines.xopc' };
  }
  const engineCheck = checkEngineCompatibility(PACKAGE_VERSION, manifest.engines.xopc);
  if (engineCheck.parseWarning) {
    return {
      ok: false,
      error: engineCheck.reason ?? `Could not parse engines.xopc ${manifest.engines.xopc}`,
    };
  }
  if (!engineCheck.compatible) {
    return {
      ok: false,
      error: engineCheck.reason ?? `xopc ${PACKAGE_VERSION} does not satisfy engines.xopc ${manifest.engines.xopc}`,
    };
  }

  if (!manifest.main) {
    return { ok: false, error: 'Extension manifest must declare main' };
  }

  if (!/\.(mjs|cjs|js)$/i.test(manifest.main)) {
    return {
      ok: false,
      error: `Extension main must point at built JavaScript (.js/.mjs/.cjs), got: ${manifest.main}`,
    };
  }

  // Validate main entry exists
  const mainFile = manifest.main;
  const mainPath = join(sourceDir, mainFile);
  if (!existsSync(mainPath)) {
    return { ok: false, error: `Main entry not found: ${mainFile}` };
  }

  console.log(`📋 Extension: ${manifest?.name || extensionId} (${extensionId})`);
  if (manifest?.version || packageJson?.version) {
    console.log(`🔖 Version: ${manifest?.version || packageJson?.version}`);
  }

  // Create target directory
  mkdirSync(targetDir, { recursive: true });

  // Copy files
  console.log(`📂 Copying files to ${targetDir}...`);
  cpSync(sourceDir, targetDir, { recursive: true, force: true });

  // Install dependencies if package.json exists and has dependencies
  if (packageJson?.dependencies && Object.keys(packageJson.dependencies).length > 0) {
    console.log(`📦 Installing dependencies...`);
    const depResult = installExtensionProdDependencies(targetDir);
    if (depResult.ok === false) {
      rmSync(targetDir, { recursive: true, force: true });
      return { ok: false, error: depResult.error };
    }
  }

  const origin = extensionsDir.includes('.xopc/extensions') ? 'global' : 'workspace';

  console.log(`✅ Extension ${extensionId} installed successfully!`);
  console.log(`\nTo enable the extension, add to your config:`);
  console.log(`  extensions:`);
  console.log(`    enabled: [${extensionId}]`);
  console.log(`    ${extensionId}:`);
  console.log(`      # your extension options here\n`);

  return { ok: true, extensionId, targetDir, origin };
}

/**
 * Remove installed extension from all tiers
 */
export function removeExtension(
  extensionId: string,
  workspaceDir: string,
): { ok: boolean; removedFrom?: string; error?: string } {
  // Try workspace first
  const workspaceDir_ = join(workspaceDir, '.extensions');
  const workspaceExtension = join(workspaceDir_, extensionId);

  if (existsSync(workspaceExtension)) {
    try {
      rmSync(workspaceExtension, { recursive: true, force: true });
      return { ok: true, removedFrom: 'workspace' };
    } catch (error) {
      return {
        ok: false,
        error: `Failed to remove from workspace: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }

  // Try global
  const globalDir = resolveGlobalExtensionsDir();
  const globalExtension = join(globalDir, extensionId);

  if (existsSync(globalExtension)) {
    try {
      rmSync(globalExtension, { recursive: true, force: true });
      return { ok: true, removedFrom: 'global' };
    } catch (error) {
      return {
        ok: false,
        error: `Failed to remove from global: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }

  return { ok: false, error: `Extension not found: ${extensionId}` };
}

/**
 * List installed extensions from all tiers
 */
export function listAllExtensions(workspaceDir: string): ListedExtension[] {
  const extensions: ListedExtension[] = [];
  const seen = new Set<string>();

  // Priority 1: Workspace (highest)
  const workspaceExtensionsDir = join(workspaceDir, '.extensions');
  if (existsSync(workspaceExtensionsDir)) {
    for (const entry of readdirSync(workspaceExtensionsDir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;

      const extensionDir = join(workspaceExtensionsDir, entry.name);
      const manifest = readManifest(extensionDir);

      if (manifest) {
        seen.add(entry.name);
        extensions.push({
          id: entry.name,
          name: manifest.name,
          version: manifest.version,
          path: extensionDir,
          origin: 'workspace',
        });
      }
    }
  }

  // Priority 2: Global
  const globalDir = resolveGlobalExtensionsDir();
  if (existsSync(globalDir)) {
    for (const entry of readdirSync(globalDir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      if (seen.has(entry.name)) continue; // Skip if already in workspace

      const extensionDir = join(globalDir, entry.name);
      const manifest = readManifest(extensionDir);

      if (manifest) {
        seen.add(entry.name);
        extensions.push({
          id: entry.name,
          name: manifest.name,
          version: manifest.version,
          path: extensionDir,
          origin: 'global',
        });
      }
    }
  }

  // Priority 3: Bundled (lowest)
  const bundledDir = resolveBundledExtensionsDir();
  if (bundledDir && existsSync(bundledDir)) {
    for (const entry of readdirSync(bundledDir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      if (seen.has(entry.name)) continue;

      const extensionDir = join(bundledDir, entry.name);
      const manifest = readManifest(extensionDir);

      if (manifest) {
        extensions.push({
          id: entry.name,
          name: manifest.name,
          version: manifest.version,
          path: extensionDir,
          origin: 'bundled',
        });
      }
    }
  }

  return extensions;
}

function readManifest(extensionDir: string): ExtensionManifest | null {
  const manifestPath = join(extensionDir, 'xopc.extension.json');

  if (!existsSync(manifestPath)) {
    // Try package.json
    const packagePath = join(extensionDir, 'package.json');
    if (existsSync(packagePath)) {
      try {
        const pkg = JSON.parse(readFileSync(packagePath, 'utf-8'));
        return {
          id: pkg.name,
          name: pkg.xopc?.extension?.name || pkg.name,
          version: pkg.version,
        };
      } catch {
        return null;
      }
    }
    return null;
  }

  try {
    return JSON.parse(readFileSync(manifestPath, 'utf-8')) as ExtensionManifest;
  } catch {
    return null;
  }
}
